// อ่านค่า config จาก environment variables ผ่าน module เดียวนี้เท่านั้น
// ค่า required ถ้าไม่มีจะใช้ dev default + console.warn (ไม่ throw เพื่อให้ dev ง่าย)

// helper: อ่าน string พร้อม default
function str(key: string, def: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? def : v;
}

// helper: อ่าน number พร้อม default
function num(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// helper: อ่าน boolean ('true'/'1' = true)
function bool(key: string, def: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1';
}

// helper: ค่า required — ถ้าไม่ตั้งให้ใช้ dev default แล้วเตือน (ไม่ throw)
function required(key: string, devDefault: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    console.warn(`[env] ไม่ได้ตั้งค่า ${key} — ใช้ค่า dev default ชั่วคราว (อย่าใช้ค่านี้ใน production)`);
    return devDefault;
  }
  return v;
}

const NODE_ENV = str('NODE_ENV', 'development');

// ค่า dev default ของ JWT_SECRET (ต้องห้ามใช้ใน production)
const JWT_SECRET_DEV_DEFAULT = 'dev-secret-change-me';
// ความยาวขั้นต่ำของ JWT_SECRET ที่ยอมรับใน production (กัน secret สั้นเกินจนเดาง่าย)
const JWT_SECRET_MIN_LENGTH = 32;

export const env = {
  NODE_ENV,
  // เซิร์ฟเวอร์
  PORT: num('PORT', 3000),

  // MongoDB
  MONGODB_URI: str('MONGODB_URI', 'mongodb://localhost:27017'),
  MONGODB_DB: str('MONGODB_DB', 'mheedoonung'),

  // App session
  JWT_SECRET: required('JWT_SECRET', 'dev-secret-change-me'),
  SESSION_COOKIE_NAME: str('SESSION_COOKIE_NAME', 'mdn_session'),
  ADMIN_COOKIE_NAME: str('ADMIN_COOKIE_NAME', 'mdn_admin'),
  // ใน production บังคับ secure=true เสมอ (กัน session cookie ถูกส่งผ่าน HTTP ธรรมดา)
  // dev ใช้ค่า default false เพื่อให้ทดสอบบน http://localhost ได้
  COOKIE_SECURE: NODE_ENV === 'production' ? true : bool('COOKIE_SECURE', false),
  // sameSite ของ cookie ('lax' | 'strict' | 'none')
  COOKIE_SAMESITE: str('COOKIE_SAMESITE', 'lax') as 'lax' | 'strict' | 'none',
  // ปล่อยว่าง => undefined
  COOKIE_DOMAIN: str('COOKIE_DOMAIN', '') || undefined,

  // Frontend / CORS
  FRONTEND_URL: str('FRONTEND_URL', 'http://localhost:5173'),
  CORS_ORIGINS: str('CORS_ORIGINS', 'http://localhost:5173'),

  // LINE Login
  LINE_CHANNEL_ID: required('LINE_CHANNEL_ID', ''),
  LINE_CHANNEL_SECRET: required('LINE_CHANNEL_SECRET', ''),
  LINE_LOGIN_REDIRECT_URI: str('LINE_LOGIN_REDIRECT_URI', 'http://localhost:3000/auth/line/callback'),

  // Admin (seed)
  ADMIN_USERNAME: str('ADMIN_USERNAME', 'admin'),
  ADMIN_PASSWORD: required('ADMIN_PASSWORD', 'changeme'),

  // Video (playback grant + video-worker) — VIDEO_GRANT_SECRET ต้องตรงกับ worker
  VIDEO_GRANT_SECRET: str('VIDEO_GRANT_SECRET', 'dev-video-secret-change-me'),
  VIDEO_BASE_URL: str('VIDEO_BASE_URL', 'http://localhost:8787'),
  VIDEO_TOKEN_TTL_SECONDS: num('VIDEO_TOKEN_TTL_SECONDS', 120),

  // ---- Dev only (เทสต์ local) — บังคับปิดใน production เสมอ ----
  // เปิด POST /auth/dev-login เพื่อเข้าระบบโดยไม่ต้องมี LINE channel (ตั้ง DEV_LOGIN_ENABLED=true ใน dev)
  DEV_LOGIN_ENABLED: NODE_ENV !== 'production' && bool('DEV_LOGIN_ENABLED', false),
} as const;

// helper: เช็คว่ารันใน production หรือไม่
export const isProd = (): boolean => env.NODE_ENV === 'production';

