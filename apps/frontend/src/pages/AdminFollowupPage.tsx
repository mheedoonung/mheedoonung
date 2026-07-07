// หน้า "ติดตามลูกค้า" ของแอดมิน (route /admin/followup — อยู่ใต้ AdminLayout)
// สองกลุ่ม: สิทธิ์ใกล้หมด (รีบทักก่อนหมด) / เพิ่งหมดไป (ตามกลับมาเติม) + ปุ่ม copy LINE ID
import { useCallback, useEffect, useState } from 'react';
import type { FollowupResponse, FollowupUserItem } from '@mheedoonung/shared';
import { api } from '../api/client';

// แปลงเวลาห่างจากตอนนี้ -> ข้อความไทย เช่น "เหลือ 2 วัน 3 ชม." / "หมดไปแล้ว 5 วัน"
function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const span = days > 0 ? `${days} วัน ${hours} ชม.` : hours > 0 ? `${hours} ชม.` : 'ไม่ถึงชั่วโมง';
  return ms > 0 ? `เหลือ ${span}` : `หมดไปแล้ว ${span}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

export function AdminFollowupPage() {
  const [soonDays, setSoonDays] = useState(3);
  const [expiredDays, setExpiredDays] = useState(7);
  const [data, setData] = useState<FollowupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<FollowupResponse>(
        `/admin/followup?soonDays=${soonDays}&expiredDays=${expiredDays}`,
      );
      setData(res);
    } catch {
      setError('โหลดรายชื่อไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [soonDays, expiredDays]);

  useEffect(() => {
    void load();
  }, [load]);

  // copy LINE userId ไว้ไปค้นในหลังบ้าน OA — โชว์ "คัดลอกแล้ว" แป๊บนึง
  const copyLineId = async (u: FollowupUserItem): Promise<void> => {
    try {
      await navigator.clipboard.writeText(u.lineUserId);
      setCopiedId(u.id);
      window.setTimeout(() => setCopiedId((c) => (c === u.id ? null : c)), 1500);
    } catch {
      /* clipboard ใช้ไม่ได้ (ไม่ใช่ https) — เงียบ */
    }
  };

  const renderGroup = (items: FollowupUserItem[], variant: 'soon' | 'expired') => (
    <div style={styles.list}>
      {items.length === 0 && <p style={styles.muted}>ไม่มีรายชื่อในช่วงนี้</p>}
      {items.map((u) => (
        <article key={u.id} style={variant === 'soon' ? styles.cardSoon : styles.cardExpired}>
          <div style={styles.userWrap}>
            {u.pictureUrl ? (
              <img src={u.pictureUrl} alt="" style={styles.avatar} />
            ) : (
              <div style={styles.avatarFallback}>👤</div>
            )}
            <div>
              <div style={styles.userName}>{u.displayName}</div>
              <div style={styles.metaLine}>
                <span style={variant === 'soon' ? styles.timeSoon : styles.timeExpired}>
                  {timeUntil(u.accessExpiresAt)}
                </span>
                {' · '}หมด {formatDate(u.accessExpiresAt)}
              </div>
              <div style={styles.metaSub}>เป็นลูกค้าตั้งแต่ {formatDate(u.createdAt)}</div>
            </div>
          </div>
          <button type="button" style={styles.copyBtn} onClick={() => void copyLineId(u)}>
            {copiedId === u.id ? '✓ คัดลอกแล้ว' : 'คัดลอก LINE ID'}
          </button>
        </article>
      ))}
    </div>
  );

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>ติดตามลูกค้า</h1>
      <p style={styles.subtitle}>รายชื่อสำหรับ follow ขายซ้ำ — ทักผ่าน LINE OA ด้วย LINE ID ที่คัดลอก</p>

      {error && <p style={styles.error}>{error}</p>}
      {loading && !data && <p>กำลังโหลด...</p>}

      <section style={styles.section}>
        <div style={styles.sectionHead}>
          <h2 style={styles.sectionTitle}>
            🔔 ใกล้หมด{data ? ` (${data.expiringSoon.length})` : ''}
          </h2>
          <label style={styles.filterLabel}>
            ภายใน:
            <select
              value={soonDays}
              onChange={(e) => setSoonDays(Number(e.target.value))}
              style={styles.select}
            >
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} วัน
                </option>
              ))}
            </select>
          </label>
        </div>
        {data && renderGroup(data.expiringSoon, 'soon')}
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHead}>
          <h2 style={styles.sectionTitle}>
            ⌛ เพิ่งหมดไป{data ? ` (${data.recentlyExpired.length})` : ''}
          </h2>
          <label style={styles.filterLabel}>
            ย้อนหลัง:
            <select
              value={expiredDays}
              onChange={(e) => setExpiredDays(Number(e.target.value))}
              style={styles.select}
            >
              {[3, 7, 14, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {d} วัน
                </option>
              ))}
            </select>
          </label>
        </div>
        {data && renderGroup(data.recentlyExpired, 'expired')}
      </section>
    </main>
  );
}

const styles = {
  main: { maxWidth: 900, margin: '0 auto', padding: 24 },
  title: { fontSize: 26, margin: '0 0 4px' },
  subtitle: { color: '#777', fontSize: 14, marginTop: 0 },
  section: {
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 18, margin: 0 },
  filterLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 },
  select: { padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  cardSoon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 10,
    border: '1px solid #fde68a',
    background: '#fffbeb',
    borderRadius: 10,
    padding: '10px 14px',
  },
  cardExpired: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 10,
    border: '1px solid #f0f0f0',
    background: '#fcfcfc',
    borderRadius: 10,
    padding: '10px 14px',
  },
  userWrap: { display: 'flex', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: '50%', objectFit: 'cover' as const },
  avatarFallback: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    background: '#eee',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
  },
  userName: { fontWeight: 600, fontSize: 15 },
  metaLine: { color: '#666', fontSize: 13, marginTop: 2 },
  metaSub: { color: '#aaa', fontSize: 12, marginTop: 2 },
  timeSoon: { color: '#b45309', fontWeight: 700 },
  timeExpired: { color: '#dc2626', fontWeight: 700 },
  copyBtn: {
    padding: '7px 14px',
    background: '#fff',
    color: '#2563eb',
    border: '1px solid #bfdbfe',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  muted: { color: '#999' },
  error: { color: '#d33' },
} as const;
