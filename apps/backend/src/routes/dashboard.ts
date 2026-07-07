// routes/dashboard — สรุปการใช้งานสำหรับ admin (อ่านจาก dailyStats ที่นับสะสมไว้แล้วเท่านั้น)
// GET /admin/dashboard?view=daily|monthly
// เบาโดยออกแบบ: รายวัน = find ≤30 docs, รายเดือน = find ≤366 docs จิ๋ว — ไม่มี aggregate บน collection ใหญ่
import { Elysia, t } from 'elysia';
import type { ApiError, DashboardResponse, StatPoint } from '@mheedoonung/shared';
import { sessionPlugin } from '../plugins/session';
import { collections } from '../db/mongo';
import { bkkDay } from '../lib/stats';

const DAILY_POINTS = 30;
const MONTHLY_POINTS = 12;

function zeroPoint(key: string): StatPoint {
  return { key, plays: 0, activeUsers: 0, newUsers: 0, redeems: 0, daysSold: 0 };
}

// รวมค่าจาก doc (field ใน DB เป็น optional — ไม่มี = 0)
function addDoc(p: StatPoint, d: Record<string, unknown>): void {
  p.plays += Number(d.plays) || 0;
  p.activeUsers += Number(d.activeUsers) || 0;
  p.newUsers += Number(d.newUsers) || 0;
  p.redeems += Number(d.redeems) || 0;
  p.daysSold += Number(d.daysSold) || 0;
}

export const dashboardRoutes = new Elysia()
  .use(sessionPlugin)

  .get(
    '/admin/dashboard',
    async ({ currentAdmin, query, set }) => {
      if (!currentAdmin) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      const view = query.view === 'monthly' ? 'monthly' : 'daily';
      const todayKey = bkkDay();

      // รายเดือน: สร้างรายชื่อเดือน (เก่า -> ใหม่ รวมเดือนนี้) ก่อน แล้วใช้เดือนแรกเป็นขอบล่าง
      // ของ query — ช่วงอ่านตรงกับหน้าต่างที่แสดงเป๊ะ (setUTCDate(1) ก่อนถอยเดือน กัน overflow วันที่ 29-31)
      const months: string[] = Array.from({ length: MONTHLY_POINTS }, (_, i) => {
        const d = new Date(Date.now() + 7 * 3_600_000);
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() - (MONTHLY_POINTS - 1 - i));
        return d.toISOString().slice(0, 7);
      });

      const startKey =
        view === 'daily' ? bkkDay(Date.now() - (DAILY_POINTS - 1) * 86_400_000) : `${months[0]}-01`;

      const docs = await collections.dailyStats
        .find({ _id: { $gte: startKey, $lte: todayKey } })
        .toArray();
      const byId = new Map(docs.map((d) => [d._id, d]));

      // สรุปวันนี้ (มีเสมอแม้ยังไม่มี event)
      const today = zeroPoint(todayKey);
      const todayDoc = byId.get(todayKey);
      if (todayDoc) addDoc(today, todayDoc as unknown as Record<string, unknown>);

      let series: StatPoint[];
      if (view === 'daily') {
        // ไล่ครบ 30 วัน เติมศูนย์วันที่ไม่มี doc — กราฟไม่มีรูโหว่
        series = Array.from({ length: DAILY_POINTS }, (_, i) => {
          const key = bkkDay(Date.now() - (DAILY_POINTS - 1 - i) * 86_400_000);
          const p = zeroPoint(key);
          const d = byId.get(key);
          if (d) addDoc(p, d as unknown as Record<string, unknown>);
          return p;
        });
      } else {
        // group รายเดือนจาก docs รายวัน (ใน JS — docs จิ๋ว ไม่กี่ร้อยตัว)
        const byMonth = new Map(months.map((m) => [m, zeroPoint(m)]));
        for (const d of docs) {
          const p = byMonth.get(d._id.slice(0, 7));
          if (p) addDoc(p, d as unknown as Record<string, unknown>);
        }
        series = months.map((m) => byMonth.get(m)!);
      }

      return { view, today, series } satisfies DashboardResponse;
    },
    {
      query: t.Object({
        view: t.Optional(t.String()),
      }),
    },
  );
