// routes/playback — ขอสิทธิ์เล่นวิดีโอ (เฟส 4) + คุม concurrency=1 (1 บัญชี = 1 stream)
// flow: start -> (frontend เรียก worker /__auth เพื่อ set cookie) -> <video src=fileUrl>
//       -> refresh ทุก ~ttl/2 (ต่ออายุ + เช็คว่ายังเป็น stream ปัจจุบัน) -> stop เมื่อปิด
// กันแชร์บัญชี: start จะเขียนทับ currentStream เสมอ -> อุปกรณ์เก่าจะ refresh ไม่ผ่าน (409) แล้วถูกเตะ
//             ภายใน ~ttl (cookie/grant ของเครื่องเก่าหมดอายุ)
import { Elysia, t } from 'elysia';
import { ObjectId } from 'mongodb';
import type {
  ApiError,
  PlaybackStartResponse,
  PlaybackRefreshResponse,
} from '@mheedoonung/shared';
import { sessionPlugin, isActive } from '../plugins/session';
import { collections } from '../db/mongo';
import { newStreamId, buildPlaybackTokens } from '../lib/playback';

export const playbackRoutes = new Elysia()
  .use(sessionPlugin)

  // POST /playback/start — เริ่มดูหนัง 1 เรื่อง: ออก grant + เซ็ต currentStream (เขียนทับของเดิม)
  .post(
    '/playback/start',
    async ({ currentUser, clientIp, body, set }) => {
      if (!currentUser) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      if (!isActive(currentUser)) {
        set.status = 403;
        return { error: 'inactive', message: 'ต้องมีบัตรที่ยังใช้งานได้ก่อนจึงจะดูได้' } satisfies ApiError;
      }

      const movie = await collections.movies.findOne({ slug: body.slug, status: 'published' });
      if (!movie) {
        set.status = 404;
        return { error: 'not_found', message: 'ไม่พบหนังที่ต้องการ' } satisfies ApiError;
      }
      const r2Key = movie.video?.r2Key;
      if (!r2Key) {
        set.status = 409;
        return { error: 'no_video', message: 'หนังเรื่องนี้ยังไม่มีไฟล์วิดีโอ' } satisfies ApiError;
      }

      const userId = currentUser._id!;
      const movieId = (movie._id as unknown as ObjectId).toHexString();
      const streamId = newStreamId();
      const now = new Date().toISOString();

      // เขียนทับ currentStream เสมอ (เครื่องใหม่เข้ามาแทนที่เครื่องเก่า)
      // + นับวิว (ใช้ขับ sort=popular และ badge ฮิต) // ponytail: นับต่อ /start; ถ้าเฟ้อค่อย debounce ต่อ stream/วัน
      await Promise.all([
        collections.users.updateOne({ _id: new ObjectId(userId) } as any, {
          $set: {
            currentStream: { streamId, movieId, ip: clientIp, startedAt: now, heartbeatAt: now },
            updatedAt: now,
          },
        }),
        collections.movies.updateOne({ _id: movie._id } as any, { $inc: { viewCount: 1 } }),
      ]);

      return buildPlaybackTokens({
        userId,
        streamId,
        r2Key,
        subtitleR2Key: movie.video?.subtitleR2Key,
        ip: clientIp,
      }) satisfies PlaybackStartResponse;
    },
    { body: t.Object({ slug: t.String() }) },
  )

  // POST /playback/refresh — ต่ออายุ grant (เรียกทุก ~ttl/2); เช็คว่ายังเป็น stream ปัจจุบัน
  .post(
    '/playback/refresh',
    async ({ currentUser, clientIp, body, set }) => {
      if (!currentUser) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      if (!isActive(currentUser)) {
        set.status = 403;
        return { error: 'inactive', message: 'สิทธิ์ใช้งานหมดอายุแล้ว' } satisfies ApiError;
      }

      const userId = currentUser._id!;
      const now = new Date().toISOString();

      // อัปเดต heartbeat + IP แบบ atomic + กัน TOCTOU:
      //   filter ด้วยทั้ง _id และ 'currentStream.streamId' = body.streamId ในคำสั่งเดียว
      //   - ถ้าถูกเตะ (มีอุปกรณ์อื่น /start เขียนทับ streamId แล้ว) filter จะไม่ match -> คืน null
      //   - ถ้า currentStream เป็น null (ถูก /stop) filter ก็ไม่ match -> ไม่เกิดการสร้าง object ผิดรูป
      //   วิธีนี้กันทั้งการเขียนทับ stream อื่น และ dotted-path $set บน currentStream:null
      const fresh = await collections.users.findOneAndUpdate(
        { _id: new ObjectId(userId), 'currentStream.streamId': body.streamId } as any,
        {
          $set: { 'currentStream.heartbeatAt': now, 'currentStream.ip': clientIp, updatedAt: now },
        } as any,
        { returnDocument: 'after' },
      );
      const cs = fresh?.currentStream;
      if (!cs) {
        // ไม่ match streamId -> ถูกอุปกรณ์อื่นแทนที่ (หรือถูก stop ไปแล้ว)
        set.status = 409;
        return {
          error: 'stream_taken_over',
          message: 'บัญชีนี้กำลังถูกใช้ดูจากอุปกรณ์อื่น',
        } satisfies ApiError;
      }

      // หา r2Key จากหนังที่กำลังดู (อ้างจาก movieId ใน currentStream)
      if (!ObjectId.isValid(cs.movieId)) {
        set.status = 404;
        return { error: 'not_found' } satisfies ApiError;
      }
      // ต้อง filter status:'published' เหมือน /start — ถ้าหนังถูก unpublish/ลบ ระหว่างดู
      //   จะไม่ต่ออายุ grant ให้เล่นต่อ (กันสตรีมหนังที่ถูกถอดออกจาก catalog)
      const movie = await collections.movies.findOne({
        _id: new ObjectId(cs.movieId),
        status: 'published',
      } as any);
      const r2Key = movie?.video?.r2Key;
      if (!r2Key) {
        set.status = 404;
        return { error: 'not_found', message: 'ไม่พบไฟล์วิดีโอของหนังเรื่องนี้' } satisfies ApiError;
      }

      return buildPlaybackTokens({
        userId,
        streamId: cs.streamId,
        r2Key,
        subtitleR2Key: movie?.video?.subtitleR2Key,
        ip: clientIp,
      }) satisfies PlaybackRefreshResponse;
    },
    { body: t.Object({ streamId: t.String() }) },
  )

  // POST /playback/stop — ปิดสตรีม (เคลียร์ currentStream ถ้าตรงกับ stream นี้)
  .post(
    '/playback/stop',
    async ({ currentUser, body, set }) => {
      if (!currentUser) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      const userId = currentUser._id!;
      // atomic: เคลียร์เฉพาะเมื่อ currentStream ยังเป็น stream นี้ (กัน stop เก่าลบ stream ใหม่ที่เพิ่ง /start)
      await collections.users.updateOne(
        { _id: new ObjectId(userId), 'currentStream.streamId': body.streamId } as any,
        { $set: { currentStream: null, updatedAt: new Date().toISOString() } },
      );
      return { ok: true };
    },
    { body: t.Object({ streamId: t.String() }) },
  );
