// routes/followup — หน้า "ติดตามลูกค้า" ของ admin: user ที่สิทธิ์ใกล้หมด/เพิ่งหมด ไว้ follow ขายซ้ำ
// GET /admin/followup?soonDays=3&expiredDays=7
// หมายเหตุ: accessExpiresAt เก็บเป็น ISO string — เทียบช่วงด้วย string ได้ตรง ๆ (format เดียวกันเสมอ)
//   และ null (ไม่เคย active) ไม่ติด $gt/$lte ของ string อยู่แล้วตาม BSON ordering
import { Elysia, t } from 'elysia';
import { ObjectId } from 'mongodb';
import type { ApiError, FollowupResponse, FollowupUserItem, User } from '@mheedoonung/shared';
import { sessionPlugin } from '../plugins/session';
import { collections } from '../db/mongo';

// กันดึงลิสต์ยาวเกิน — กลุ่มเป้าหมาย follow-up ควรแคบ ถ้าชนเพดานให้ admin ลดช่วงวัน
const LIMIT_PER_GROUP = 200;

function toItem(u: User & { _id?: unknown }): FollowupUserItem {
  return {
    id: (u._id as unknown as ObjectId).toHexString(),
    displayName: u.displayName,
    pictureUrl: u.pictureUrl,
    lineUserId: u.lineUserId,
    accessExpiresAt: u.accessExpiresAt!,
    createdAt: u.createdAt,
  };
}

export const followupRoutes = new Elysia()
  .use(sessionPlugin)

  .get(
    '/admin/followup',
    async ({ currentAdmin, query, set }) => {
      if (!currentAdmin) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      // clamp ช่วงวัน 1-90 (default: ใกล้หมดใน 3 วัน / เพิ่งหมดไม่เกิน 7 วัน)
      const soonDays = Math.min(90, Math.max(1, Number(query.soonDays) || 3));
      const expiredDays = Math.min(90, Math.max(1, Number(query.expiredDays) || 7));

      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const soonUntilIso = new Date(now + soonDays * 86_400_000).toISOString();
      const expiredSinceIso = new Date(now - expiredDays * 86_400_000).toISOString();

      const [soon, expired] = await Promise.all([
        collections.users
          .find({ accessExpiresAt: { $gt: nowIso, $lte: soonUntilIso } } as any)
          .sort({ accessExpiresAt: 1 }) // หมดก่อน = ต้องรีบทักก่อน
          .limit(LIMIT_PER_GROUP)
          .toArray(),
        collections.users
          .find({ accessExpiresAt: { $gt: expiredSinceIso, $lte: nowIso } } as any)
          .sort({ accessExpiresAt: -1 }) // เพิ่งหมดสุด = ยังร้อนอยู่ ทักก่อน
          .limit(LIMIT_PER_GROUP)
          .toArray(),
      ]);

      return {
        soonDays,
        expiredDays,
        expiringSoon: soon.map((u) => toItem(u as any)),
        recentlyExpired: expired.map((u) => toItem(u as any)),
      } satisfies FollowupResponse;
    },
    {
      query: t.Object({
        soonDays: t.Optional(t.String()),
        expiredDays: t.Optional(t.String()),
      }),
    },
  );
