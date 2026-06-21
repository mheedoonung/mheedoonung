// V_ADMIN — route จัดการ auth ของ admin (login/logout/me เท่านั้น)
// การจัดการบัตร (สร้าง/list/revoke) อยู่ใน V_CARDS (routes/cards.ts) ไม่ใช่ที่นี่
import { Elysia, t } from 'elysia';
import { ObjectId } from 'mongodb';
import type { ApiError } from '@mheedoonung/shared';
import { collections } from '../db/mongo';
import { verifyPassword } from '../lib/crypto';
import { sessionPlugin } from '../plugins/session';
import { rateLimit } from '../lib/rateLimit';

// route ของ admin — prefix '/admin', ใช้ sessionPlugin เพื่ออ่าน/เขียน admin session
export const adminRoutes = new Elysia({ prefix: '/admin' })
  .use(sessionPlugin)

  // POST /admin/login — หา admin จาก username -> verify รหัสผ่าน -> ตั้ง admin session
  .post(
    '/login',
    async ({ body, clientIp, setAdminSession, set }) => {
      // กัน brute-force รหัสผ่าน admin (admin ออกบัตรเงินจริงได้) — 10 ครั้ง/5 นาที ต่อ IP
      if (!rateLimit(`admin-login:${clientIp}`, 10, 5 * 60_000)) {
        set.status = 429;
        return { error: 'too_many_requests', message: 'พยายามเข้าสู่ระบบบ่อยเกินไป ลองใหม่ภายหลัง' } satisfies ApiError;
      }
      // หา admin จาก username (มี unique index อยู่แล้ว)
      const admin = await collections.admins.findOne({ username: body.username });

      // ไม่พบ admin หรือรหัสผ่านผิด -> 401 (ไม่บอกว่าผิดที่ช่องไหนเพื่อความปลอดภัย)
      if (!admin) {
        set.status = 401;
        return { error: 'invalid_credentials' } as ApiError;
      }

      const ok = await verifyPassword(body.password, admin.passwordHash);
      if (!ok) {
        set.status = 401;
        return { error: 'invalid_credentials' } as ApiError;
      }

      // _id ที่ได้จาก findOne เป็น ObjectId — แปลงเป็น hex string ก่อนส่งเข้า setAdminSession
      await setAdminSession(admin._id.toHexString());
      return { ok: true } as const;
    },
    {
      // validate body ด้วย TypeBox: ต้องมี username/password เป็น string
      body: t.Object({
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 }),
      }),
    },
  )

  // POST /admin/logout — ลบ admin session (ไม่ต้องเช็คว่า login อยู่ไหม)
  .post('/logout', ({ clearAdminSession }) => {
    clearAdminSession();
    return { ok: true } as const;
  })

  // GET /admin/me — คืนข้อมูล admin ปัจจุบัน (เฉพาะ username) หรือ 401 ถ้าไม่ได้ login
  .get('/me', ({ currentAdmin, set }) => {
    if (!currentAdmin) {
      set.status = 401;
      return { error: 'unauthorized' } as ApiError;
    }
    // ส่งเฉพาะ field ที่ปลอดภัย (ไม่ส่ง passwordHash)
    return { admin: { username: currentAdmin.username } } as const;
  });
