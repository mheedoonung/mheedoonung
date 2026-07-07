// หน้าหลักของผู้ใช้ — เข้าได้เมื่อ login และ active แล้ว (ตรวจผ่าน ProtectedRoute requireActive)
// - แสดงข้อความต้อนรับ + วันหมดอายุสิทธิ์
// - ดึง /movies (MovieListResponse) มาแสดงเป็น grid โปสเตอร์ (player เป็นเฟสถัดไป)
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  PublicMovie,
  MovieListResponse,
  MovieSort,
  GenreListResponse,
} from '@mheedoonung/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { RedeemModal } from '../components/RedeemModal';
import { ExpiryWarningModal } from '../components/ExpiryWarningModal';

// เกณฑ์ "ใกล้หมด" = เหลือน้อยกว่า 1 วัน
const DAY_MS = 20 * 60 * 60 * 1000;

// จำนวนหนังต่อหน้า (ต้องไม่เกิน 60 ตามที่ API clamp ไว้)
const PAGE_SIZE = 24;

// ตัวเลือกการเรียงลำดับ (ต้องตรงกับ MovieSort ที่ API รองรับ)
const SORT_OPTIONS: { value: MovieSort; label: string }[] = [
  { value: 'newest', label: 'ใหม่ล่าสุด' },
  { value: 'popular', label: 'ยอดนิยม' },
  { value: 'title', label: 'ชื่อ (ก-ฮ)' },
];

// badge "ฮิต": หนัง viewCount มากสุด 20 เรื่องแรก (ดึงจาก sort=popular)
const HOT_COUNT = 20;

// badge "ใหม่": ดึงเวลาสร้างจาก 4 ไบต์แรกของ ObjectId (id) — ไม่ต้องเพิ่ม field/แก้ backend
// ponytail: ObjectId hex 8 ตัวแรก = unix seconds ของตอน insert
function isNew(id: string): boolean {
  const sec = parseInt(id.slice(0, 8), 16);
  return Number.isFinite(sec) && Date.now() - sec * 1000 < 15 * 24 * 60 * 60 * 1000;
}

// แปลง ISO date -> ข้อความวันที่ภาษาไทยอ่านง่าย
function formatExpiry(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });
}

// สร้างรายการเลขหน้าสำหรับ pager — ย่อด้วย '…' เมื่อหน้าเยอะ (โชว์หน้าแรก/สุดท้าย + เพื่อนบ้านของหน้าปัจจุบัน)
function buildPageList(current: number, totalPages: number): (number | 'gap')[] {
  const pages: (number | 'gap')[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= current - 1 && p <= current + 1)) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== 'gap') {
      pages.push('gap');
    }
  }
  return pages;
}

