// lib/accessTime — ต่อเวลาการใช้งาน user แบบ atomic: accessExpiresAt = max(now, เดิม) + addedMs
// ใช้ aggregation-pipeline update ให้ฐานอ่านจาก '$accessExpiresAt' ปัจจุบันใน DB เสมอ (ไม่ใช่ snapshot จาก session)
// กัน lost-update เมื่อ user เดียวกันได้เวลาเพิ่มจากสองทางพร้อมกัน (เช่น เติมบัตรสองใบพร้อมกัน)
// ใช้ร่วมกันทั้ง card.service.ts (เติมบัตร) และ routes/feedback.ts (รางวัล feedback)
import { collections } from '../db/mongo';

// filter ต้องระบุ user ที่ต้องการ (เช่น {_id}) — ใส่เงื่อนไขเพิ่มได้เพื่อกัน update ซ้ำแบบ atomic
// (เช่น {feedbackRewardVersion: {$ne: CURRENT_VERSION}} กันรับรางวัลซ้ำตอนยิงพร้อมกันสองแท็บ)
// ไม่ match (เช่นรับรางวัลไปแล้ว) -> คืน null แทนการ throw เพื่อให้ caller ตัดสินใจเอง
export async function extendUserAccess(
  filter: Record<string, unknown>,
  addedMs: number,
  extraSet: Record<string, unknown> = {},
): Promise<string | null> {
  const nowMs = Date.now();
  const result = await collections.users.findOneAndUpdate(
    filter as any,
    [
      {
        $set: {
          accessExpiresAt: {
            $toString: {
              $toDate: {
                $add: [
                  {
                    // ฐาน = max(now, เดิมถ้ายังไม่หมด) — ถ้า accessExpiresAt เป็น null ให้ใช้ 0
                    $max: [
                      nowMs,
                      { $ifNull: [{ $toLong: { $toDate: '$accessExpiresAt' } }, 0] },
                    ],
                  },
                  addedMs,
                ],
              },
            },
          },
          updatedAt: new Date(nowMs).toISOString(),
          ...extraSet,
        },
      },
    ],
    { returnDocument: 'after' },
  );
  return result?.accessExpiresAt ?? null;
}
