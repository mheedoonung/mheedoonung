export type CardStatus = 'unused' | 'redeemed' | 'revoked';
export interface User {
  _id?: string;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  accessExpiresAt: string | null;   // ISO; null = ยังไม่เคย active
  currentStream?: { streamId: string; movieId: string; ip: string; startedAt: string; heartbeatAt: string } | null;
  createdAt: string;
  updatedAt: string;
}
export interface Card {
  _id?: string; code: string; days: number; status: CardStatus; note?: string;
  redeemedByUserId?: string | null; redeemedAt?: string | null; expiresAt?: string | null;
  createdBy: string; createdAt: string;
}
export interface Admin { _id?: string; username: string; passwordHash: string; createdAt: string }

// ---- หนัง (เต็มเรื่อง 1 ไฟล์/เรื่องบน R2) ----
export type MovieStatus = 'draft' | 'published';

// ข้อมูลไฟล์วิดีโอบน R2 (แยก object — ไม่ส่งออก API ทั้งก้อนเพื่อความปลอดภัย)
export interface MovieVideo {
  r2Key: string;          // object key ของไฟล์ MP4 บน R2 เช่น "movies/<slug>.mp4"
  subtitleR2Key?: string; // object key ของไฟล์ซับ .srt บน R2 (แยกไฟล์ เช่น "movies/<slug>.srt") — soft sub ที่ฝังใน MP4 เบราว์เซอร์ไม่อ่านให้
  durationSec: number;    // ความยาว (วินาที)
  sizeBytes?: number;     // ขนาดไฟล์ (ไบต์)
  width?: number;         // ความกว้างวิดีโอ (px)
  height?: number;        // ความสูงวิดีโอ (px)
  bitrateKbps?: number;   // bitrate โดยประมาณ
}

export interface Movie {
  _id?: string;
  slug: string;               // unique, url-friendly เช่น "the-matrix-1999"
  title: string;              // ชื่อ (ไทย)
  originalTitle?: string;     // ชื่อต้นฉบับ
  synopsis: string;           // เรื่องย่อ
  year?: number;              // ปีที่ฉาย
  genres: string[];           // หมวดหมู่ เช่น ["แอคชั่น","ดราม่า"]
  country?: string;           // ประเทศ
  language?: string;          // ภาษาเสียงหลัก
  contentRating?: string;     // เรท เช่น "น 13+", "ฉ 20+"
  cast?: string[];            // นักแสดง
  director?: string;          // ผู้กำกับ
  posterUrl: string;          // โปสเตอร์แนวตั้ง
  backdropUrl?: string;       // ภาพแนวนอน (hero/banner)
  trailerUrl?: string;        // ตัวอย่าง (optional)
  video: MovieVideo;          // ข้อมูลไฟล์วิดีโอบน R2
  status: MovieStatus;        // draft = ซ่อน, published = แสดงในแคตตาล็อก
  featured: boolean;          // โชว์ในแถวแนะนำหน้าแรก
  viewCount: number;          // ยอดดู (ใช้จัดอันดับ popular)
  publishedAt: string | null; // ISO เวลาเผยแพร่
  createdAt: string;
  updatedAt: string;
}
export interface PublicUser { lineUserId: string; displayName: string; pictureUrl?: string; accessExpiresAt: string | null; isActive: boolean }
export interface MeResponse { user: PublicUser | null }
export interface LineLoginBody { idToken: string }
export interface RedeemBody { code: string }
export interface RedeemResponse { ok: true; accessExpiresAt: string; daysAdded: number }
export interface AdminLoginBody { username: string; password: string }
export interface CreateCardsBody { days: number; quantity: number; note?: string }
export interface CreateCardsResponse { created: number; codes: string[] }
export interface CardListItem { id: string; code: string; days: number; status: CardStatus; note?: string; redeemedByUserId?: string | null; redeemedAt?: string | null; expiresAt?: string | null; createdBy: string; createdAt: string }
export interface CardListResponse { items: CardListItem[]; total: number; page: number; limit: number }
// สรุปยอดบัตรตามช่วงเวลา (filter ด้วย createdAt ISO; from/to เป็น ISO string)
export interface CardSummaryByStatus { status: CardStatus; count: number; days: number }
export interface CardSummaryResponse {
  from: string | null;   // ขอบล่างที่ใช้ filter (ISO) หรือ null = ไม่จำกัด
  to: string | null;     // ขอบบนที่ใช้ filter (ISO) หรือ null = ไม่จำกัด
  total: number;         // จำนวนบัตรที่ "สร้าง" ในช่วง
  totalDays: number;     // รวมจำนวนวันของบัตรในช่วง
  byStatus: CardSummaryByStatus[]; // แยกตามสถานะ (unused/redeemed/revoked)
}
// ---- DTO ของหนังที่ส่งออก API (ตัด r2Key / video internals ออก) ----
export interface PublicMovie {
  id: string;
  slug: string;
  title: string;
  originalTitle?: string;
  synopsis: string;
  year?: number;
  durationSec: number;        // = video.durationSec
  genres: string[];
  country?: string;
  language?: string;
  contentRating?: string;
  cast?: string[];
  director?: string;
  posterUrl: string;
  backdropUrl?: string;
  trailerUrl?: string;
  featured: boolean;
  viewCount: number;
}
export type MovieSort = 'newest' | 'popular' | 'title';
export interface MovieListResponse { items: PublicMovie[]; total: number; page: number; limit: number }
export interface GenreListResponse { genres: string[] }

// ---- Playback (เฟส 4-5): ขอสิทธิ์เล่นวิดีโอจาก R2 ผ่าน video-worker ----
export interface PlaybackStartBody { slug: string }
export interface PlaybackRefreshBody { streamId: string }
export interface PlaybackStopBody { streamId: string }
export interface PlaybackTokens {
  streamId: string;          // id ของ stream ปัจจุบัน (ใช้ refresh/stop + กันแชร์บัญชี concurrency=1)
  authUrl: string;           // endpoint ของ worker สำหรับ set cookie (เรียกด้วย fetch credentials:'include')
  fileUrl: string;           // URL ไฟล์วิดีโอบน worker (ใส่ใน <video src>)
  subtitleUrl?: string;      // URL ไฟล์ซับบน worker (มีเฉพาะหนังที่มีซับ) — frontend fetch ด้วย cookie แล้วทำเป็น blob ส่งให้ player
  ttlSeconds: number;        // อายุ grant (วินาที)
  refreshInSeconds: number;  // ควรเรียก /playback/refresh ก่อนถึงเวลานี้ (≈ ttl/2)
}
export type PlaybackStartResponse = PlaybackTokens;
export type PlaybackRefreshResponse = PlaybackTokens;

export interface ApiError { error: string; message?: string }
