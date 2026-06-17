// หน้ารายละเอียดหนัง (เฟส 6) — ดึง GET /movies/:slug แล้วมีปุ่ม "เล่น" ไป /watch/:slug
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { PublicMovie } from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';

type Status = 'loading' | 'ready' | 'notfound' | 'error';

// วินาที -> "X ชม. Y นาที"
function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h} ชม. ${m} นาที`;
  return `${m} นาที`;
}

export function MovieDetailPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [movie, setMovie] = useState<PublicMovie | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await api.get<PublicMovie>(`/movies/${encodeURIComponent(slug)}`);
        if (!alive) return;
        setMovie(m);
        setStatus('ready');
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiClientError && e.status === 403) {
          navigate('/redeem', { replace: true });
          return;
        }
        if (e instanceof ApiClientError && e.status === 404) {
          setStatus('notfound');
          return;
        }
        setStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, navigate]);

  if (status === 'loading') return <div style={styles.msgPage}>กำลังโหลด...</div>;
  if (status === 'notfound')
    return (
      <div style={styles.msgPage}>
        ไม่พบหนังที่ต้องการ · <Link to="/">กลับหน้าหลัก</Link>
      </div>
    );
  if (status === 'error' || !movie)
    return (
      <div style={styles.msgPage}>
        เกิดข้อผิดพลาด · <Link to="/">กลับหน้าหลัก</Link>
      </div>
    );

  return (
    <div style={styles.page}>
      {/* ภาพแนวนอน (ถ้ามี) เป็น hero */}
      {movie.backdropUrl && (
        <div style={{ ...styles.hero, backgroundImage: `url(${movie.backdropUrl})` }} />
      )}

      <div style={styles.body}>
        <Link to="/" style={styles.back}>
          ← กลับ
        </Link>

        <div style={styles.head}>
          <img src={movie.posterUrl} alt={movie.title} style={styles.poster} />
          <div style={styles.info}>
            <h1 style={styles.title}>{movie.title}</h1>
            {movie.originalTitle && <p style={styles.original}>{movie.originalTitle}</p>}
            <p style={styles.meta}>
              {[movie.year, formatDuration(movie.durationSec), movie.contentRating]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {movie.genres.length > 0 && <p style={styles.genres}>{movie.genres.join(' · ')}</p>}
            <button
              type="button"
              style={styles.playBtn}
              onClick={() => navigate(`/watch/${encodeURIComponent(movie.slug)}`)}
            >
              ▶ เล่น
            </button>
          </div>
        </div>

        <p style={styles.synopsis}>{movie.synopsis}</p>

        {movie.director && (
          <p style={styles.credit}>
            <strong>ผู้กำกับ:</strong> {movie.director}
          </p>
        )}
        {movie.cast && movie.cast.length > 0 && (
          <p style={styles.credit}>
            <strong>นักแสดง:</strong> {movie.cast.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}

const styles = {
  msgPage: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' },
  page: { minHeight: '100vh', background: '#fafafa' },
  hero: {
    height: 240,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'brightness(0.7)',
  },
  body: { maxWidth: 860, margin: '0 auto', padding: 24 },
  back: { display: 'inline-block', marginBottom: 16, color: '#555', textDecoration: 'none' },
  head: { display: 'flex', gap: 20, flexWrap: 'wrap' as const },
  poster: { width: 180, aspectRatio: '2 / 3', objectFit: 'cover' as const, borderRadius: 10, background: '#eee' },
  info: { flex: 1, minWidth: 240 },
  title: { fontSize: 26, margin: '0 0 4px' },
  original: { color: '#888', margin: '0 0 8px' },
  meta: { color: '#666', margin: '0 0 6px' },
  genres: { color: '#999', margin: '0 0 16px' },
  playBtn: {
    padding: '10px 24px',
    background: '#e50914',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    cursor: 'pointer',
  },
  synopsis: { marginTop: 24, lineHeight: 1.7, color: '#333' },
  credit: { color: '#555', margin: '8px 0' },
} as const;
