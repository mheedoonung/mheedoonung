// ตรวจ grant token ด้วย WebCrypto — ต้องตรงกับ format ของ backend (apps/backend/src/lib/crypto.ts hmacSign)
// format: <base64url(JSON payload)>.<base64url(HMAC-SHA256 ของสตริง base64url ก่อนหน้า)>
// payload ฝัง exp เป็น ms epoch (Date.now()-based)
// ไฟล์นี้ใช้แต่ WebCrypto/btoa/atob (ไม่มี dep ของ Cloudflare) -> นำไปเทสต์ใน Bun ได้ตรง ๆ

export interface GrantPayload {
  v: number; // เวอร์ชัน
  sub: string; // user id
  sid: string; // stream id
  key: string; // r2 object key ที่อนุญาต
  ip: string; // IP ที่ผูกไว้
  exp: number; // หมดอายุ (ms epoch)
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// bytes -> base64url (ไม่มี padding) — ตรงกับ toBase64Url ฝั่ง backend
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// base64url -> bytes
function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// เทียบ bytes แบบ constant-time (กัน timing attack)
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// ตรวจ token: คืน payload ถ้าลายเซ็นถูก + ยังไม่หมดอายุ; ไม่งั้นคืน null
export async function verifyGrant(token: string, secret: string): Promise<GrantPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const encoded = parts[0]!;
  const sig = parts[1]!;

  let key: CryptoKey;
  try {
    key = await importKey(secret);
  } catch {
    return null;
  }

  // recompute HMAC ของสตริง base64url (เป็น utf8 bytes) — ตรงกับ backend ที่ update(encoded)
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(encoded)));

  let got: Uint8Array;
  try {
    got = base64UrlToBytes(sig);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, got)) return null;

  let payload: GrantPayload;
  try {
    payload = JSON.parse(decoder.decode(base64UrlToBytes(encoded))) as GrantPayload;
  } catch {
    return null;
  }

  // เช็คหมดอายุ (exp เป็น ms epoch)
  if (typeof payload.exp === 'number' && Date.now() > payload.exp) return null;
  return payload;
}

// export helper ไว้เทสต์/ใช้ซ้ำ
export const __internal = { bytesToBase64Url, base64UrlToBytes, timingSafeEqual };
