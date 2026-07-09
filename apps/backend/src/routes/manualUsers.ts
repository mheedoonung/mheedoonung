// routes/manualUsers — admin สร้าง/ลิสต์ user "สมัครมือ" (ลูกค้าไม่มี LINE เข้าระบบไม่ได้)
// authMethod:'manual' + username/passwordHash แทน LINE — เข้าระบบผ่าน POST /auth/manual-login
// (หน้า /login เดียวกับ user หลัก มี toggle ซ่อนไว้ — ไม่แยกหน้าเพราะ ProtectedRoute redirect ไป /login คงที่)
import { Elysia, t } from 'elysia';
import { ObjectId } from 'mongodb';
import type { ApiError, ManualUserListItem, ManualUserListResponse } from '@mheedoonung/shared';
import { collections } from '../db/mongo';
import { hashPassword } from '../lib/crypto';
import { sessionPlugin } from '../plugins/session';

function toItem(u: { _id: ObjectId; username?: string; displayName: string; note?: string; accessExpiresAt: string | null; createdAt: string }): ManualUserListItem {
  return {
    id: u._id.toHexString(),
    username: u.username ?? '',
    displayName: u.displayName,
    note: u.note,
    accessExpiresAt: u.accessExpiresAt,
    createdAt: u.createdAt,
  };
}

export const manualUserRoutes = new Elysia()
  .use(sessionPlugin)

  // GET /admin/manual-users — ลิสต์ user สมัครมือทั้งหมด เรียงสร้างล่าสุดก่อน
  .get('/admin/manual-users', async ({ currentAdmin, set }) => {
    if (!currentAdmin) {
      set.status = 401;
      return { error: 'unauthorized' } satisfies ApiError;
    }
    const docs = await collections.users
      .find({ authMethod: 'manual' } as any)
      .sort({ createdAt: -1 })
      .toArray();
    return { items: docs.map((d) => toItem(d as any)) } satisfies ManualUserListResponse;
  })

  // POST /admin/manual-users {username, password, displayName} — สร้าง user สมัครมือใหม่
  .post(
    '/admin/manual-users',
    async ({ body, currentAdmin, set }) => {
      if (!currentAdmin) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }

      const username = body.username.trim();
      const displayName = body.displayName.trim();
      if (!username || !displayName) {
        set.status = 400;
        return { error: 'invalid_body', message: 'กรอกชื่อผู้ใช้และชื่อที่แสดงให้ครบ' } satisfies ApiError;
      }

      const now = new Date().toISOString();
      const passwordHash = await hashPassword(body.password);
      const note = body.note?.trim() || undefined;

      try {
        const doc: Record<string, unknown> = {
          lineUserId: `manual:${username}`,
          authMethod: 'manual',
          username,
          passwordHash,
          displayName,
          accessExpiresAt: null,
          createdAt: now,
          updatedAt: now,
        };
        if (note) doc.note = note;
        const result = await collections.users.insertOne(doc as any);
        return toItem({ _id: result.insertedId, username, displayName, note, accessExpiresAt: null, createdAt: now });
      } catch (err) {
        // E11000 — username ชนกับที่มีอยู่แล้ว
        if ((err as { code?: number }).code === 11000) {
          set.status = 409;
          return { error: 'username_taken', message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' } satisfies ApiError;
        }
        throw err;
      }
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 50 }),
        password: t.String({ minLength: 6 }),
        displayName: t.String({ minLength: 1, maxLength: 100 }),
        note: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )

  // POST /admin/manual-users/:id/password — admin ตั้งรหัสผ่านใหม่ให้ user สมัครมือ (ลืม/อยากเปลี่ยน)
  .post(
    '/admin/manual-users/:id/password',
    async ({ params, body, currentAdmin, set }) => {
      if (!currentAdmin) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      if (!ObjectId.isValid(params.id)) {
        set.status = 400;
        return { error: 'invalid_id' } satisfies ApiError;
      }

      const passwordHash = await hashPassword(body.newPassword);
      const result = await collections.users.updateOne(
        { _id: new ObjectId(params.id), authMethod: 'manual' } as any,
        { $set: { passwordHash, updatedAt: new Date().toISOString() } },
      );
      if (result.matchedCount === 0) {
        set.status = 404;
        return { error: 'not_found' } satisfies ApiError;
      }
      return { ok: true } as const;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ newPassword: t.String({ minLength: 6 }) }),
    },
  );
