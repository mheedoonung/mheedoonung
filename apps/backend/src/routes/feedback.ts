// routes/feedback — รับ feedback จาก user (เกณฑ์เด้งถามอยู่ฝั่ง frontend/localStorage ทั้งหมด)
// POST /feedback : ส่งคะแนน+chips+ข้อความ — user เดิมส่งซ้ำได้ไม่จำกัด
// GET  /admin/feedbacks(+/summary) : ฝั่ง admin ดูรายการ+สรุป (guard ด้วย currentAdmin)
import { Elysia, t } from 'elysia';
import { ObjectId } from 'mongodb';
import {
  FEEDBACK_TAGS,
  type ApiError,
  type FeedbackListResponse,
  type FeedbackSummaryResponse,
} from '@mheedoonung/shared';
import { sessionPlugin } from '../plugins/session';
import { collections } from '../db/mongo';
import { rateLimit } from '../lib/rateLimit';

const TAG_SET = new Set<string>(FEEDBACK_TAGS);

export const feedbackRoutes = new Elysia()
  .use(sessionPlugin)

  .post(
    '/feedback',
    async ({ currentUser, body, set }) => {
      if (!currentUser) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      // ส่งซ้ำได้ไม่จำกัดก็จริง แต่กันยิงรัว: 5 ครั้ง/10 นาที ต่อ user
      if (!rateLimit(`feedback:${currentUser._id}`, 5, 10 * 60_000)) {
        set.status = 429;
        return { error: 'too_many_requests', message: 'ส่งความเห็นบ่อยเกินไป ลองใหม่ภายหลัง' } satisfies ApiError;
      }

      const now = new Date().toISOString();
      const text = body.text?.trim().slice(0, 1000) || undefined;
      // เก็บเฉพาะ tag ใน whitelist (กันค่าประดิษฐ์เอง)
      const tags = (body.tags ?? []).filter((tag) => TAG_SET.has(tag));
      // เวลาดูที่ client รายงานเอง — เชื่อไม่ได้ 100% ใช้ประกอบการอ่านเท่านั้น (clamp กันค่าเพี้ยน)
      const watchSeconds = Math.max(0, Math.min(Math.floor(body.watchedSeconds ?? 0), 10_000_000));

      await collections.feedbacks.insertOne({
        userId: currentUser._id!,
        rating: body.rating,
        tags,
        ...(text ? { text } : {}),
        watchSeconds,
        createdAt: now,
      });
      return { ok: true };
    },
    {
      body: t.Object({
        rating: t.Integer({ minimum: 1, maximum: 5 }),
        tags: t.Optional(t.Array(t.String({ maxLength: 100 }), { maxItems: 10 })),
        text: t.Optional(t.String({ maxLength: 2000 })),
        watchedSeconds: t.Optional(t.Number({ minimum: 0 })),
      }),
    },
  )

  // GET /admin/feedbacks — รายการ feedback (ใหม่สุดก่อน) + ชื่อ user, filter ตามดาวได้
  .get(
    '/admin/feedbacks',
    async ({ currentAdmin, query, set }) => {
      if (!currentAdmin) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
      const filter: Record<string, unknown> = {};
      const rating = Number(query.rating);
      if (Number.isInteger(rating) && rating >= 1 && rating <= 5) filter.rating = rating;

      const [items, total] = await Promise.all([
        collections.feedbacks
          .find(filter as any)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
        collections.feedbacks.countDocuments(filter as any),
      ]);

      // ดึงชื่อ user แบบ batch ครั้งเดียว (feedback เก็บแค่ userId)
      const userIds = [...new Set(items.map((f) => f.userId))]
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));
      const users = userIds.length
        ? await collections.users.find({ _id: { $in: userIds } } as any).toArray()
        : [];
      const userMap = new Map(
        users.map((u) => [(u._id as unknown as ObjectId).toHexString(), u]),
      );

      return {
        items: items.map((f) => {
          const u = userMap.get(f.userId);
          return {
            id: (f._id as unknown as ObjectId).toHexString(),
            rating: f.rating,
            tags: f.tags,
            text: f.text,
            watchSeconds: f.watchSeconds,
            createdAt: f.createdAt,
            user: u ? { displayName: u.displayName, pictureUrl: u.pictureUrl } : null,
          };
        }),
        total,
        page,
        limit,
      } satisfies FeedbackListResponse;
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        rating: t.Optional(t.String()),
      }),
    },
  )

  // GET /admin/feedbacks/summary — จำนวนรวม + คะแนนเฉลี่ย + histogram ดาว + จำนวนต่อ tag
  .get('/admin/feedbacks/summary', async ({ currentAdmin, set }) => {
    if (!currentAdmin) {
      set.status = 401;
      return { error: 'unauthorized' } satisfies ApiError;
    }
    const [facet] = await collections.feedbacks
      .aggregate<{
        overall: { total: number; avg: number }[];
        byRating: { _id: number; count: number }[];
        byTag: { _id: string; count: number }[];
      }>([
        {
          $facet: {
            overall: [{ $group: { _id: null, total: { $sum: 1 }, avg: { $avg: '$rating' } } }],
            byRating: [{ $group: { _id: '$rating', count: { $sum: 1 } } }],
            byTag: [
              { $unwind: '$tags' },
              { $group: { _id: '$tags', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ],
          },
        },
      ])
      .toArray();

    const overall = facet?.overall[0];
    return {
      total: overall?.total ?? 0,
      avgRating: overall ? Math.round(overall.avg * 100) / 100 : null,
      byRating: (facet?.byRating ?? [])
        .map((r) => ({ rating: r._id, count: r.count }))
        .sort((a, b) => b.rating - a.rating),
      byTag: (facet?.byTag ?? []).map((tg) => ({ tag: tg._id, count: tg.count })),
    } satisfies FeedbackSummaryResponse;
  });
