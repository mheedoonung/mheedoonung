// สคริปต์ seed ข้อมูลเริ่มต้น: admin (จาก env) + หนังตัวอย่าง ~6 เรื่อง (schema ใหม่)
// รันด้วย: bun run src/scripts/seed.ts (จาก apps/backend) หรือ bun run seed (จาก root)
import type { Movie } from '@mheedoonung/shared';
import { connectMongo, collections } from '../db/mongo';
import { hashPassword } from '../lib/crypto';
import { env } from '../config/env';

// หนังตัวอย่าง (placeholder) — ใช้ทดสอบ catalog/filter/sort ก่อนมีข้อมูลจริง
// video.r2Key ชี้ไปยัง object บน R2 (ยังไม่มีไฟล์จริงในเฟสนี้)
type SampleMovie = Omit<Movie, '_id' | 'createdAt' | 'updatedAt' | 'publishedAt'>;
const SAMPLE_MOVIES: SampleMovie[] = [
  {
    slug: 'duay-rak-jak-dao',
    title: 'ด้วยรักจากดาว',
    originalTitle: 'Love from the Star',
    synopsis: 'ชายลึกลับจากต่างดาวที่อยู่บนโลกมานานนับร้อยปี ได้พบกับดาราสาวจอมแสบ จุดเริ่มต้นของความรักข้ามจักรวาล',
    year: 2024,
    genres: ['โรแมนติก', 'แฟนตาซี', 'คอเมดี้'],
    country: 'ไทย',
    language: 'ไทย',
    contentRating: 'น 13+',
    cast: ['สมชาย ใจดี', 'มานี มีนา'],
    director: 'ก้องเกียรติ',
    posterUrl: 'https://placehold.co/400x600?text=Love+from+Star',
    backdropUrl: 'https://placehold.co/1280x720?text=Love+from+Star',
    video: { r2Key: 'movies/duay-rak-jak-dao.mp4', durationSec: 7920, width: 1920, height: 1080, bitrateKbps: 2000 },
    status: 'published',
    featured: true,
    viewCount: 15230,
  },
  {
    slug: 'lah-tha-mued',
    title: 'ล่าท้ามืด',
    originalTitle: 'Hunt in the Dark',
    synopsis: 'นักสืบหนุ่มไล่ล่าฆาตกรต่อเนื่องในเมืองที่ไม่เคยหลับใหล ทุกเบาะแสนำไปสู่ความจริงที่ไม่มีใครคาดคิด',
    year: 2023,
    genres: ['ระทึกขวัญ', 'อาชญากรรม'],
    country: 'ไทย',
    language: 'ไทย',
    contentRating: 'ฉ 20+',
    cast: ['วีระ เด็ดเดี่ยว'],
    director: 'นพดล',
    posterUrl: 'https://placehold.co/400x600?text=Hunt+Dark',
    video: { r2Key: 'movies/lah-tha-mued.mp4', durationSec: 8400, width: 1920, height: 1080, bitrateKbps: 2100 },
    status: 'published',
    featured: true,
    viewCount: 9870,
  },
  {
    slug: 'ban-pee-sing',
    title: 'บ้านผีสิง',
    synopsis: 'ครอบครัวหนึ่งย้ายเข้าบ้านหลังใหม่ในชนบท แต่กลับพบว่าบ้านหลังนั้นซ่อนความลับสยองขวัญไว้',
    year: 2022,
    genres: ['สยองขวัญ'],
    country: 'ไทย',
    language: 'ไทย',
    contentRating: 'น 18+',
    posterUrl: 'https://placehold.co/400x600?text=Haunted+House',
    video: { r2Key: 'movies/ban-pee-sing.mp4', durationSec: 7200, width: 1280, height: 720, bitrateKbps: 1800 },
    status: 'published',
    featured: false,
    viewCount: 6420,
  },
  {
    slug: 'kong-thap-fai',
    title: 'กองทัพไฟ',
    originalTitle: 'Legion of Fire',
    synopsis: 'หน่วยรบพิเศษต้องหยุดยั้งแผนการก่อการร้ายที่จะทำลายเมืองหลวง ภารกิจที่ไม่มีคำว่าถอย',
    year: 2024,
    genres: ['แอคชั่น', 'ผจญภัย'],
    country: 'ไทย',
    language: 'ไทย',
    contentRating: 'น 15+',
    cast: ['ธนา แกร่งกล้า', 'ศิริพร'],
    director: 'ปรีชา',
    posterUrl: 'https://placehold.co/400x600?text=Legion+Fire',
    backdropUrl: 'https://placehold.co/1280x720?text=Legion+Fire',
    video: { r2Key: 'movies/kong-thap-fai.mp4', durationSec: 8700, width: 1920, height: 1080, bitrateKbps: 2200 },
    status: 'published',
    featured: false,
    viewCount: 12010,
  },
  {
    slug: 'wan-wan-nan',
    title: 'วันวันนั้น',
    synopsis: 'เรื่องราวความรักวัยเรียนที่อบอุ่นหัวใจ ระหว่างเด็กสาวขี้อายกับรุ่นพี่ในชมรมดนตรี',
    year: 2021,
    genres: ['โรแมนติก', 'ดราม่า'],
    country: 'ไทย',
    language: 'ไทย',
    contentRating: 'ท',
    posterUrl: 'https://placehold.co/400x600?text=That+Day',
    video: { r2Key: 'movies/wan-wan-nan.mp4', durationSec: 7500, width: 1920, height: 1080, bitrateKbps: 1900 },
    status: 'published',
    featured: false,
    viewCount: 4530,
  },
  {
    slug: 'plaek-mai-secret',
    title: 'แปลกไม่ลับ',
    synopsis: 'หนังที่ยังไม่เผยแพร่ — ใช้ทดสอบว่าหนังสถานะ draft จะไม่โผล่ในแคตตาล็อกสาธารณะ',
    year: 2025,
    genres: ['คอเมดี้'],
    country: 'ไทย',
    language: 'ไทย',
    posterUrl: 'https://placehold.co/400x600?text=Draft',
    video: { r2Key: 'movies/plaek-mai-secret.mp4', durationSec: 7000 },
    status: 'draft',
    featured: false,
    viewCount: 0,
  },
];

async function seed(): Promise<void> {
  await connectMongo();
  const now = new Date().toISOString();

  // ---- upsert admin จาก env ----
  const existingAdmin = await collections.admins.findOne({ username: env.ADMIN_USERNAME });
  if (existingAdmin) {
    console.log(`[seed] admin "${env.ADMIN_USERNAME}" มีอยู่แล้ว — ข้าม`);
  } else {
    const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
    await collections.admins.insertOne({
      username: env.ADMIN_USERNAME,
      passwordHash,
      createdAt: now,
    });
    console.log(`[seed] สร้าง admin "${env.ADMIN_USERNAME}" สำเร็จ`);
  }

  // ---- insert หนังตัวอย่าง (dedup ด้วย slug) ----
  let inserted = 0;
  for (const movie of SAMPLE_MOVIES) {
    const exists = await collections.movies.findOne({ slug: movie.slug });
    if (exists) continue;
    await collections.movies.insertOne({
      ...movie,
      publishedAt: movie.status === 'published' ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    inserted++;
  }
  console.log(`[seed] เพิ่มหนังตัวอย่าง ${inserted} เรื่อง (ข้ามที่มี slug อยู่แล้ว)`);

  console.log('[seed] เสร็จสิ้น');
  process.exit(0);
}

seed().catch((err) => {
  console.error('[seed] ผิดพลาด:', err);
  process.exit(1);
});
