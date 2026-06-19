// lib/playback — ออก "grant token" สำหรับเล่นวิดีโอผ่าน video-worker (เฟส 4)
// grant = HMAC token (hmacSign) ที่ผูก: user, stream, r2Key, IP และมี exp สั้น (~2 นาที)
// video-worker (เฟส 5) จะ verify token นี้ด้วย WebCrypto โดยใช้ format เดียวกัน (ดู apps/video-worker/src/grant.ts)
import { randomBytes } from 'node:crypto';
import type { PlaybackTokens } from '@mheedoonung/shared';
import { hmacSign } from './crypto';
import { env } from '../config/env';

// เวอร์ชันของ grant payload (เผื่อเปลี่ยน schema ในอนาคต — worker ตรวจค่านี้ได้)
const GRANT_VERSION = 1;

// ข้อมูลที่ใช้ออก grant
export interface GrantInput {
  userId: string; // _id ของ user (LINE-bound)
  streamId: string; // id ของ stream ปัจจุบัน (concurrency=1)
  r2Key: string; // object key ของไฟล์บน R2 ที่อนุญาตให้ดึง
  subtitleR2Key?: string; // object key ของไฟล์ซับ (ถ้ามี) — อนุญาตให้ดึงด้วย grant เดียวกัน
  ip: string; // IP ที่ผูกกับ grant (worker เทียบกับ cf-connecting-ip)
}

// สร้าง streamId ใหม่ (สุ่ม 16 ไบต์ hex)
export function newStreamId(): string {
  return randomBytes(16).toString('hex');
}

// ออก grant token (HMAC) อายุ = VIDEO_TOKEN_TTL_SECONDS
// subkey: ถ้ามีไฟล์ซับ จะฝัง key ของซับไว้ด้วย เพื่อให้ worker ยอมเสิร์ฟทั้งวิดีโอและซับด้วย grant เดียว
export function mintGrant({ userId, streamId, r2Key, subtitleR2Key, ip }: GrantInput): string {
  return hmacSign(
    {
      v: GRANT_VERSION,
      sub: userId,
      sid: streamId,
      key: r2Key,
      ...(subtitleR2Key ? { subkey: subtitleR2Key } : {}),
      ip,
    },
    env.VIDEO_GRANT_SECRET,
    env.VIDEO_TOKEN_TTL_SECONDS,
  );
}

// ประกอบ response สำหรับ frontend: authUrl (set cookie) + fileUrl (<video src>) + จังหวะ refresh
export function buildPlaybackTokens(input: GrantInput): PlaybackTokens {
  const grant = mintGrant(input);
  const base = env.VIDEO_BASE_URL.replace(/\/+$/, ''); // ตัด trailing slash
  const ttl = env.VIDEO_TOKEN_TTL_SECONDS;
  return {
    streamId: input.streamId,
    // worker route สำหรับ set cookie (ส่ง grant ผ่าน query แล้ว worker เก็บเป็น HttpOnly cookie)
    authUrl: `${base}/__auth?token=${encodeURIComponent(grant)}`,
    // ไฟล์วิดีโอ — Range request ทุกครั้งจะแนบ cookie ที่ worker set ไว้ (ดูได้ต่อเนื่องโดยไม่ต้องเปลี่ยน src)
    fileUrl: `${base}/${input.r2Key}`,
    // ไฟล์ซับ (ถ้ามี) — frontend fetch ด้วย credentials:'include' (cookie เดียวกับวิดีโอ) แล้วทำเป็น blob ให้ player
    ...(input.subtitleR2Key ? { subtitleUrl: `${base}/${input.subtitleR2Key}` } : {}),
    ttlSeconds: ttl,
    // refresh ก่อนหมดอายุครึ่งนึง (อย่างน้อย 15 วิ) เพื่อต่อ cookie แบบเนียน + เช็ค concurrency
    refreshInSeconds: Math.max(15, Math.floor(ttl / 2)),
  };
}
