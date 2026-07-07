// routes/reports — user แจ้งปัญหาเข้ามาเอง (ปุ่ม "แจ้งปัญหา" บนหน้าเว็บ)
// POST /reports                    : ส่งหมวด+รายละเอียด (+context ช่วย debug)
// GET  /admin/reports?status&page  : admin ดูรายการ (default เรียง open ใหม่สุดก่อน)
// POST /admin/reports/:id/status   : admin กดจัดการแล้ว/เปิดใหม่
import { Elysia, t } from 'elysia';
import { ObjectId } from 'mongodb';
import {
  REPORT_CATEGORIES,
  type ApiError,
  type ReportListResponse,
  type ReportStatus,
} from '@mheedoonung/shared';
import { sessionPlugin } from '../plugins/session';
import { collections } from '../db/mongo';
import { rateLimit } from '../lib/rateLimit';

const CATEGORY_SET = new Set<string>(REPORT_CATEGORIES);

export const reportRoutes = new Elysia()
  .use(sessionPlugin)

  .post(
    '/reports',
    async ({ currentUser, body, request, set }) => {
      if (!currentUser) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      // กันยิงรัว: 5 ครั้ง/10 นาที ต่อ user (แบบเดียวกับ /feedback)
      if (!rateLimit(`report:${currentUser._id}`, 5, 10 * 60_000)) {
        set.status = 429;
        return { error: 'too_many_requests', message: 'แจ้งปัญหาบ่อยเกินไป ลองใหม่ภายหลัง' } satisfies ApiError;
      }
      if (!CATEGORY_SET.has(body.category)) {
        set.status = 400;
        return { error: 'invalid_category' } satisfies ApiError;
      }
      const text = body.text.trim().slice(0, 2000);
      if (!text) {
        set.status = 400;
        return { error: 'text_required', message: 'กรุณาพิมพ์รายละเอียดปัญหา' } satisfies ApiError;
      }

      const now = new Date().toISOString();
      await collections.reports.insertOne({
        userId: currentUser._id!,
        category: body.category,
        text,
        context: {
          ...(body.path ? { path: body.path.slice(0, 300) } : {}),
          ...(body.movieSlug ? { movieSlug: body.movieSlug.slice(0, 200) } : {}),
          // userAgent อ่านจาก header ฝั่ง server เอง — client ปลอมยากกว่า+ไม่ต้องส่งมา
          ...(request.headers.get('user-agent')
            ? { userAgent: request.headers.get('user-agent')!.slice(0, 300) }
            : {}),
        },
        status: 'open',
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true };
    },
    {
      body: t.Object({
        category: t.String({ maxLength: 100 }),
        text: t.String({ minLength: 1, maxLength: 4000 }),
        path: t.Optional(t.String({ maxLength: 500 })),
        movieSlug: t.Optional(t.String({ maxLength: 300 })),
      }),
    },
  )

  // GET /admin/reports — รายการแจ้งปัญหา + ชื่อ user, filter ตาม status ได้
  .get(
    '/admin/reports',
    async ({ currentAdmin, query, set }) => {
      if (!currentAdmin) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
      const filter: Record<string, unknown> = {};
      if (query.status === 'open' || query.status === 'resolved') filter.status = query.status;

      const [items, total, openCount] = await Promise.all([
        collections.reports
          .find(filter as any)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
        collections.reports.countDocuments(filter as any),
        collections.reports.countDocuments({ status: 'open' }),
      ]);

      // ดึงชื่อ user แบบ batch ครั้งเดียว (แบบเดียวกับ /admin/feedbacks)
      const userIds = [...new Set(items.map((r) => r.userId))]
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));
      const users = userIds.length
        ? await collections.users.find({ _id: { $in: userIds } } as any).toArray()
        : [];
      const userMap = new Map(
        users.map((u) => [(u._id as unknown as ObjectId).toHexString(), u]),
      );

      return {
        items: items.map((r) => {
          const u = userMap.get(r.userId);
          return {
            id: (r._id as unknown as ObjectId).toHexString(),
            category: r.category,
            text: r.text,
            context: r.context,
            status: r.status,
            createdAt: r.createdAt,
            user: u ? { displayName: u.displayName, pictureUrl: u.pictureUrl } : null,
          };
        }),
        total,
        page,
        limit,
        openCount,
      } satisfies ReportListResponse;
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )

  // POST /admin/reports/:id/status — สลับสถานะ จัดการแล้ว/เปิดใหม่
  .post(
    '/admin/reports/:id/status',
    async ({ currentAdmin, params, body, set }) => {
      if (!currentAdmin) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      if (!ObjectId.isValid(params.id)) {
        set.status = 404;
        return { error: 'not_found' } satisfies ApiError;
      }
      const res = await collections.reports.updateOne({ _id: new ObjectId(params.id) } as any, {
        $set: { status: body.status as ReportStatus, updatedAt: new Date().toISOString() },
      });
      if (res.matchedCount === 0) {
        set.status = 404;
        return { error: 'not_found' } satisfies ApiError;
      }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ status: t.Union([t.Literal('open'), t.Literal('resolved')]) }),
    },
  );
