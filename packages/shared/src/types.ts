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

// ---- Feedback จากผู้ใช้ ----
// เกณฑ์เด้งถาม (ดูครบ 30 นาที/ไม่กวนซ้ำ) อยู่ฝั่ง frontend ทั้งหมด: localStorage (lib/feedbackGate)
// chips ให้เลือกตอนให้คะแนน — whitelist ฝั่ง backend กรองค่าที่ไม่อยู่ในลิสต์ทิ้ง
export const FEEDBACK_TAGS = [
  'โหลดช้า/กระตุก',
  'หนังน้อย/ไม่มีเรื่องที่อยากดู',
  'ใช้งานยาก',
  'ราคา/บัตรเติมเงิน',
  'อื่นๆ',
] as const;
export interface Feedback {
  _id?: string;
  userId: string;
  rating: number;        // 1-5 ดาว
  tags: string[];        // subset ของ FEEDBACK_TAGS
  text?: string;         // ข้อความเพิ่มเติม (optional, ≤1000 ตัวอักษร)
  watchSeconds: number;  // เวลาดูสะสมตอนส่ง — client รายงานเอง (localStorage) ใช้ประกอบการอ่านเท่านั้น
  createdAt: string;
}
export interface FeedbackBody { rating: number; tags?: string[]; text?: string; watchedSeconds?: number }
// รายการ feedback ฝั่ง admin (แนบชื่อ user; null = user ถูกลบไปแล้ว)
export interface FeedbackListItem {
  id: string;
  rating: number;
  tags: string[];
  text?: string;
  watchSeconds: number;
  createdAt: string;
  user: { displayName: string; pictureUrl?: string } | null;
}
export interface FeedbackListResponse { items: FeedbackListItem[]; total: number; page: number; limit: number }
export interface FeedbackSummaryResponse {
  total: number;                                  // จำนวน feedback ทั้งหมด
  avgRating: number | null;                       // คะแนนเฉลี่ย (null = ยังไม่มีข้อมูล)
  byRating: { rating: number; count: number }[];  // histogram 1-5 ดาว
  byTag: { tag: string; count: number }[];        // จำนวนต่อ chip (เรียงมาก->น้อย)
}

// ---- แจ้งปัญหา (user กดแจ้งเองตอนเจอปัญหา — ต่างจาก feedback ที่ระบบเด้งถาม) ----
export const REPORT_CATEGORIES = [
  'ดูวิดีโอไม่ได้',
  'กระตุก/โหลดช้า',
  'เสียง/ซับผิดปกติ',
  'บัตรเติมเงิน/สิทธิ์ใช้งาน',
  'อื่นๆ',
] as const;
export type ReportStatus = 'open' | 'resolved';
export interface Report {
  _id?: string;
  userId: string;
  category: string;   // หนึ่งใน REPORT_CATEGORIES
  text: string;       // รายละเอียดจาก user (บังคับ)
  // context แนบอัตโนมัติจาก client/server ช่วย debug — user ไม่ต้องพิมพ์เอง
  context?: { path?: string; movieSlug?: string; userAgent?: string };
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
}
export interface ReportBody { category: string; text: string; path?: string; movieSlug?: string }
export interface ReportListItem {
  id: string;
  category: string;
  text: string;
  context?: Report['context'];
  status: ReportStatus;
  createdAt: string;
  user: { displayName: string; pictureUrl?: string } | null;
}
export interface ReportListResponse { items: ReportListItem[]; total: number; page: number; limit: number; openCount: number }

// ---- ติดตามลูกค้า (admin follow-up ขายซ้ำ): user ที่สิทธิ์ใกล้หมด/เพิ่งหมด ----
export interface FollowupUserItem {
  id: string;
  displayName: string;
  pictureUrl?: string;
  lineUserId: string;         // ไว้ค้นหา/ทักใน LINE OA
  accessExpiresAt: string;    // ISO
  createdAt: string;          // ไว้ดูว่าเป็นลูกค้ามานานแค่ไหน
}
export interface FollowupResponse {
  soonDays: number;                    // ช่วง "ใกล้หมด" ที่ใช้ (วัน)
  expiredDays: number;                 // ช่วง "เพิ่งหมด" ที่ใช้ (วัน)
  expiringSoon: FollowupUserItem[];    // เรียงหมดก่อนขึ้นก่อน
  recentlyExpired: FollowupUserItem[]; // เรียงหมดล่าสุดขึ้นก่อน
}

// ---- Dashboard สรุปการใช้งาน (pre-aggregated รายวัน — ดู lib/stats.ts ฝั่ง backend) ----
export interface StatPoint {
  key: string;         // 'YYYY-MM-DD' (รายวัน) หรือ 'YYYY-MM' (รายเดือน)
  plays: number;       // จำนวนกดเริ่มดูหนัง
  activeUsers: number; // คนดูไม่ซ้ำ (รายเดือน = ผลรวม DAU รายวัน ไม่ใช่ MAU จริง)
  newUsers: number;    // สมัครใหม่
  redeems: number;     // จำนวนบัตรที่ถูกเติม
  daysSold: number;    // รวมจำนวนวันของบัตรที่ถูกเติม (ตัวแทนยอดขาย)
}
export type DashboardView = 'daily' | 'monthly';
export interface DashboardResponse {
  view: DashboardView;
  today: StatPoint;      // สรุปของวันนี้ (เวลาไทย)
  series: StatPoint[];   // รายวัน 30 จุด หรือรายเดือน 12 จุด (เรียงเก่า -> ใหม่, เติมศูนย์วันที่ไม่มีข้อมูล)
}

export interface ApiError { error: string; message?: string }
