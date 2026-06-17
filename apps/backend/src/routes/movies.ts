// V_MOVIES — แคตตาล็อกหนัง (เต็มเรื่องบน R2)
// เฟสนี้: list (filter/ค้นหา/sort/แบ่งหน้า) + รายชื่อ genre + รายละเอียดราย slug
//   ยังไม่คืน playback url / ไม่แตะ video (เป็นเฟสถัดไป) และไม่ส่ง r2Key ออกเด็ดขาด
// ทุก response error = ApiError {error, message?}
import { Elysia, t } from 'elysia';
import { ObjectId } from 'mongodb';
import type {
  PublicMovie,
  MovieListResponse,
  GenreListResponse,
  MovieSort,
  ApiError,
} from '@mheedoonung/shared';
import { sessionPlugin, isActive } from '../plugins/session';
import { collections } from '../db/mongo';

// รูปแบบ doc ที่อ่านจาก DB (มี _id เป็น ObjectId + field ของ Movie)
type MovieDbDoc = {
  _id: ObjectId;
  slug: string;
  title: string;
  originalTitle?: string;
  synopsis: string;
  year?: number;
  genres: string[];
  country?: string;
  language?: string;
  contentRating?: string;
  cast?: string[];
  director?: string;
  posterUrl: string;
  backdropUrl?: string;
  trailerUrl?: string;
  video: { r2Key: string; durationSec: number };
  featured: boolean;
  viewCount: number;
};

// แปลง movie doc -> PublicMovie (ส่งเฉพาะ field ปลอดภัย; ตัด video.r2Key ออก)
function toPublicMovie(doc: MovieDbDoc): PublicMovie {
  return {
    id: doc._id.toHexString(),
    slug: doc.slug,
    title: doc.title,
    originalTitle: doc.originalTitle,
    synopsis: doc.synopsis,
    year: doc.year,
    durationSec: doc.video?.durationSec ?? 0,
    genres: doc.genres ?? [],
    country: doc.country,
    language: doc.language,
    contentRating: doc.contentRating,
    cast: doc.cast,
    director: doc.director,
    posterUrl: doc.posterUrl,
    backdropUrl: doc.backdropUrl,
    trailerUrl: doc.trailerUrl,
    featured: doc.featured ?? false,
    viewCount: doc.viewCount ?? 0,
  };
}

// แปลงค่า sort -> spec ของ MongoDB
function sortSpec(sort: MovieSort): Record<string, 1 | -1> {
  switch (sort) {
    case 'popular':
      return { viewCount: -1, createdAt: -1 };
    case 'title':
      return { title: 1 };
    case 'newest':
    default:
      return { createdAt: -1 };
  }
}

// escape ข้อความค้นหาก่อนยัดเข้า RegExp (กัน regex injection)
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const movieRoutes = new Elysia()
  // route กลุ่มนี้ต้อง login ก่อน (อ่าน currentUser จาก session)
  .use(sessionPlugin)

  // GET /movies/genres — รายชื่อ genre ทั้งหมดของหนังที่ published (สำหรับ filter UI)
  // (ต้องประกาศก่อน /movies/:slug เพื่อไม่ให้ถูกจับเป็น slug)
  .get('/movies/genres', async ({ currentUser, set }) => {
    if (!currentUser) {
      set.status = 401;
      return { error: 'unauthorized' } satisfies ApiError;
    }
    const genres = (await collections.movies.distinct('genres', {
      status: 'published',
    })) as string[];
    genres.sort((a, b) => a.localeCompare(b, 'th'));
    return { genres } satisfies GenreListResponse;
  })

  // GET /movies — รายการหนัง published (filter genre/ค้นหา q, sort, แบ่งหน้า)
  .get(
    '/movies',
    async ({ currentUser, query, set }) => {
      if (!currentUser) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }

      const page = Math.max(1, Math.floor(query.page ?? 1));
      const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 24)), 60);
      const skip = (page - 1) * limit;
      const sort = (query.sort ?? 'newest') as MovieSort;

      // เฉพาะหนัง published เท่านั้น
      const filter: Record<string, unknown> = { status: 'published' };
      if (query.genre) filter.genres = query.genre;
      if (query.q && query.q.trim()) {
        // ค้นหาจากชื่อ (ไทย/ต้นฉบับ) แบบ substring ไม่สนตัวพิมพ์
        const rx = new RegExp(escapeRegex(query.q.trim()), 'i');
        filter.$or = [{ title: rx }, { originalTitle: rx }];
      }

      const cursor = collections.movies
        .find(filter)
        .sort(sortSpec(sort))
        .skip(skip)
        .limit(limit);

      const [docs, total] = await Promise.all([
        cursor.toArray(),
        collections.movies.countDocuments(filter),
      ]);

      return {
        items: docs.map((d) => toPublicMovie(d as unknown as MovieDbDoc)),
        total,
        page,
        limit,
      } satisfies MovieListResponse;
    },
    {
      query: t.Object({
        genre: t.Optional(t.String()),
        q: t.Optional(t.String()),
        sort: t.Optional(
          t.Union([t.Literal('newest'), t.Literal('popular'), t.Literal('title')]),
        ),
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
      }),
    },
  )

  // GET /movies/:slug — รายละเอียดหนัง (ต้อง currentUser + isActive; ยังไม่คืน playback url)
  .get(
    '/movies/:slug',
    async ({ currentUser, params, set }) => {
      if (!currentUser) {
        set.status = 401;
        return { error: 'unauthorized' } satisfies ApiError;
      }
      // ต้องมีบัตรที่ยัง active ถึงจะดูรายละเอียด (เตรียมเข้าหน้าเล่น) ได้
      if (!isActive(currentUser)) {
        set.status = 403;
        return {
          error: 'inactive',
          message: 'ต้องมีบัตรที่ยังใช้งานได้ก่อนจึงจะดูรายละเอียดหนังได้',
        } satisfies ApiError;
      }

      const doc = await collections.movies.findOne({
        slug: params.slug,
        status: 'published',
      });
      if (!doc) {
        set.status = 404;
        return { error: 'not_found', message: 'ไม่พบหนังที่ต้องการ' } satisfies ApiError;
      }

      return toPublicMovie(doc as unknown as MovieDbDoc);
    },
    {
      params: t.Object({ slug: t.String() }),
    },
  );
