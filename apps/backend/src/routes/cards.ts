// route ระบบบัตร: เติมบัตร (user) + จัดการบัตร (admin)
// ทุก error response เป็นรูปแบบ ApiError {error, message?}
import { Elysia, t } from 'elysia';
import type {
  ApiError,
  RedeemResponse,
  CreateCardsResponse,
  CardListResponse,
  CardStatus,
} from '@mheedoonung/shared';
import { sessionPlugin } from '../plugins/session';
import {
  createCards,
  redeemCard,
  listCards,
  revokeCard,
  RedeemError,
  RevokeError,
  type RedeemErrorCode,
} from '../services/card.service';

// map RedeemError code -> HTTP status (invalid_code=400, already_used/revoked=409)
function redeemStatus(code: RedeemErrorCode): number {
  return code === 'invalid_code' ? 400 : 409;
}

export const cardRoutes = new Elysia()
  // ใช้ session plugin ร่วม (ให้ context: currentUser/currentAdmin + ออก session ฯลฯ)
  .use(sessionPlugin)

  // ---- USER: เติมบัตร ----
  // POST /cards/redeem {code} -> ต้องมี currentUser
  .post(
    '/cards/redeem',
    async ({ body, currentUser, set }) => {
      // ต้อง login เป็น user ก่อน
      if (!currentUser) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      try {
        const { accessExpiresAt, daysAdded } = await redeemCard(body.code, currentUser);
        const res: RedeemResponse = { ok: true, accessExpiresAt, daysAdded };
        return res;
      } catch (err) {
        // error ที่รู้จัก (invalid/used/revoked) -> map status + ApiError
        if (err instanceof RedeemError) {
          set.status = redeemStatus(err.code);
          return { error: err.code, message: err.message } satisfies ApiError;
        }
        // error อื่น -> 500
        set.status = 500;
        return { error: 'internal_error', message: 'เกิดข้อผิดพลาดในการเติมบัตร' } satisfies ApiError;
      }
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1 }),
      }),
    },
  )

  // ---- ADMIN: สร้างบัตร ----
  // POST /admin/cards {days, quantity, note?} -> ต้องมี currentAdmin (201)
  .post(
    '/admin/cards',
    async ({ body, currentAdmin, set }) => {
      if (!currentAdmin) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      try {
        // createdBy = username ของ admin (สื่อความหมายกว่า id)
        const codes = await createCards(body, currentAdmin.username);
        set.status = 201;
        const res: CreateCardsResponse = { created: codes.length, codes };
        return res;
      } catch (err) {
        set.status = 400;
        const message = err instanceof Error ? err.message : 'สร้างบัตรไม่สำเร็จ';
        return { error: 'create_failed', message } satisfies ApiError;
      }
    },
    {
      body: t.Object({
        days: t.Integer({ minimum: 1 }),
        quantity: t.Integer({ minimum: 1, maximum: 1000 }),
        note: t.Optional(t.String()),
      }),
    },
  )

  // ---- ADMIN: ลิสต์บัตร ----
  // GET /admin/cards?status&page&limit -> ต้องมี currentAdmin
  .get(
    '/admin/cards',
    async ({ query, currentAdmin, set }) => {
      if (!currentAdmin) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      const res: CardListResponse = await listCards({
        status: query.status as CardStatus | undefined,
        page: query.page,
        limit: query.limit,
      });
      return res;
    },
    {
      query: t.Object({
        status: t.Optional(
          t.Union([t.Literal('unused'), t.Literal('redeemed'), t.Literal('revoked')]),
        ),
        page: t.Optional(t.Numeric({ minimum: 1 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
      }),
    },
  )

  // ---- ADMIN: ยกเลิกบัตร ----
  // POST /admin/cards/:code/revoke -> ต้องมี currentAdmin
  .post(
    '/admin/cards/:code/revoke',
    async ({ params, currentAdmin, set }) => {
      if (!currentAdmin) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      try {
        const res = await revokeCard(params.code);
        return res;
      } catch (err) {
        if (err instanceof RevokeError) {
          // invalid_code -> 404, not_revocable -> 409
          set.status = err.code === 'invalid_code' ? 404 : 409;
          return { error: err.code, message: err.message } satisfies ApiError;
        }
        set.status = 500;
        return { error: 'internal_error', message: 'ยกเลิกบัตรไม่สำเร็จ' } satisfies ApiError;
      }
    },
    {
      params: t.Object({
        code: t.String({ minLength: 1 }),
      }),
    },
  );
