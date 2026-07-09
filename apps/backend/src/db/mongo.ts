// การเชื่อมต่อ MongoDB ด้วย official driver (singleton)
// _id ใน DB เป็น ObjectId ภายใน; เวลาส่งออก API จะแปลงเป็น string เอง (ดู toApi helper)
import { MongoClient, type Db, type Collection } from 'mongodb';
import type { User, Card, Admin, Movie, Feedback, Report } from '@mheedoonung/shared';
import { env } from '../config/env';

// หมายเหตุ: type ของ collection ใช้ Omit<..., '_id'> เพราะ driver จัดการ _id เป็น ObjectId เอง
// ส่วน type ใน shared ระบุ _id เป็น string (รูปแบบที่ใช้ตอนส่งออก API)
type UserDoc = Omit<User, '_id'>;
type CardDoc = Omit<Card, '_id'>;
type AdminDoc = Omit<Admin, '_id'>;
type MovieDoc = Omit<Movie, '_id'>;
type FeedbackDoc = Omit<Feedback, '_id'>;
type ReportDoc = Omit<Report, '_id'>;
// สถิติรายวัน (dashboard) — _id เป็น string 'YYYY-MM-DD' ไม่ใช่ ObjectId
type DailyStatDoc = {
  _id: string;
  plays?: number;
  activeUsers?: number;
  newUsers?: number;
  redeems?: number;
  daysSold?: number;
};
// marker กันนับ user ซ้ำในวัน — _id = 'YYYY-MM-DD:userId', createdAt เป็น Date เพื่อใช้ TTL
type DailyActiveDoc = { _id: string; createdAt: Date };

let client: MongoClient | null = null;
let db: Db | null = null;

// เชื่อมต่อ MongoDB (เรียกตอน startup) + สร้าง index
export async function connectMongo(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  db = client.db(env.MONGODB_DB);
  await ensureIndexes();
  console.log(`[mongo] เชื่อมต่อสำเร็จ db=${env.MONGODB_DB}`);
  return db;
}

// คืน Db instance (ต้อง connect ก่อน ไม่งั้น throw)
export function getDb(): Db {
  if (!db) {
    throw new Error('[mongo] ยังไม่ได้เชื่อมต่อ — เรียก connectMongo() ก่อน');
  }
  return db;
}

// collections object (lazy) — typed ตาม shared types
export const collections = {
  get users(): Collection<UserDoc> {
    return getDb().collection<UserDoc>('users');
  },
  get cards(): Collection<CardDoc> {
    return getDb().collection<CardDoc>('cards');
  },
  get admins(): Collection<AdminDoc> {
    return getDb().collection<AdminDoc>('admins');
  },
  get movies(): Collection<MovieDoc> {
    return getDb().collection<MovieDoc>('movies');
  },
  get feedbacks(): Collection<FeedbackDoc> {
    return getDb().collection<FeedbackDoc>('feedbacks');
  },
  get reports(): Collection<ReportDoc> {
    return getDb().collection<ReportDoc>('reports');
  },
  get dailyStats(): Collection<DailyStatDoc> {
    return getDb().collection<DailyStatDoc>('dailyStats');
  },
  get dailyActive(): Collection<DailyActiveDoc> {
    return getDb().collection<DailyActiveDoc>('dailyActive');
  },
};

// สร้าง index แบบ self-heal: ถ้า index ชื่อเดิมมีอยู่แต่ options ไม่ตรง (เช่นเคย unique/TTL คนละค่า)
// mongo จะโยน conflict — จับแล้ว drop สร้างใหม่แทน *ห้ามปล่อยให้ล้ม startup ทั้งแอป*
// (จำเป็นจริง: prod เคย deploy feedbacks.userId แบบ unique ไปแล้ว โค้ดปัจจุบันเปลี่ยนเป็นไม่ unique)
async function ensureIndexSafe(
  col: Collection<any>,
  keys: Record<string, 1 | -1>,
  options?: Record<string, unknown>,
): Promise<void> {
  try {
    await col.createIndex(keys as any, options as any);
  } catch (err) {
    const code = (err as { codeName?: string }).codeName;
    if (code === 'IndexOptionsConflict' || code === 'IndexKeySpecsConflict') {
      const name = Object.entries(keys).map(([k, v]) => `${k}_${v}`).join('_');
      await col.dropIndex(name);
      await col.createIndex(keys as any, options as any);
      console.log(`[mongo] สร้าง index ${col.collectionName}.${name} ใหม่ (options เปลี่ยนจากของเดิม)`);
    } else {
      throw err;
    }
  }
}

// สร้าง index ที่จำเป็น (idempotent — เรียกซ้ำได้)
export async function ensureIndexes(): Promise<void> {
  await Promise.all([
    collections.users.createIndex({ lineUserId: 1 }, { unique: true }),
    // username: เฉพาะ user สมัครมือ (authMethod:'manual') — sparse กันชน user LINE ปกติที่ไม่มี field นี้
    collections.users.createIndex({ username: 1 }, { unique: true, sparse: true }),
    collections.cards.createIndex({ code: 1 }, { unique: true }),
    collections.cards.createIndex({ status: 1 }),
    collections.admins.createIndex({ username: 1 }, { unique: true }),
    // movies: slug unique (ใช้เป็น public id), + index สำหรับ filter/sort แคตตาล็อก
    collections.movies.createIndex({ slug: 1 }, { unique: true }),
    collections.movies.createIndex({ status: 1, createdAt: -1 }),
    collections.movies.createIndex({ status: 1, featured: 1 }),
    collections.movies.createIndex({ status: 1, viewCount: -1 }),
    collections.movies.createIndex({ status: 1, title: 1 }), // รองรับ sort=title ไม่ให้ทำ in-memory SORT
    collections.movies.createIndex({ genres: 1 }),
    // feedbacks: query ตาม user + เรียงดูตามเวลา (ส่งซ้ำได้ไม่จำกัด — ไม่ unique)
    // *ต้อง safe*: prod เคยมี index นี้แบบ unique (deploy รอบก่อน) — ชนแล้วต้อง drop สร้างใหม่ ไม่ใช่ล้ม
    ensureIndexSafe(collections.feedbacks, { userId: 1 }),
    collections.feedbacks.createIndex({ createdAt: -1 }),
    // reports: admin ดูตาม status (open ก่อน) + เรียงตามเวลา
    collections.reports.createIndex({ status: 1, createdAt: -1 }),
    // users: หน้า follow-up ของ admin query ช่วง accessExpiresAt (ใกล้หมด/เพิ่งหมด)
    collections.users.createIndex({ accessExpiresAt: 1 }),
    // dailyActive: marker กันนับ DAU ซ้ำ — TTL ลบเองหลัง 90 วัน (ใช้แค่กันซ้ำ ไม่ใช่ข้อมูลถาวร)
    // safe: ถ้าวันหน้าปรับค่า TTL จะชนของเดิม — drop สร้างใหม่แทนล้ม startup
    ensureIndexSafe(collections.dailyActive, { createdAt: 1 }, { expireAfterSeconds: 90 * 86_400 }),
  ]);
}
