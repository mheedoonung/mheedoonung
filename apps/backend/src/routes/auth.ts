// V_LINE — route สำหรับ LINE Login ทั้ง web OAuth (login/callback) และ LIFF (POST /auth/line)
// รวมถึง /me และ /auth/logout — ใช้ sessionPlugin จัดการ session ของ user
import { Elysia, t } from 'elysia';
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { ApiError, MeResponse } from '@mheedoonung/shared';
import { env } from '../config/env';
import { collections } from '../db/mongo';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { rateLimit } from '../lib/rateLimit';
import { sessionPlugin, toPublicUser } from '../plugins/session';
import {
  buildLineAuthorizeUrl,
  exchangeCodeForTokens,
  upsertUserFromLine,
  verifyLineIdToken,
} from '../lib/line';

// ชื่อ cookie ชั่วคราวเก็บ state ระหว่างทำ web OAuth (กัน CSRF)
const OAUTH_STATE_COOKIE = 'mdn_oauth_state';
// อายุ state cookie = 10 นาที (วินาที) ตาม SPEC
const OAUTH_STATE_MAX_AGE = 600;

// attributes ของ state cookie (httpOnly, sameSite lax — ต้องเป็น lax เพื่อให้ส่งกลับมาตอน redirect จาก LINE)
const stateCookieAttributes = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.COOKIE_SECURE,
  path: '/',
  domain: env.COOKIE_DOMAIN,
  maxAge: OAUTH_STATE_MAX_AGE,
} as const;

