// lib/stats — ตัวนับสถิติรายวันขับ dashboard (pre-aggregated counters)
// *กติกาเหล็ก*: สถิติห้ามกระทบ flow หลัก (playback/redeem/login) เด็ดขาด
//   - ทุกฟังก์ชันกลืน error เองทั้งหมด (try/catch ครอบทั้งตัว) — ไม่มีทาง throw ถึงผู้เรียก
//   - ผู้เรียกใช้แบบ `void trackXxx(...)` เสมอ (fire-and-forget ไม่ await) — ไม่เพิ่ม latency
// โครงข้อมูล: dailyStats 1 doc/วัน (_id = 'YYYY-MM-DD' เวลาไทย) → อ่าน dashboard = find ไม่กี่ doc
import { collections } from '../db/mongo';

// ตัดวันตามเวลาไทย (UTC+7) — ยอดรายวันตรงปฏิทินฝั่งคนขาย ไม่คร่อมเที่ยงคืน UTC
export function bkkDay(ts: number = Date.now()): string {
  return new Date(ts + 7 * 3_600_000).toISOString().slice(0, 10);
}

// $inc ลง doc ของวันนั้น (upsert — วันแรกที่มี event จะเกิด doc เอง)
async function inc(day: string, fields: Record<string, number>): Promise<void> {
  await collections.dailyStats.updateOne({ _id: day }, { $inc: fields }, { upsert: true });
}

// user กดเริ่มดูหนัง 1 ครั้ง (+นับ user ไม่ซ้ำครั้งแรกของวัน)
export async function trackPlay(userId: string): Promise<void> {
  try {
    const day = bkkDay();
    const fields: Record<string, number> = { plays: 1 };
    try {
      // marker ต่อ (วัน,user) — insert ผ่าน = ครั้งแรกของวันนี้ (duplicate = เคยนับแล้ว)
      await collections.dailyActive.insertOne({ _id: `${day}:${userId}`, createdAt: new Date() });
      fields.activeUsers = 1;
    } catch {
      // duplicate key (นับแล้ว) หรือ error อื่น — ข้ามการนับ unique ไป plays ยังนับต่อ
    }
    await inc(day, fields);
  } catch {
    // เงียบสนิท — สถิติพลาดได้ playback ห้ามสะเทือน
  }
}

// เติมบัตรสำเร็จ (daysSold = จำนวนวันของบัตร ไว้ดูยอดขาย)
export async function trackRedeem(daysAdded: number): Promise<void> {
  try {
    await inc(bkkDay(), { redeems: 1, daysSold: daysAdded });
  } catch {
    // เงียบ
  }
}

// user สมัครใหม่ (สร้าง doc ครั้งแรกจาก LINE login)
export async function trackNewUser(): Promise<void> {
  try {
    await inc(bkkDay(), { newUsers: 1 });
  } catch {
    // เงียบ
  }
}
