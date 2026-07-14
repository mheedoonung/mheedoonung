// auth infra ที่ทุก route ใช้ร่วม — จัดการ session ของ user และ admin ผ่าน JWT + cookie
// route จะ .use(sessionPlugin) แล้วเช็คเอง เช่น if (!currentUser) { set.status = 401; return {...} }
import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { ObjectId } from 'mongodb';
import { FEEDBACK_CAMPAIGN_VERSION, type User, type Admin, type PublicUser } from '@mheedoonung/shared';
import { env } from '../config/env';
import { collections } from '../db/mongo';

// อายุ cookie session = 30 วัน (วินาที)
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

// attributes พื้นฐานของ cookie session (httpOnly ฯลฯ)
const cookieBaseAttributes = {
  httpOnly: true,
  sameSite: env.COOKIE_SAMESITE,
  secure: env.COOKIE_SECURE,
  path: '/',
  domain: env.COOKIE_DOMAIN,
  maxAge: SESSION_MAX_AGE,
} as const;

// แปลง doc จาก DB (ObjectId _id) -> รูปแบบที่ใช้ในแอป (_id เป็น string)
function withStringId<T extends { _id?: unknown }>(doc: T): T {
  if (doc._id instanceof ObjectId) {
    return { ...doc, _id: doc._id.toHexString() };
  }
  return doc;
}

// ดึง client IP จาก header — คืน '' ถ้าไม่รู้ (ห้ามคืน sentinel เช่น 'unknown'
//   เพราะค่านั้นจะถูกฝังลง grant.ip แล้วไม่มีวันตรงกับ IP จริงที่ worker เห็น -> 403 ตลอด)
// ลำดับความสำคัญ: cf-connecting-ip ก่อน (ให้ตรง semantics กับ worker ที่อยู่หลัง Cloudflare เดียวกัน)
//   แล้วค่อย x-forwarded-for / x-real-ip เป็น fallback
function resolveClientIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) {
    const v = cf.trim();
    if (v) return v;
  }
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    // x-forwarded-for อาจเป็น "ip1, ip2, ..." — เอาตัวแรก
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    const v = realIp.trim();
    if (v) return v;
  }
  return ''; // ไม่รู้ IP — ปล่อยว่างเพื่อให้ตรงกับ semantics ของ `grant.ip && ip` ใน worker
}

// ปลั๊กอิน session — ให้ context: currentUser/currentAdmin/clientIp + setter/clearer
export const sessionPlugin = new Elysia({ name: 'session' })
  .use(jwt({ name: 'jwt', secret: env.JWT_SECRET }))
  .derive({ as: 'scoped' }, async ({ jwt, cookie, request }) => {
    // ---- โหลด user จาก session cookie ----
    let currentUser: User | null = null;
    const userCookie = cookie[env.SESSION_COOKIE_NAME];
    const userToken = userCookie?.value;
    if (typeof userToken === 'string' && userToken) {
      const payload = await jwt.verify(userToken);
      // payload.sub = user id (hex string ของ ObjectId)
      if (payload && typeof payload.sub === 'string' && ObjectId.isValid(payload.sub)) {
        const doc = await collections.users.findOne({ _id: new ObjectId(payload.sub) } as any);
        if (doc) currentUser = withStringId(doc) as unknown as User;
      }
    }

    // ---- โหลด admin จาก admin session cookie ----
    let currentAdmin: Admin | null = null;
    const adminCookie = cookie[env.ADMIN_COOKIE_NAME];
    const adminToken = adminCookie?.value;
    if (typeof adminToken === 'string' && adminToken) {
      const payload = await jwt.verify(adminToken);
      if (payload && typeof payload.sub === 'string' && ObjectId.isValid(payload.sub)) {
        const doc = await collections.admins.findOne({ _id: new ObjectId(payload.sub) } as any);
        if (doc) currentAdmin = withStringId(doc) as unknown as Admin;
      }
    }

    const clientIp = resolveClientIp(request);

    // เซ็ต session ของ user (jwt.sign + ตั้ง cookie)
    // ใส่ exp ใน token ด้วย (unix seconds) ให้สอดคล้องกับ maxAge ของ cookie
    // เพื่อให้ jwt.verify ปฏิเสธ token ที่หมดอายุจริง ไม่ใช่พึ่งแค่ cookie maxAge
    const setUserSession = async (userId: string): Promise<void> => {
      const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
      const token = await jwt.sign({ sub: userId, exp });
      cookie[env.SESSION_COOKIE_NAME]!.set({ value: token, ...cookieBaseAttributes });
    };

    // เซ็ต session ของ admin (ใส่ exp เช่นเดียวกับ user)
    const setAdminSession = async (adminId: string): Promise<void> => {
      const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
      const token = await jwt.sign({ sub: adminId, exp });
      cookie[env.ADMIN_COOKIE_NAME]!.set({ value: token, ...cookieBaseAttributes });
    };

    // ลบ session ของ user
    const clearUserSession = (): void => {
      cookie[env.SESSION_COOKIE_NAME]!.remove();
    };

    // ลบ session ของ admin
    const clearAdminSession = (): void => {
      cookie[env.ADMIN_COOKIE_NAME]!.remove();
    };

    return {
      currentUser,
      currentAdmin,
      clientIp,
      setUserSession,
      setAdminSession,
      clearUserSession,
      clearAdminSession,
    };
  });

// เช็คว่า user ยัง active อยู่ไหม (accessExpiresAt ในอนาคต)
export function isActive(user: User | null): boolean {
  if (!user || !user.accessExpiresAt) return false;
  return new Date(user.accessExpiresAt).getTime() > Date.now();
}

// แปลง User -> PublicUser (ตัด field ภายในออก + ใส่ isActive)
export function toPublicUser(user: User): PublicUser {
  return {
    lineUserId: user.lineUserId,
    displayName: user.displayName,
    pictureUrl: user.pictureUrl,
    accessExpiresAt: user.accessExpiresAt,
    isActive: isActive(user),
    authMethod: user.authMethod,
    feedbackRewardClaimed: user.feedbackRewardVersion === FEEDBACK_CAMPAIGN_VERSION,
  };
}