export const authRoutes = new Elysia()
  // ทุก route ในนี้ใช้ session context (currentUser, setUserSession, clearUserSession ฯลฯ)
  .use(sessionPlugin)

  // ---- GET /auth/line/login : เริ่ม web OAuth — สร้าง state เก็บใน cookie แล้ว redirect ไป LINE ----
  .get('/auth/line/login', ({ cookie, redirect }) => {
    // สุ่ม state แบบ random hex 32 ตัว
    const state = randomBytes(16).toString('hex');
    // เก็บ state ไว้ใน cookie ชั่วคราวเพื่อตรวจตอน callback
    cookie[OAUTH_STATE_COOKIE]!.set({ value: state, ...stateCookieAttributes });
    // redirect 302 ไปหน้า authorize ของ LINE
    return redirect(buildLineAuthorizeUrl(state), 302);
  })

  // ---- GET /auth/line/callback : LINE redirect กลับมาพร้อม code + state ----
  .get(
    '/auth/line/callback',
    async ({ query, cookie, set, redirect, setUserSession }) => {
      const { code, state } = query;

      // ตรวจ state ต้องตรงกับที่เก็บไว้ใน cookie (กัน CSRF)
      const expectedState = cookie[OAUTH_STATE_COOKIE]?.value;
      if (!state || !expectedState || state !== expectedState) {
        set.status = 400;
        return { error: 'invalid_state' } satisfies ApiError;
      }
      // ใช้ state ไปแล้ว — ลบทิ้ง
      cookie[OAUTH_STATE_COOKIE]!.remove();

      // ต้องมี code ถึงจะแลก token ได้
      if (!code) {
        set.status = 400;
        return { error: 'missing_code' } satisfies ApiError;
      }

      try {
        // แลก code -> tokens แล้ว verify id_token (ตรวจ aud === channel id ภายใน verifyLineIdToken)
        const { idToken } = await exchangeCodeForTokens(code);
        const profile = await verifyLineIdToken(idToken);
        // upsert user แล้วเซ็ต session
        const user = await upsertUserFromLine(profile);
        await setUserSession(user._id!);
        // เสร็จแล้ว redirect 302 กลับไป frontend
        return redirect(env.FRONTEND_URL, 302);
      } catch (err) {
        // login ไม่สำเร็จ -> 401
        set.status = 401;
        return {
          error: 'line_login_failed',
          message: err instanceof Error ? err.message : 'unknown_error',
        } satisfies ApiError;
      }
    },
    {
      // code/state เป็น optional ใน schema เพื่อให้เราจัดการ error เองได้ (LINE อาจส่ง error กลับมาแทน)
      query: t.Object({
        code: t.Optional(t.String()),
        state: t.Optional(t.String()),
      }),
    },
  )

  // ---- POST /auth/line : เส้นทาง LIFF — รับ idToken จาก client แล้วเข้าระบบ ----
  .post(
    '/auth/line',
    async ({ body, set, setUserSession }) => {
      try {
        // verify idToken (ตรวจ aud === channel id เสมอ ห้ามเชื่อ client)
        const profile = await verifyLineIdToken(body.idToken);
        const user = await upsertUserFromLine(profile);
        await setUserSession(user._id!);
        // คืน MeResponse (user เป็น PublicUser)
        return { user: toPublicUser(user) } satisfies MeResponse;
      } catch (err) {
        set.status = 401;
        return {
          error: 'line_login_failed',
          message: err instanceof Error ? err.message : 'unknown_error',
        } satisfies ApiError;
      }
    },
    {
      // body ต้องมี idToken (LineLoginBody)
      body: t.Object({
        idToken: t.String({ minLength: 1 }),
      }),
    },
  )

  // ---- POST /auth/manual-login : เส้นทางแยกสำหรับลูกค้าที่ไม่มี LINE — admin สร้าง username/password ให้ (ดู POST /admin/manual-users) ----
  .post(
    '/auth/manual-login',
    async ({ body, clientIp, set, setUserSession }) => {
      // กัน brute-force รหัสผ่าน — 10 ครั้ง/5 นาที ต่อ IP (มาตรฐานเดียวกับ /admin/login)
      if (!rateLimit(`manual-login:${clientIp}`, 10, 5 * 60_000)) {
        set.status = 429;
        return { error: 'too_many_requests', message: 'พยายามเข้าสู่ระบบบ่อยเกินไป ลองใหม่ภายหลัง' } satisfies ApiError;
      }

      const user = await collections.users.findOne({ username: body.username, authMethod: 'manual' });
      // ไม่พบ user หรือรหัสผ่านผิด -> 401 เดียวกัน (ไม่บอกว่าผิดที่ช่องไหน)
      if (!user || !user.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
        set.status = 401;
        return { error: 'invalid_credentials' } satisfies ApiError;
      }

      await setUserSession(user._id.toHexString());
      return { user: toPublicUser(user as any) } satisfies MeResponse;
    },
    {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 }),
      }),
    },
  )

  // ---- POST /auth/change-password : self-service เปลี่ยนรหัสผ่าน (เฉพาะ user สมัครมือ — authMethod:'manual') ----
  .post(
    '/auth/change-password',
    async ({ body, currentUser, set }) => {
      if (!currentUser) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      // user ผ่าน LINE ไม่มี passwordHash — เปลี่ยนรหัสผ่านทางนี้ไม่ได้
      if (currentUser.authMethod !== 'manual' || !currentUser.passwordHash) {
        set.status = 400;
        return { error: 'not_manual_user', message: 'เปลี่ยนรหัสผ่านได้เฉพาะบัญชีที่ไม่มี LINE' } satisfies ApiError;
      }
      // กัน brute-force เดารหัสผ่านเก่า — 10 ครั้ง/5 นาที ต่อ user (มี session แล้วแต่ยังต้องกัน)
      if (!rateLimit(`change-password:${currentUser._id}`, 10, 5 * 60_000)) {
        set.status = 429;
        return { error: 'too_many_requests', message: 'พยายามบ่อยเกินไป ลองใหม่ภายหลัง' } satisfies ApiError;
      }

      const ok = await verifyPassword(body.oldPassword, currentUser.passwordHash);
      if (!ok) {
        set.status = 401;
        return { error: 'invalid_credentials' } satisfies ApiError;
      }

      const passwordHash = await hashPassword(body.newPassword);
      await collections.users.updateOne(
        { _id: new ObjectId(currentUser._id) } as any,
        { $set: { passwordHash, updatedAt: new Date().toISOString() } },
      );
      return { ok: true } as const;
    },
    {
      body: t.Object({
        oldPassword: t.String({ minLength: 1 }),
        newPassword: t.String({ minLength: 6 }),
      }),
    },
  )

  // ---- POST /auth/dev-login : (DEV เท่านั้น) เข้าระบบโดยไม่ผ่าน LINE — สำหรับเทสต์ local ----
  // ปิดสนิทใน production: env.DEV_LOGIN_ENABLED ถูกบังคับเป็น false เมื่อ NODE_ENV=production
  .post(
    '/auth/dev-login',
    async ({ body, set, setUserSession }) => {
      if (!env.DEV_LOGIN_ENABLED) {
        set.status = 404;
        return { error: 'not_found' } satisfies ApiError;
      }
      // จำลอง LINE profile — เปลี่ยน lineUserId เพื่อจำลองคนละบัญชี/คนละเครื่อง (ทดสอบ concurrency)
      const lineUserId = body.lineUserId?.trim() || 'devuser-001';
      const displayName = body.displayName?.trim() || 'Dev User';
      const user = await upsertUserFromLine({ userId: lineUserId, displayName });
      await setUserSession(user._id!);
      return { user: toPublicUser(user) } satisfies MeResponse;
    },
    {
      body: t.Object({
        lineUserId: t.Optional(t.String()),
        displayName: t.Optional(t.String()),
      }),
    },
  )

  // ---- GET /me : คืนข้อมูล user ปัจจุบัน (หรือ null ถ้าไม่ได้ login) ----
  .get('/me', ({ currentUser }) => {
    return {
      user: currentUser ? toPublicUser(currentUser) : null,
    } satisfies MeResponse;
  })

  // ---- POST /auth/logout : ลบ session ของ user ----
  .post('/auth/logout', ({ clearUserSession }) => {
    clearUserSession();
    return { ok: true } as const;
  });
