// backfill dailyStats ย้อนหลังจากข้อมูลที่มีอยู่แล้ว (รันครั้งเดียวหลัง deploy dashboard)
//   - newUsers  จาก users.createdAt
//   - redeems/daysSold จาก cards.redeemedAt
// plays/activeUsers ย้อนหลังไม่ได้ (ไม่เคยเก็บ log) — เริ่มนับจากวัน deploy
// *idempotent*: ใช้ $set ค่าที่คำนวณใหม่ทั้งก้อน — รันซ้ำกี่รอบผลเท่าเดิม ไม่นับเบิ้ล
// วิธีรัน: cd apps/backend && bun src/scripts/backfillStats.ts
import { connectMongo, collections } from '../db/mongo';
import { bkkDay } from '../lib/stats';

await connectMongo();

// ---- newUsers ต่อวัน ----
const users = await collections.users.find({}, { projection: { createdAt: 1 } }).toArray();
const newUsersByDay = new Map<string, number>();
for (const u of users) {
  const t = new Date(u.createdAt).getTime();
  if (!Number.isFinite(t)) continue;
  const day = bkkDay(t);
  newUsersByDay.set(day, (newUsersByDay.get(day) ?? 0) + 1);
}

// ---- redeems/daysSold ต่อวัน ----
const redeemed = await collections.cards
  .find({ status: 'redeemed', redeemedAt: { $ne: null } }, { projection: { redeemedAt: 1, days: 1 } })
  .toArray();
const redeemsByDay = new Map<string, { redeems: number; daysSold: number }>();
for (const c of redeemed) {
  const t = new Date(c.redeemedAt!).getTime();
  if (!Number.isFinite(t)) continue;
  const day = bkkDay(t);
  const cur = redeemsByDay.get(day) ?? { redeems: 0, daysSold: 0 };
  cur.redeems += 1;
  cur.daysSold += c.days;
  redeemsByDay.set(day, cur);
}

// ---- เขียนลง dailyStats (แยก field — ไม่แตะ plays/activeUsers ที่มาจาก counter จริง) ----
// ข้าม "วันนี้": counter สดกำลังนับอยู่ ถ้า $set ทับจะกินยอดที่เกิดระหว่างสคริปต์รัน
const todayKey = bkkDay();
const days = [...new Set([...newUsersByDay.keys(), ...redeemsByDay.keys()])].filter(
  (d) => d < todayKey,
);
for (const day of days) {
  const setFields: Record<string, number> = {};
  const nu = newUsersByDay.get(day);
  if (nu !== undefined) setFields.newUsers = nu;
  const rd = redeemsByDay.get(day);
  if (rd) {
    setFields.redeems = rd.redeems;
    setFields.daysSold = rd.daysSold;
  }
  await collections.dailyStats.updateOne({ _id: day }, { $set: setFields }, { upsert: true });
}

console.log(
  `[backfill] เสร็จ: ${days.length} วัน (users ${users.length} คน, บัตรที่ถูกเติม ${redeemed.length} ใบ, ข้ามวันนี้ ${todayKey})`,
);
process.exit(0);