// ---- ตรวจความปลอดภัยตอนบูตใน production (หยุดบูตถ้า config ไม่ปลอดภัย) ----
// ทำตอน import เฉพาะเมื่อ isProd() เพื่อไม่ให้รบกวน dev (dev ยังใช้ค่า default + warn ได้)
if (isProd()) {
  const errors: string[] = [];

  // ค่า placeholder ใน *.env.example ทุกตัวขึ้นต้น/มีคำว่า 'CHANGE_ME' (เช่น
  //   CHANGE_ME_random_at_least_32_chars_xxxxxxxx) ซึ่งยาว >=32 และไม่ตรง dev default
  //   จึงผ่าน guard ความยาว/dev-default ได้ทั้งหมด ถ้า operator ลืม replace
  //   secret เหล่านี้จะกลายเป็นค่าที่อยู่ใน repo (world-readable) -> ใครก็ปลอม session/grant ได้
  // helper: secret ที่ยังเป็น placeholder 'CHANGE_ME' ถือว่าไม่ปลอดภัย (reject ทันที)
  const isPlaceholder = (v: string): boolean => v.includes('CHANGE_ME');

  // JWT_SECRET ห้ามเป็นค่า dev default ที่รู้กันทั้งโลก, ห้ามเป็น placeholder CHANGE_ME และต้องยาวพอ (>= 32 ตัว)
  if (env.JWT_SECRET === JWT_SECRET_DEV_DEFAULT) {
    errors.push('JWT_SECRET ยังเป็นค่า dev default — ต้องตั้งค่าจริงใน production');
  } else if (isPlaceholder(env.JWT_SECRET)) {
    errors.push("JWT_SECRET ยังเป็นค่า placeholder (มีคำว่า 'CHANGE_ME') — ต้องแทนด้วยค่าสุ่มจริงใน production");
  } else if (env.JWT_SECRET.length < JWT_SECRET_MIN_LENGTH) {
    errors.push(`JWT_SECRET สั้นเกินไป (ต้องยาวอย่างน้อย ${JWT_SECRET_MIN_LENGTH} ตัวใน production)`);
  }

  // COOKIE_SECURE ถูกบังคับเป็น true ใน prod อยู่แล้ว — กันกรณีโค้ดถูกแก้ในอนาคต
  if (!env.COOKIE_SECURE) {
    errors.push('COOKIE_SECURE ต้องเป็น true ใน production');
  }

  // VIDEO_GRANT_SECRET (ใช้เซ็น grant ของวิดีโอ) ห้ามเป็นค่า dev default/placeholder + ต้องยาวพอ
  // ต้องตรงกับ secret ที่ตั้งใน video-worker (ดู apps/video-worker) ไม่งั้น worker จะ verify ไม่ผ่าน
  if (env.VIDEO_GRANT_SECRET === 'dev-video-secret-change-me') {
    errors.push('VIDEO_GRANT_SECRET ยังเป็นค่า dev default — ต้องตั้งค่าจริงใน production');
  } else if (isPlaceholder(env.VIDEO_GRANT_SECRET)) {
    errors.push("VIDEO_GRANT_SECRET ยังเป็นค่า placeholder (มีคำว่า 'CHANGE_ME') — ต้องแทนด้วยค่าสุ่มจริงใน production");
  } else if (env.VIDEO_GRANT_SECRET.length < JWT_SECRET_MIN_LENGTH) {
    errors.push(`VIDEO_GRANT_SECRET สั้นเกินไป (ต้องยาวอย่างน้อย ${JWT_SECRET_MIN_LENGTH} ตัวใน production)`);
  }

  // ADMIN_PASSWORD ห้ามเป็นค่า dev default ('changeme') หรือ placeholder CHANGE_ME ใน production
  //   (placeholder ใน backend.env.example คือ CHANGE_ME_admin_strong_password)
  if (env.ADMIN_PASSWORD === 'changeme') {
    errors.push('ADMIN_PASSWORD ยังเป็นค่า dev default — ต้องตั้งค่าจริงใน production');
  } else if (isPlaceholder(env.ADMIN_PASSWORD)) {
    errors.push("ADMIN_PASSWORD ยังเป็นค่า placeholder (มีคำว่า 'CHANGE_ME') — ต้องตั้งรหัสจริงใน production");
  }

  // VIDEO_BASE_URL ต้องเป็น absolute https URL (origin ของ video-worker) ใน production
  //   ถ้าว่าง buildPlaybackTokens จะสร้าง relative URL ('/__auth?...', '/<r2Key>')
  //   ซึ่ง frontend จะ resolve ไปยัง origin ตัวเอง (ไม่ใช่ worker) -> playback พัง
  //   และ grant ในคิวรีอาจหลุดไปยัง origin ที่ไม่ตั้งใจ
  if (!env.VIDEO_BASE_URL) {
    errors.push('VIDEO_BASE_URL ต้องตั้งเป็น URL ของ video-worker ใน production (ห้ามว่าง)');
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(env.VIDEO_BASE_URL);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== 'https:') {
      errors.push('VIDEO_BASE_URL ต้องเป็น absolute https URL ใน production');
    }
  }

  if (errors.length > 0) {
    throw new Error(`[env] config ไม่ปลอดภัยสำหรับ production:\n - ${errors.join('\n - ')}`);
  }
}
