// video-worker — Cloudflare Worker คั่นหน้า R2 (เฟส 5, การป้องกันวิดีโอ v2)
// หน้าที่:
//   GET /__auth?token=<grant>  -> verify grant แล้ว set HttpOnly cookie (อายุสั้น) + CORS ให้ frontend
//   GET/HEAD /<r2Key>          -> อ่าน cookie -> verify -> เช็ค key+IP -> เสิร์ฟไฟล์จาก R2 (รองรับ Range)
// egress จาก R2 ฟรี (bytes วิ่ง R2 -> client บนเครือข่าย Cloudflare) — ไม่ผ่าน backend
import { verifyGrant } from './grant';

interface Env {
  MOVIES_BUCKET: R2Bucket; // binding ไปยัง R2 bucket ที่เก็บไฟล์หนัง
  VIDEO_GRANT_SECRET: string; // ต้องตรงกับ backend (เซ็น grant ฝั่งเดียวกัน)
  COOKIE_NAME?: string; // ชื่อ cookie (default 'mdn_video')
  ALLOWED_ORIGIN?: string; // origin ของ frontend สำหรับ CORS ที่ /__auth (คั่นหลายค่าด้วย comma ได้)
  ENFORCE_IP?: string; // 'true'/'1' = บังคับเทียบ IP กับ cf-connecting-ip
  ENVIRONMENT?: string; // 'production' = บังคับให้ตั้ง ALLOWED_ORIGIN (กัน default localhost หลุดไป prod)
}

const DEFAULT_COOKIE = 'mdn_video';

function isTrue(v: string | undefined): boolean {
  return v === 'true' || v === '1';
}

// แยกรายการ origin ที่อนุญาตจาก ALLOWED_ORIGIN (รองรับหลายค่าคั่นด้วย comma)
function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// CORS headers สำหรับ /__auth — strict allowlist:
//   ใช้ credentials ร่วมกับ ACAO='*' ไม่ได้ (เบราว์เซอร์ปฏิเสธ) จึงต้อง echo origin ที่ขอ
//   เฉพาะเมื่ออยู่ใน allowlist เท่านั้น มิฉะนั้นไม่ตั้ง ACAO/ACAC เลย (ปลอดภัยกว่าการ fallback '*')
function corsHeaders(req: Request, env: Env): Headers {
  const h = new Headers();
  h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  h.set('Vary', 'Origin');
  const origin = req.headers.get('Origin');
  const allow = allowedOrigins(env);
  if (origin && allow.includes(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Credentials', 'true');
  }
  return h;
}

// guard: ใน production ต้องตั้ง ALLOWED_ORIGIN เสมอ (กัน default dev 'localhost' หลุดไป prod)
// คืน true ถ้า config ปลอดภัยพอจะให้บริการ /__auth
function authConfigOk(env: Env): boolean {
  if (env.ENVIRONMENT === 'production') {
    return allowedOrigins(env).length > 0;
  }
  return true;
}

function json(body: unknown, status: number, headers?: Headers): Response {
  const h = headers ? new Headers(headers) : new Headers();
  h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: h });
}

