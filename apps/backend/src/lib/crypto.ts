// ฟังก์ชัน crypto ที่ใช้ร่วมกัน: รหัสบัตร, hash รหัสผ่าน, HMAC (เผื่อเฟสวิดีโอ)
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

// Crockford base32 alphabet — ตัด I, L, O, U ออก (กันสับสน)
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// สร้างรหัสบัตรรูปแบบ XXXX-XXXX-XXXX (12 ตัวอักษร) จาก random bytes
export function generateCardCode(): string {
  // ต้องการ 12 อักขระจาก alphabet 32 ตัว — ใช้ random bytes แล้ว map ทีละ byte
  const bytes = randomBytes(12);
  let chars = '';
  for (let i = 0; i < 12; i++) {
    // map ค่า byte (0-255) เข้าช่วง 0-31 ของ alphabet
    chars += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  // จัดกลุ่ม 4-4-4 คั่นด้วย dash
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

// normalize รหัสที่ผู้ใช้กรอก: uppercase, ตัด non-alphanumeric, จัดกลุ่ม 4-4-4 ใหม่
// ผลลัพธ์มีรูปแบบเดียวกับตอน generate (ถ้าความยาวพอ)
export function normalizeCardCode(input: string): string {
  // เก็บเฉพาะ 0-9 A-Z (uppercase ก่อน)
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  // จัดกลุ่มทีละ 4 ตัว
  const groups = cleaned.match(/.{1,4}/g) ?? [];
  return groups.join('-');
}

// hash รหัสผ่านด้วย argon2id (ผ่าน Bun.password)
export async function hashPassword(pw: string): Promise<string> {
  return Bun.password.hash(pw, { algorithm: 'argon2id' });
}

// ตรวจรหัสผ่านกับ hash
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return Bun.password.verify(pw, hash);
}

// ---- HMAC (เผื่อเฟสวิดีโอ — เขียนพร้อมไว้แต่ยังไม่ถูกเรียกในเฟสนี้) ----

// แปลง Buffer/string -> base64url (ไม่มี padding)
function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// แปลง base64url -> Buffer
function fromBase64Url(input: string): Buffer {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

// เซ็น payload เป็น token รูปแบบ: <base64url(payloadJson)>.<base64url(hmac)>
// payload จะถูกฝัง exp (ms epoch) ไว้ด้วยถ้ามี ttlSeconds
export function hmacSign(
  payloadObj: Record<string, unknown>,
  secret: string,
  ttlSeconds?: number,
): string {
  const payload = ttlSeconds
    ? { ...payloadObj, exp: Date.now() + ttlSeconds * 1000 }
    : payloadObj;
  const json = JSON.stringify(payload);
  const encoded = toBase64Url(json);
  const sig = createHmac('sha256', secret).update(encoded).digest();
  return `${encoded}.${toBase64Url(sig)}`;
}

// ตรวจ token: คืน payload ถ้าลายเซ็นถูกและยังไม่หมดอายุ; ไม่งั้นคืน null
export function hmacVerify(
  token: string,
  secret: string,
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts as [string, string];

  const expected = createHmac('sha256', secret).update(encoded).digest();
  const got = fromBase64Url(sig);
  // เปรียบเทียบแบบ constant-time กัน timing attack
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encoded).toString('utf8')) as Record<string, unknown>;
    // เช็ค exp ถ้ามี
    if (typeof payload.exp === 'number' && Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
