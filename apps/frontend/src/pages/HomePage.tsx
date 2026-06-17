// หน้าหลักของผู้ใช้ — เข้าได้เมื่อ login และ active แล้ว (ตรวจผ่าน ProtectedRoute requireActive)
// - แสดงข้อความต้อนรับ + วันหมดอายุสิทธิ์
// - ดึง /movies (MovieListResponse) มาแสดงเป็น grid โปสเตอร์ (player เป็นเฟสถัดไป)
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PublicMovie, MovieListResponse } from '@mheedoonung/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

// แปลง ISO date -> ข้อความวันที่ภาษาไทยอ่านง่าย
function formatExpiry(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });
}

export function HomePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [movies, setMovies] = useState<PublicMovie[]>([]);
  const [loadingMovies, setLoadingMovies] = useState(true);
  const [moviesError, setMoviesError] = useState<string | null>(null);

  // ดึงรายการหนังตอน mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get<MovieListResponse>('/movies');
        if (active) setMovies(res.items);
      } catch {
        if (active) setMoviesError('ไม่สามารถโหลดรายการหนังได้');
      } finally {
        if (active) setLoadingMovies(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // ออกจากระบบแล้วกลับไปหน้า login
  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <strong>{user?.displayName ?? 'ผู้ใช้'}</strong>
          <span style={styles.expiry}> · สิทธิ์ใช้งานถึง {formatExpiry(user?.accessExpiresAt ?? null)}</span>
        </div>
        <button type="button" onClick={handleLogout} style={styles.logoutButton}>
          ออกจากระบบ
        </button>
      </header>

      <main style={styles.main}>
        <h1 style={styles.ready}>พร้อมดูหนัง</h1>
        <p style={styles.note}>เลือกเรื่องที่ต้องการรับชม (ระบบเล่นวิดีโอจะเปิดในเฟสถัดไป)</p>

        <section>
          <h2 style={styles.sectionTitle}>รายการหนัง</h2>
          {loadingMovies && <p>กำลังโหลดรายการหนัง...</p>}
          {moviesError && <p style={styles.error}>{moviesError}</p>}
          {!loadingMovies && !moviesError && movies.length === 0 && <p>ยังไม่มีหนังในระบบ</p>}
          <div style={styles.grid}>
            {movies.map((m) => (
              <Link key={m.id} to={`/movie/${encodeURIComponent(m.slug)}`} style={styles.card}>
                <img src={m.posterUrl} alt={m.title} style={styles.poster} loading="lazy" />
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
    background: '#fff',
    borderBottom: '1px solid #eee',
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  expiry: { color: '#666', fontSize: 14 },
  logoutButton: {
    padding: '6px 12px',
    background: '#eee',
    border: '1px solid #ccc',
    borderRadius: 6,
    cursor: 'pointer',
  },
  main: { maxWidth: 1080, margin: '0 auto', padding: 24 },
  ready: { fontSize: 28, margin: '0 0 4px' },
  note: { color: '#666', marginTop: 0 },
  sectionTitle: { fontSize: 18, marginTop: 24 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
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
  poster: { width: '100%', aspectRatio: '2 / 3', objectFit: 'cover' as const, display: 'block' },
  cardBody: { padding: 10, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  movieTitle: { fontWeight: 600, fontSize: 15 },
  meta: { color: '#888', fontSize: 12 },
  genres: { color: '#aaa', fontSize: 12 },
  error: { color: '#d33' },
} as const;