// อ่านค่า cookie ตามชื่อจาก header Cookie
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('Cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

// แปลง Range header (single range) -> R2Range; คืน 'invalid' ถ้า parse ไม่ได้/ไม่รองรับ
function parseRange(header: string): R2Range | 'invalid' {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const startStr = m[1]!;
  const endStr = m[2]!;
  if (startStr === '' && endStr === '') return 'invalid';
  if (startStr === '') {
    // bytes=-N : ขอ N ไบต์สุดท้าย
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    return { suffix };
  }
  const offset = Number(startStr);
  if (!Number.isFinite(offset)) return 'invalid';
  if (endStr === '') return { offset };
  const end = Number(endStr);
  if (!Number.isFinite(end) || end < offset) return 'invalid';
  return { offset, length: end - offset + 1 };
}

// ตรวจ grant จาก cookie + เงื่อนไข key/IP — คืน error response ถ้าไม่ผ่าน, null ถ้าผ่าน
async function authorizeFileRequest(
  req: Request,
  env: Env,
  cookieName: string,
  key: string,
): Promise<Response | null> {
  const token = readCookie(req, cookieName);
  if (!token) return new Response('unauthorized', { status: 401 });
  const grant = await verifyGrant(token, env.VIDEO_GRANT_SECRET);
  if (!grant) return new Response('unauthorized', { status: 401 });
  // grant ออกให้เฉพาะไฟล์ของเรื่องนั้น — ยอมทั้งไฟล์วิดีโอ (key) และไฟล์ซับ (subkey) ที่ฝังมาด้วย
  // ห้ามเอา grant ของเรื่องหนึ่งไปดึงอีกเรื่อง
  if (key !== grant.key && key !== grant.subkey) return new Response('forbidden', { status: 403 });
  if (isTrue(env.ENFORCE_IP)) {
    const ip = req.headers.get('cf-connecting-ip') ?? '';
    // fail-closed: ถ้า grant ผูก IP ไว้แต่ดึง client IP ไม่ได้ ให้ปฏิเสธ (ไม่ปล่อยผ่านเงียบ ๆ)
    if (grant.ip && !ip) {
      console.warn('[video-worker] ENFORCE_IP: ขาด cf-connecting-ip — ปฏิเสธ (fail-closed)');
      return new Response('forbidden', { status: 403 });
    }
    if (grant.ip && ip && grant.ip !== ip) return new Response('forbidden', { status: 403 });
  }
  return null;
}

// set cookie จาก grant ที่ /__auth
async function handleAuth(req: Request, url: URL, env: Env, cookieName: string): Promise<Response> {
  const cors = corsHeaders(req, env);
  // guard: ใน production ถ้าไม่ได้ตั้ง ALLOWED_ORIGIN ให้ปฏิเสธ (กัน default localhost หลุด)
  if (!authConfigOk(env)) {
    console.error('[video-worker] ALLOWED_ORIGIN ไม่ถูกตั้งใน production — ปฏิเสธ /__auth');
    return json({ error: 'server_misconfigured' }, 500, cors);
  }
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'missing_token' }, 400, cors);

  const grant = await verifyGrant(token, env.VIDEO_GRANT_SECRET);
  if (!grant) return json({ error: 'invalid_token' }, 401, cors);

  if (isTrue(env.ENFORCE_IP)) {
    const ip = req.headers.get('cf-connecting-ip') ?? '';
    // fail-closed: grant ผูก IP แต่ไม่มี client IP -> ปฏิเสธ
    if (grant.ip && !ip) {
      console.warn('[video-worker] ENFORCE_IP: ขาด cf-connecting-ip ที่ /__auth — ปฏิเสธ (fail-closed)');
      return json({ error: 'ip_unavailable' }, 403, cors);
    }
    if (grant.ip && ip && grant.ip !== ip) return json({ error: 'ip_mismatch' }, 403, cors);
  }

  // อายุ cookie = เวลาที่เหลือของ grant
  const maxAge = Math.max(0, Math.floor((grant.exp - Date.now()) / 1000));
  // SameSite=None + Secure: ให้ตั้ง cookie ข้าม site ได้ (frontend คนละ origin) และส่งกลับตอนโหลดไฟล์
  const cookie = `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
  const headers = new Headers(cors);
  headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 204, headers });
}

// Cache-Control สำหรับ media — อนุญาตให้ browser เก็บ partial ไว้ใช้ตอน seek (no-store แรงเกินไป)
//   private = แคชเฉพาะ browser ของ user เท่านั้น (ไม่ใช่ shared cache),
//   no-cache = เก็บได้แต่ต้อง revalidate ทุกครั้ง — ลิงก์ยังถูกกันด้วย token TTL สั้นอยู่แล้ว
const MEDIA_CACHE_CONTROL = 'private, no-cache';

// คำนวณช่วง byte ที่จะเสิร์ฟจริงจาก R2Range + ขนาดไฟล์เต็ม
//   คืน { offset, length } ที่ clamp แล้ว หรือ 'unsatisfiable' ถ้า offset เกินขนาดไฟล์
// หมายเหตุ: คำนวณจาก r2Range ที่เราส่งเข้าไปเอง ไม่พึ่ง object.range (R2 อาจ echo {suffix} กลับมา)
function resolveRange(
  r2Range: R2Range,
  total: number,
): { offset: number; length: number } | 'unsatisfiable' {
  if ('suffix' in r2Range) {
    // bytes=-N : ขอ N ไบต์สุดท้าย (clamp ไม่ให้เกินขนาดไฟล์)
    const len = Math.min(r2Range.suffix, total);
    if (len <= 0) return 'unsatisfiable';
    return { offset: total - len, length: len };
  }
  const offset = r2Range.offset ?? 0;
  if (offset >= total) return 'unsatisfiable'; // RFC 7233 §4.4 — offset เกินขนาดไฟล์
  // length อาจไม่ระบุ (bytes=START-) -> ถึงท้ายไฟล์; clamp ไม่ให้เกินขอบไฟล์
  const requested = r2Range.length ?? total - offset;
  const length = Math.min(requested, total - offset);
  if (length <= 0) return 'unsatisfiable';
  return { offset, length };
}

// เสิร์ฟไฟล์จาก R2 (รองรับ Range + HEAD)
async function handleFile(req: Request, url: URL, env: Env, cookieName: string): Promise<Response> {
  const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!key) return new Response('not found', { status: 404 });

  const denied = await authorizeFileRequest(req, env, cookieName, key);
  if (denied) return denied;

  // CORS: ไฟล์ซับถูก fetch จาก frontend ด้วย JS (credentials:'include') ซึ่งโดน CORS
  //   จึงต้องแนบ ACAO(origin)+ACAC(true) ให้ JS อ่าน body ได้ — ส่วนวิดีโอเล่นแบบ no-cors จะเมินค่าพวกนี้ (ไม่กระทบ)
  const cors = corsHeaders(req, env);

  // HEAD: ส่งเฉพาะ metadata
  if (req.method === 'HEAD') {
    const head = await env.MOVIES_BUCKET.head(key);
    if (!head) return new Response('not found', { status: 404, headers: cors });
    const headers = new Headers(cors);
    head.writeHttpMetadata(headers);
    headers.set('Content-Type', head.httpMetadata?.contentType ?? 'video/mp4');
    headers.set('Content-Length', String(head.size));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', MEDIA_CACHE_CONTROL);
    return new Response(null, { status: 200, headers });
  }

  // parse Range (ถ้ามี)
  const rangeHeader = req.headers.get('Range');
  let r2Range: R2Range | undefined;
  if (rangeHeader) {
    const parsed = parseRange(rangeHeader);
    if (parsed === 'invalid') {
      // ต้องรู้ขนาดไฟล์เพื่อตอบ Content-Range: bytes */<total> ตาม RFC 7233 §4.4
      const head = await env.MOVIES_BUCKET.head(key);
      const h416 = new Headers(cors);
      if (head) h416.set('Content-Range', `bytes */${head.size}`);
      return new Response('range not satisfiable', { status: 416, headers: h416 });
    }
    r2Range = parsed;
  }

  // แยกเส้นทาง: ส่ง onlyIf (conditional get) เฉพาะตอน "ไม่มี" Range เท่านั้น
  //   เพราะการพ่วง onlyIf กับ Range อาจทำให้ R2 ตอบ 304 ทั้งที่ player คาดหวัง 206+ข้อมูลช่วงนั้น
  //   (RFC 7233/7232) -> seek/playback ค้าง
  if (!r2Range) {
    // ไม่มี Range -> รองรับ conditional get (อาจได้ 304) ผ่าน onlyIf
    const object = await env.MOVIES_BUCKET.get(key, { onlyIf: req.headers });
    if (!object) return new Response('not found', { status: 404, headers: cors });

    const total = object.size;

    // ถ้า conditional request ตรงเงื่อนไข R2 จะคืน object ที่ไม่มี body -> 304
    if (!('body' in object)) {
      const h304 = new Headers(cors);
      object.writeHttpMetadata(h304);
      if (object.httpEtag) h304.set('ETag', object.httpEtag);
      // RFC 7232 §4.1 — 304 ควรพก header ที่ปกติส่งใน 200 ที่ยังเกี่ยวข้อง
      h304.set('Cache-Control', MEDIA_CACHE_CONTROL);
      h304.set('Accept-Ranges', 'bytes');
      return new Response(null, { status: 304, headers: h304 });
    }

    const headers = new Headers(cors);
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', object.httpMetadata?.contentType ?? 'video/mp4');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', MEDIA_CACHE_CONTROL);
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    headers.set('Content-Length', String(total));
    return new Response(object.body, { status: 200, headers });
  }

  // มี Range -> get เฉพาะช่วง (ไม่ส่ง onlyIf เพื่อให้ได้ 206 เสมอเมื่อ validator ตรง)
  const object = await env.MOVIES_BUCKET.get(key, { range: r2Range });
  if (!object) return new Response('not found', { status: 404, headers: cors });

  const total = object.size; // ขนาดไฟล์เต็ม

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'video/mp4');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', MEDIA_CACHE_CONTROL);
  if (object.httpEtag) headers.set('ETag', object.httpEtag);

  // 206 Partial Content — คำนวณ offset/length จาก total เอง ไม่พึ่ง object.range
  //   (R2 อาจ echo {suffix} กลับมาทำให้คำนวณ Content-Length/Content-Range ผิด)
  const resolved = resolveRange(r2Range, total);
  if (resolved === 'unsatisfiable') {
    // offset เกินขนาดไฟล์ -> 416 พร้อม Content-Range: bytes */<total> (RFC 7233 §4.4)
    const h416 = new Headers(cors);
    h416.set('Content-Range', `bytes */${total}`);
    h416.set('Accept-Ranges', 'bytes');
    return new Response('range not satisfiable', { status: 416, headers: h416 });
  }
  const { offset, length } = resolved;
  const end = offset + length - 1;
  headers.set('Content-Range', `bytes ${offset}-${end}/${total}`);
  headers.set('Content-Length', String(length));
  return new Response(object.body, { status: 206, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cookieName = env.COOKIE_NAME || DEFAULT_COOKIE;

    // CORS preflight (สำหรับ /__auth ที่เรียกแบบ credentials จาก frontend)
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    }

    if (url.pathname === '/__auth') {
      return handleAuth(req, url, env, cookieName);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return handleFile(req, url, env, cookieName);
    }

    return new Response('method not allowed', { status: 405 });
  },
} satisfies ExportedHandler<Env>;
