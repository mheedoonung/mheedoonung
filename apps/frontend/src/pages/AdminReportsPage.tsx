// หน้าดูรายการแจ้งปัญหาของแอดมิน (route /admin/reports — อยู่ใต้ AdminLayout)
// - filter ตามสถานะ (default: ค้างอยู่) + แบ่งหน้า
// - ปุ่มสลับสถานะ จัดการแล้ว/เปิดใหม่ ต่อรายการ
import { useCallback, useEffect, useState } from 'react';
import type { ReportListItem, ReportListResponse } from '@mheedoonung/shared';
import { api } from '../api/client';

const PAGE_LIMIT = 50;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

type StatusFilter = 'open' | 'resolved' | '';

export function AdminReportsPage() {
  const [items, setItems] = useState<ReportListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [page, setPage] = useState(1);
  // default โชว์เฉพาะที่ค้างอยู่ — คือสิ่งที่ admin เข้ามาดู
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.get<ReportListResponse>(`/admin/reports?${params.toString()}`);
      setItems(res.items);
      setTotal(res.total);
      setOpenCount(res.openCount);
    } catch {
      setError('ไม่สามารถโหลดรายการแจ้งปัญหาได้');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // สลับสถานะรายการเดียวแล้วโหลดใหม่
  const toggleStatus = async (r: ReportListItem): Promise<void> => {
    try {
      await api.post(`/admin/reports/${encodeURIComponent(r.id)}/status`, {
        status: r.status === 'open' ? 'resolved' : 'open',
      });
      await load();
    } catch {
      setError('อัปเดตสถานะไม่สำเร็จ');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>
        แจ้งปัญหา{openCount > 0 && <span style={styles.openBadge}>{openCount} ค้างอยู่</span>}
      </h1>

      <section style={styles.section}>
        <div style={styles.listHeader}>
          <h2 style={styles.sectionTitle}>รายการ ({total})</h2>
          <label style={styles.filterLabel}>
            สถานะ:
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setPage(1);
              }}
              style={styles.select}
            >
              <option value="open">ค้างอยู่</option>
              <option value="resolved">จัดการแล้ว</option>
              <option value="">ทั้งหมด</option>
            </select>
          </label>
        </div>

        {error && <p style={styles.error}>{error}</p>}
        {loading && <p>กำลังโหลด...</p>}
        {!loading && items.length === 0 && (
          <p style={styles.muted}>{statusFilter === 'open' ? 'ไม่มีเรื่องค้าง 🎉' : 'ไม่มีรายการ'}</p>
        )}

        <div style={styles.list}>
          {items.map((r) => (
            <article key={r.id} style={r.status === 'open' ? styles.cardOpen : styles.card}>
              <div style={styles.cardHead}>
                <div style={styles.userWrap}>
                  {r.user?.pictureUrl ? (
                    <img src={r.user.pictureUrl} alt="" style={styles.avatar} />
                  ) : (
                    <div style={styles.avatarFallback}>👤</div>
                  )}
                  <div>
                    <div style={styles.userName}>
                      {r.user?.displayName ?? '(user ถูกลบ)'}
                      <span style={styles.categoryChip}>{r.category}</span>
                    </div>
                    <div style={styles.metaLine}>{formatDate(r.createdAt)}</div>
                  </div>
                </div>
                <button
                  type="button"
                  style={r.status === 'open' ? styles.resolveBtn : styles.reopenBtn}
                  onClick={() => void toggleStatus(r)}
                >
                  {r.status === 'open' ? '✓ จัดการแล้ว' : 'เปิดใหม่'}
                </button>
              </div>
              <p style={styles.reportText}>{r.text}</p>
              {r.context && (r.context.movieSlug || r.context.path || r.context.userAgent) && (
                <div style={styles.contextBox}>
                  {r.context.movieSlug && <span>🎬 {r.context.movieSlug}</span>}
                  {r.context.path && <span>📍 {r.context.path}</span>}
                  {r.context.userAgent && <span style={styles.ua}>{r.context.userAgent}</span>}
                </div>
              )}
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
  title: { fontSize: 26, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 },
  openBadge: {
    background: '#fff7ed',
    color: '#c2410c',
    border: '1px solid #fdba74',
    borderRadius: 999,
    padding: '3px 12px',
    fontSize: 13,
    fontWeight: 600,
  },
  section: {
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  sectionTitle: { fontSize: 18, margin: 0 },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 8,
    marginBottom: 12,
  },
  filterLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 },
  select: { padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 12 },
  card: {
    border: '1px solid #f0f0f0',
    borderRadius: 10,
    padding: '12px 14px',
    background: '#fcfcfc',
    opacity: 0.75,
  },
  // เรื่องค้าง = เด่นกว่า (ขอบส้มอ่อน พื้นขาว)
  cardOpen: {
    border: '1px solid #fed7aa',
    borderRadius: 10,
    padding: '12px 14px',
    background: '#fff',
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
  userName: { fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  categoryChip: {
    background: '#fff7ed',
    color: '#c2410c',
    borderRadius: 999,
    padding: '2px 10px',
    fontSize: 12,
    fontWeight: 600,
  },
  metaLine: { color: '#888', fontSize: 12 },
  reportText: { margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' as const },
  contextBox: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 10,
    marginTop: 10,
    padding: '8px 10px',
    background: '#f8fafc',
    borderRadius: 8,
    fontSize: 12,
    color: '#666',
  },
  ua: { color: '#aaa', wordBreak: 'break-all' as const },
  resolveBtn: {
    padding: '6px 14px',
    background: '#f0fdf4',
    color: '#15803d',
    border: '1px solid #86efac',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  reopenBtn: {
    padding: '6px 14px',
    background: '#fff',
    color: '#888',
    border: '1px solid #ddd',
    borderRadius: 999,
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
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
