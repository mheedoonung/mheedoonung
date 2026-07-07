// จุดเริ่มต้นของ backend — wiring CORS, DB, และ route ของแต่ละ vertical
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { env } from './config/env';
import { connectMongo, getDb } from './db/mongo';
// route เหล่านี้สร้างโดย vertical อื่น — import ตาม path/ชื่อ export ที่ตกลงกันไว้
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { cardRoutes } from './routes/cards';
import { movieRoutes } from './routes/movies';
import { playbackRoutes } from './routes/playback';
import { feedbackRoutes } from './routes/feedback';
import { reportRoutes } from './routes/reports';
import { followupRoutes } from './routes/followup';

// เชื่อมต่อ MongoDB ให้เสร็จก่อนเปิดรับ request (connectMongo จะเรียก ensureIndexes ให้ด้วย)
// ทำเป็น top-level await ก่อน .listen() เพื่อกัน race ช่วง startup:
//  - ป้องกัน request แรก ๆ ที่เข้ามาก่อน DB พร้อม -> getDb() throw 500
//  - ป้องกัน insert ก่อน unique index (cards.code, users.lineUserId) ถูกสร้าง -> unique ไม่ถูก enforce
await connectMongo();

const app = new Elysia()
  // เปิด CORS ให้ frontend (หลาย origin คั่นด้วย ,) พร้อมส่ง cookie ได้
  .use(
    cors({
      origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
      credentials: true,
    }),
  )
  // health check — ping mongo จริงเพื่อให้ uptime monitor จับ DB ล่มได้ (ไม่ใช่แค่ process ยังอยู่)
  .get('/health', async ({ set }) => {
    try {
      await getDb().command({ ping: 1 });
      return { ok: true };
    } catch {
      set.status = 503;
      return { ok: false } as const;
    }
  })
  // route ของแต่ละ vertical
  .use(authRoutes)
  .use(adminRoutes)
  .use(cardRoutes)
  .use(movieRoutes)
  .use(playbackRoutes)
  .use(feedbackRoutes)
  .use(reportRoutes)
  .use(followupRoutes)
  .listen(env.PORT);

console.log(`[backend] กำลังรันที่ http://localhost:${env.PORT}`);

export type App = typeof app;