export function HomePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [movies, setMovies] = useState<PublicMovie[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMovies, setLoadingMovies] = useState(true);
  const [moviesError, setMoviesError] = useState<string | null>(null);

  // ตัวกรอง: คำค้น (q = ค่าที่พิมพ์, qApplied = ค่าหลัง debounce ที่ใช้ยิง API), genre, sort
  const [q, setQ] = useState('');
  const [qApplied, setQApplied] = useState('');
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState<MovieSort>('newest');
  const [genres, setGenres] = useState<string[]>([]);
  const [hotIds, setHotIds] = useState<Set<string>>(new Set());
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [expiryWarnOpen, setExpiryWarnOpen] = useState(false);

  // เหลือเวลาใช้งาน < 1 วัน (และยังไม่หมด) -> ใกล้หมด
  const msLeft = user?.accessExpiresAt ? new Date(user.accessExpiresAt).getTime() - Date.now() : null;
  const expiringSoon = msLeft !== null && msLeft > 0 && msLeft < DAY_MS;

  // เข้าหน้ามาแล้วใกล้หมด -> เด้ง modal เตือน "ครั้งเดียวต่อวัน" (กัน user รำคาญ) ผ่าน localStorage
  useEffect(() => {
    if (!expiringSoon) return;
    const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD ตาม timezone เครื่อง
    if (localStorage.getItem('mdn_expiry_warned') === today) return;
    localStorage.setItem('mdn_expiry_warned', today);
    setExpiryWarnOpen(true);
  }, [expiringSoon]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = qApplied !== '' || genre !== '' || sort !== 'newest';

  // โหลดรายชื่อ genre สำหรับ dropdown (ครั้งเดียวตอน mount; เงียบถ้าพลาด — แค่ dropdown ว่าง)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get<GenreListResponse>('/movies/genres');
        if (active) setGenres(res.genres);
      } catch {
        /* ไม่เป็นไร — ปล่อย dropdown ว่าง */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // top 20 เรื่องยอดวิวสูงสุด = เซ็ต "ฮิต" (ดึงรอบเดียว, ข้ามเรื่อง 0 วิวเพื่อไม่ติดฮิตทั้งที่ยังไม่มีคนดู)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get<MovieListResponse>(`/movies?sort=popular&limit=${HOT_COUNT}`);
        if (active) setHotIds(new Set(res.items.filter((m) => m.viewCount > 0).map((m) => m.id)));
      } catch {
        /* ไม่เป็นไร — ไม่มี badge ฮิต */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // debounce คำค้น 400ms -> qApplied + กลับไปหน้า 1 (กันยิง API ทุกตัวอักษร)
  useEffect(() => {
    const id = window.setTimeout(() => {
      setQApplied(q.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(id);
  }, [q]);

  // ดึงรายการหนังเมื่อเปลี่ยนหน้า/ตัวกรอง
  useEffect(() => {
    let active = true;
    setLoadingMovies(true);
    setMoviesError(null);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      sort,
    });
    if (genre) params.set('genre', genre);
    if (qApplied) params.set('q', qApplied);
    (async () => {
      try {
        const res = await api.get<MovieListResponse>(`/movies?${params.toString()}`);
        if (active) {
          setMovies(res.items);
          setTotal(res.total);
        }
      } catch {
        if (active) setMoviesError('ไม่สามารถโหลดรายการหนังได้');
      } finally {
        if (active) setLoadingMovies(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [page, qApplied, genre, sort]);

  // เปลี่ยน genre/sort แล้ว reset กลับหน้า 1 เสมอ
  const onGenreChange = (value: string): void => {
    setGenre(value);
    setPage(1);
  };
  const onSortChange = (value: MovieSort): void => {
    setSort(value);
    setPage(1);
  };
  // ล้างตัวกรองทั้งหมดกลับค่าเริ่มต้น
  const clearFilters = (): void => {
    setQ('');
    setQApplied('');
    setGenre('');
    setSort('newest');
    setPage(1);
  };

  // เปลี่ยนหน้า + เลื่อนขึ้นบนสุด (clamp กันค่าหลุดช่วง)
  const goToPage = (p: number): void => {
    const next = Math.min(Math.max(1, p), totalPages);
    if (next === page) return;
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ออกจากระบบแล้วกลับไปหน้า login
  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.brandWrap}>
          <img src="/mheedoonung.png" alt="หมีดูหนัง" style={styles.brand} />
          <div>
            <strong>{user?.displayName ?? 'ผู้ใช้'}</strong>
            <span style={expiringSoon ? styles.expiryWarn : styles.expiry}>
              {' '}· สิทธิ์ใช้งานถึง {formatExpiry(user?.accessExpiresAt ?? null)}
            </span>
          </div>
        </div>
        <div className="mdn-home-actions">
          <button type="button" onClick={() => setRedeemOpen(true)} style={styles.topupButton}>
            + เติมเวลา
          </button>
          <button type="button" onClick={handleLogout} style={styles.logoutButton}>
            ออกจากระบบ
          </button>
        </div>
      </header>

      <RedeemModal open={redeemOpen} onClose={() => setRedeemOpen(false)} />
      <ExpiryWarningModal
        open={expiryWarnOpen}
        expiresText={formatExpiry(user?.accessExpiresAt ?? null)}
        onTopup={() => {
          setExpiryWarnOpen(false);
          setRedeemOpen(true);
        }}
        onClose={() => setExpiryWarnOpen(false)}
      />

      <main style={styles.main}>
        <h1 style={styles.ready}>หมีดูหนัง</h1>
        <p style={styles.note}>เราจะนั่งดูหนังหมีไปด้วยกันนน ❤️</p>

        <section>
          <div style={styles.sectionHead}>
            <h2 style={styles.sectionTitle}>รายการหนัง</h2>
            {total > 0 && (
              <span style={styles.resultCount}>
                {/* ทั้งหมด {total} เรื่อง · หน้า {page}/{totalPages} */}
                หน้า {page}/{totalPages}
              </span>
            )}
          </div>
          {/* toolbar: ค้นหา + กรอง genre + เรียงลำดับ */}
          <div style={styles.toolbar}>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อหนัง..."
              style={styles.search}
              aria-label="ค้นหาหนัง"
            />
            <select
              value={genre}
              onChange={(e) => onGenreChange(e.target.value)}
              style={styles.select}
              aria-label="กรองตามหมวดหมู่"
            >
              <option value="">ทุกหมวดหมู่</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as MovieSort)}
              style={styles.select}
              aria-label="เรียงลำดับ"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {hasFilter && (
              <button type="button" onClick={clearFilters} style={styles.clearBtn}>
                ล้างตัวกรอง
              </button>
            )}
          </div>

          {loadingMovies && <p>กำลังโหลดรายการหนัง...</p>}
          {moviesError && <p style={styles.error}>{moviesError}</p>}
          {!loadingMovies && !moviesError && movies.length === 0 && (
            <p>{hasFilter ? 'ไม่พบหนังที่ตรงกับเงื่อนไข' : 'ยังไม่มีหนังในระบบ'}</p>
          )}
          <div style={styles.grid}>
            {movies.map((m) => (
              <Link key={m.id} to={`/movie/${encodeURIComponent(m.slug)}`} style={styles.card}>
                <div style={styles.posterWrap}>
                  <img src={m.posterUrl} alt={m.title} style={styles.poster} loading="lazy" />
                  <div style={styles.badges}>
                    {isNew(m.id) && <span style={styles.badgeNew}>ใหม่</span>}
                    {hotIds.has(m.id) && <span style={styles.badgeHot}>🔥 ฮิต</span>}
                  </div>
                </div>
                <div style={styles.cardBody}>
                  <span style={styles.movieTitle}>{m.title}</span>
                  <span style={styles.meta}>
                    {[m.year, m.contentRating].filter(Boolean).join(' · ')}
                  </span>
                  {m.genres.length > 0 && <span style={styles.genres}>{m.genres.join(', ')}</span>}
                </div>
              </Link>
            ))}
          </div>

          {/* pager — โชว์เมื่อมีมากกว่า 1 หน้า; ปิดปุ่มเมื่ออยู่หน้าแรก/สุดท้าย หรือกำลังโหลด */}
          {totalPages > 1 && (
            <nav style={styles.pager} aria-label="แบ่งหน้า">
              <button
                type="button"
                style={styles.pageBtn}
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || loadingMovies}
              >
                ‹ ก่อนหน้า
              </button>
              {buildPageList(page, totalPages).map((p, i) =>
                p === 'gap' ? (
                  <span key={`gap-${i}`} style={styles.pageGap}>
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    style={p === page ? styles.pageBtnActive : styles.pageBtn}
                    onClick={() => goToPage(p)}
                    disabled={loadingMovies}
                    aria-current={p === page ? 'page' : undefined}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                type="button"
                style={styles.pageBtn}
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages || loadingMovies}
              >
                ถัดไป ›
              </button>
            </nav>
          )}
        </section>
      </main>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#fafafa' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
    background: '#fff',
    borderBottom: '1px solid #eee',
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  brandWrap: { display: 'flex', alignItems: 'center', gap: 10 },
  brand: { width: 40, height: 40, objectFit: 'contain' as const, borderRadius: 8, flexShrink: 0 },
  expiry: { color: '#666', fontSize: 14 },
  // ใกล้หมด (<1 วัน) -> แดงตัวหนา
  expiryWarn: { color: '#dc2626', fontSize: 14, fontWeight: 700 as const },
  // ปุ่ม CTA หลัก — gradient + เงา ให้เด่น
  topupButton: {
    padding: '9px 18px',
    background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    boxShadow: '0 2px 8px rgba(37,99,235,0.35)',
  },
  // ออกจากระบบ = destructive -> แดง (outline อ่อน ไม่แย่งเด่นกับ CTA)
  logoutButton: {
    padding: '9px 14px',
    background: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fca5a5',
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  main: { maxWidth: 1080, margin: '0 auto', padding: 24 },
  ready: { fontSize: 28, margin: '0 0 4px' },
  note: { color: '#666', marginTop: 0 },
  sectionHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 8,
    marginTop: 24,
  },
  sectionTitle: { fontSize: 18, margin: 0 },
  resultCount: { color: '#888', fontSize: 13 },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 8,
    margin: '12px 0 16px',
  },
  search: {
    flex: '1 1 220px',
    minWidth: 160,
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
  },
  select: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
    cursor: 'pointer',
  },
  clearBtn: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    background: '#f3f3f3',
    color: '#555',
    cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 16,
  },
  card: {
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 10,
    overflow: 'hidden' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    textDecoration: 'none',
    color: 'inherit',
  },
  posterWrap: { position: 'relative' as const, background: '#111' },
  // contain = ไม่ครอป (โชว์ภาพเต็ม ชื่อในภาพไม่ขาด) แลกกับมีแถบดำเมื่อสัดส่วนไม่ใช่ 2:3
  poster: { width: '100%', aspectRatio: '2 / 3', objectFit: 'contain' as const, display: 'block' },
  badges: { position: 'absolute' as const, top: 8, left: 8, display: 'flex', flexDirection: 'column' as const, gap: 4, alignItems: 'flex-start' },
  badgeNew: { background: '#2e7d32', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4 },
  badgeHot: { background: '#e50914', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4 },
  cardBody: { padding: 10, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  movieTitle: { fontWeight: 600, fontSize: 15 },
  meta: { color: '#888', fontSize: 12 },
  genres: { color: '#aaa', fontSize: 12 },
  error: { color: '#d33' },
  pager: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 24,
  },
  pageBtn: {
    minWidth: 38,
    padding: '6px 10px',
    background: '#fff',
    border: '1px solid #ddd',
    borderRadius: 6,
    color: '#333',
    fontSize: 14,
    cursor: 'pointer',
  },
  pageBtnActive: {
    minWidth: 38,
    padding: '6px 10px',
    background: '#e50914',
    border: '1px solid #e50914',
    borderRadius: 6,
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'default',
  },
  pageGap: { padding: '6px 4px', color: '#aaa', fontSize: 14 },
} as const;
