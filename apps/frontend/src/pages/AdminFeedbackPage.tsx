// หน้าดู feedback ของแอดมิน (route /admin/feedback — อยู่ใต้ AdminLayout, สิทธิ์ถูกเช็คที่ layout แล้ว)
// - สรุป: จำนวน, คะแนนเฉลี่ย, histogram ดาว, จำนวนต่อ tag
// - รายการ: กรองตามดาว + แบ่งหน้า
import { useCallback, useEffect, useState } from 'react';
import type { FeedbackListItem, FeedbackListResponse, FeedbackSummaryResponse } from '@mheedoonung/shared';
import { api } from '../api/client';

const PAGE_LIMIT = 50;

// แปลงวินาทีดูสะสม -> ข้อความอ่านง่าย เช่น "3.5 ชม."
function formatWatch(seconds: number): string {
  const hours = seconds / 3600;
  if (hours >= 1) return `${Math.round(hours * 10) / 10} ชม.`;
  return `${Math.round(seconds / 60)} นาที`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

// ดาวเต็ม/จาง ตามคะแนน เช่น rating 3 -> ⭐⭐⭐ + จาง 2 ดวง
function Stars({ rating }: { rating: number }): JSX.Element {
  return (
    <span aria-label={`${rating} ดาว`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ opacity: n <= rating ? 1 : 0.2 }}>
          ⭐
        </span>
      ))}
    </span>
  );
}

type RatingFilter = '' | '1' | '2' | '3' | '4' | '5';

export function AdminFeedbackPage() {
  const [summary, setSummary] = useState<FeedbackSummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [items, setItems] = useState<FeedbackListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // โหลดสรุปครั้งเดียวตอน mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get<FeedbackSummaryResponse>('/admin/feedbacks/summary');
        if (active) setSummary(res);
      } catch {
        if (active) setSummaryError('ไม่สามารถโหลดสรุปได้');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const loadList = useCallback(async (): Promise<void> => {
    setLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
      if (ratingFilter) params.set('rating', ratingFilter);
      const res = await api.get<FeedbackListResponse>(`/admin/feedbacks?${params.toString()}`);
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setListError('ไม่สามารถโหลดรายการ feedback ได้');
    } finally {
      setLoading(false);
    }
  }, [page, ratingFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Feedback จากผู้ใช้</h1>

      {/* สรุปภาพรวม */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>ภาพรวม</h2>
        {summaryError && <p style={styles.error}>{summaryError}</p>}
        {!summary && !summaryError && <p>กำลังโหลดสรุป...</p>}
        {summary && (
          <>
            <div style={styles.statGrid}>
              <div style={styles.statBox}>
                <span style={styles.statValue}>{summary.total}</span>
                <span style={styles.statLabel}>ทั้งหมด</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statValue}>{summary.avgRating ?? '-'}</span>
                <span style={styles.statLabel}>คะแนนเฉลี่ย</span>
              </div>
              {summary.byRating.map((r) => (
                <div key={r.rating} style={styles.statBox}>
                  <span style={styles.statValue}>{r.count}</span>
                  <span style={styles.statLabel}>{r.rating} ดาว</span>
                </div>
              ))}
            </div>
            {summary.byTag.length > 0 && (
              <div style={styles.tagSummary}>
                {summary.byTag.map((tg) => (
                  <span key={tg.tag} style={styles.tagCount}>
                    {tg.tag} <strong>{tg.count}</strong>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* รายการ feedback */}
      <section style={styles.section}>
        <div style={styles.listHeader}>
          <h2 style={styles.sectionTitle}>รายการ ({total})</h2>
          <label style={styles.filterLabel}>
            กรองตามดาว:
            <select
              value={ratingFilter}
              onChange={(e) => {
                setRatingFilter(e.target.value as RatingFilter);
                setPage(1);
              }}
              style={styles.select}
            >
              <option value="">ทั้งหมด</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={String(n)}>
                  {n} ดาว
                </option>
              ))}
            </select>
          </label>
        </div>

        {listError && <p style={styles.error}>{listError}</p>}
        {loading && <p>กำลังโหลด...</p>}
        {!loading && items.length === 0 && <p style={styles.muted}>ยังไม่มี feedback</p>}

        <div style={styles.list}>
          {items.map((f) => (
            <article key={f.id} style={styles.card}>
              <div style={styles.cardHead}>
                <div style={styles.userWrap}>
                  {f.user?.pictureUrl ? (
                    <img src={f.user.pictureUrl} alt="" style={styles.avatar} />
                  ) : (
                    <div style={styles.avatarFallback}>👤</div>
                  )}
                  <div>
                    <div style={styles.userName}>{f.user?.displayName ?? '(user ถูกลบ)'}</div>
                    <div style={styles.metaLine}>
                      ดูสะสม {formatWatch(f.watchSeconds)} · {formatDate(f.createdAt)}
                    </div>
                  </div>
                </div>
                <Stars rating={f.rating} />
              </div>
              {f.tags.length > 0 && (
                <div style={styles.chips}>
                  {f.tags.map((tag) => (
                    <span key={tag} style={styles.chip}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {f.text && <p style={styles.feedbackText}>{f.text}</p>}
            </article>
          ))}
        </div>

        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              style={styles.pageButton}
            >
              ก่อนหน้า
            </button>
            <span>
              หน้า {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              style={styles.pageButton}
            >
              ถัดไป
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

const styles = {
  main: { maxWidth: 900, margin: '0 auto', padding: 24 },
  title: { fontSize: 26, marginBottom: 16 },
  section: {
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  sectionTitle: { fontSize: 18, margin: '0 0 12px' },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
    gap: 12,
  },
  statBox: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    padding: '14px 10px',
    background: '#f8fafc',
    border: '1px solid #eee',
    borderRadius: 10,
  },
  statValue: { fontSize: 24, fontWeight: 700, color: '#111' },
  statLabel: { fontSize: 13, color: '#666' },
  tagSummary: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginTop: 14 },
  tagCount: {
    padding: '6px 12px',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: 999,
    fontSize: 13,
    color: '#444',
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  filterLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 },
  select: { padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 12, marginTop: 12 },
  card: {
    border: '1px solid #f0f0f0',
    borderRadius: 10,
    padding: '12px 14px',
    background: '#fcfcfc',
  },
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  userWrap: { display: 'flex', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' as const },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#eee',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
  },
  userName: { fontWeight: 600, fontSize: 15 },
  metaLine: { color: '#888', fontSize: 12 },
  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginTop: 10 },
  chip: {
    padding: '4px 10px',
    background: '#eef2ff',
    color: '#4f46e5',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
  },
  feedbackText: { margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' as const },
  muted: { color: '#999' },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 16,
  },
  pageButton: {
    padding: '6px 14px',
    background: '#eee',
    border: '1px solid #ccc',
    borderRadius: 6,
    cursor: 'pointer',
  },
  error: { color: '#d33', marginTop: 12 },
} as const;
