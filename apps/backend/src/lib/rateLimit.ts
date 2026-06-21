// rate limit แบบ fixed-window เก็บใน memory — กัน brute-force ที่ admin login / redeem
// ponytail: in-memory ใน process เดียว (backend = single host) พอแล้ว; หลาย instance ค่อยย้ายไป Redis
//           key ที่ idle จะค้างจนถูกแตะรอบหน้า (ไม่มี sweep) — ที่สเกลนี้ไม่เป็นปัญหา
const buckets = new Map<string, { count: number; resetAt: number }>();

// คืน true = ผ่าน (ยังไม่เกินโควตา), false = เกิน (ผู้เรียกควรตอบ 429)
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}
