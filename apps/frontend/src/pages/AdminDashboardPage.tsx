// หน้า Dashboard สรุปการใช้งาน (route /admin/dashboard — เมนูสุดท้ายของ admin)
// อ่านจาก /admin/dashboard ที่ pre-aggregate ไว้แล้ว — เบา ไม่มี query หนัก
// กราฟแท่ง = CSS ล้วน (ponytail: ไม่ลง chart library — แท่ง 30 อันไม่ต้องพึ่งอะไร)
import { useEffect, useState } from 'react';
import type { DashboardResponse, DashboardView, StatPoint } from '@mheedoonung/shared';
import { api } from '../api/client';

// metric ที่เลือกดูในกราฟ
const METRICS = [
  { key: 'plays', label: 'ยอดเปิดดู' },
  { key: 'activeUsers', label: 'คนดู (ไม่ซ้ำรายวัน)' },
  { key: 'newUsers', label: 'สมัครใหม่' },
  { key: 'redeems', label: 'บัตรที่เติม' },
  { key: 'daysSold', label: 'วันที่ขายได้' },
] as const;
type MetricKey = (typeof METRICS)[number]['key'];

// label แกน x แบบสั้น: รายวัน = 8, 15, 22 (วันที่) / รายเดือน = ม.ค.
function shortLabel(key: string): string {
  if (key.length === 10) return String(Number(key.slice(8)));
  const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return monthNames[Number(key.slice(5, 7)) - 1] ?? key;
}

export function AdminDashboardPage() {
  const [view, setView] = useState<DashboardView>('daily');
  const [metric, setMetric] = useState<MetricKey>('plays');
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    (async () => {
      try {
        const res = await api.get<DashboardResponse>(`/admin/dashboard?view=${view}`);
        if (active) setData(res);
      } catch {
        if (active) setError('โหลดข้อมูลไม่สำเร็จ');
      }
    })();
    return () => {
      active = false;
    };
  }, [view]);

  const series = data?.series ?? [];
  const max = Math.max(1, ...series.map((p) => p[metric]));
  const totalInRange = series.reduce((s, p) => s + p[metric], 0);
  const metricLabel = METRICS.find((m) => m.key === metric)!.label;

  const todayCards: { label: string; value: number }[] = data
    ? [
        { label: 'ยอดเปิดดูวันนี้', value: data.today.plays },
        { label: 'คนดูวันนี้ (ไม่ซ้ำ)', value: data.today.activeUsers },
        { label: 'สมัครใหม่วันนี้', value: data.today.newUsers },
        { label: 'บัตรที่เติมวันนี้', value: data.today.redeems },
      ]
    : [];

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Dashboard</h1>

      {error && <p style={styles.error}>{error}</p>}
      {!data && !error && <p>กำลังโหลด...</p>}

      {data && (
        <>
          {/* สรุปวันนี้ */}
          <div style={styles.statGrid}>
            {todayCards.map((c) => (
              <div key={c.label} style={styles.statBox}>
                <span style={styles.statValue}>{c.value.toLocaleString('th-TH')}</span>
                <span style={styles.statLabel}>{c.label}</span>
              </div>
            ))}
          </div>

          {/* กราฟย้อนหลัง */}
          <section style={styles.section}>
            <div style={styles.chartHead}>
              <h2 style={styles.sectionTitle}>
                {view === 'daily' ? 'ย้อนหลัง 30 วัน' : 'ย้อนหลัง 12 เดือน'} · รวม{' '}
                {totalInRange.toLocaleString('th-TH')} {metricLabel}
              </h2>
              <div style={styles.controls}>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as MetricKey)}
                  style={styles.select}
                >
                  {METRICS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <div style={styles.toggle}>
                  <button
                    type="button"
                    style={view === 'daily' ? styles.toggleActive : styles.toggleBtn}
                    onClick={() => setView('daily')}
                  >
                    รายวัน
                  </button>
                  <button
                    type="button"
                    style={view === 'monthly' ? styles.toggleActive : styles.toggleBtn}
                    onClick={() => setView('monthly')}
                  >
                    รายเดือน
                  </button>
                </div>
              </div>
            </div>

            <div style={styles.chart}>
              {series.map((p: StatPoint) => (
                <div key={p.key} style={styles.barCol} title={`${p.key} — ${metricLabel}: ${p[metric].toLocaleString('th-TH')}`}>
                  <span style={styles.barValue}>{p[metric] > 0 ? p[metric] : ''}</span>
                  <div
                    style={{
                      ...styles.bar,
                      height: `${Math.max(2, Math.round((p[metric] / max) * 140))}px`,
                      ...(p[metric] === 0 ? styles.barZero : {}),
                    }}
                  />
                  <span style={styles.barLabel}>{shortLabel(p.key)}</span>
                </div>
              ))}
            </div>
            {view === 'monthly' && metric === 'activeUsers' && (
              <p style={styles.note}>* รายเดือน = ผลรวมคนดูไม่ซ้ำรายวัน (คนเดิมดูหลายวันนับหลายครั้ง)</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

const styles = {
  main: { maxWidth: 900, margin: '0 auto', padding: 24 },
  title: { fontSize: 26, marginBottom: 16 },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 12,
    marginBottom: 24,
  },
  statBox: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    padding: '18px 10px',
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 12,
  },
  statValue: { fontSize: 28, fontWeight: 700, color: '#111' },
  statLabel: { fontSize: 13, color: '#666' },
  section: {
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 12,
    padding: 20,
  },
  chartHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 10,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, margin: 0, color: '#444' },
  controls: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  select: { padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 },
  toggle: { display: 'flex', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' as const },
  toggleBtn: {
    padding: '6px 14px',
    background: '#fff',
    color: '#666',
    border: 'none',
    fontSize: 13,
    cursor: 'pointer',
  },
  toggleActive: {
    padding: '6px 14px',
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  // กราฟแท่ง: flex row เท่ากันทุกแท่ง สูงตามสัดส่วน max
  chart: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 3,
    height: 190,
    overflowX: 'auto' as const,
    paddingBottom: 4,
  },
  barCol: {
    flex: 1,
    minWidth: 14,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
  },
  barValue: { fontSize: 10, color: '#888', lineHeight: 1 },
  bar: {
    width: '100%',
    maxWidth: 34,
    background: 'linear-gradient(180deg, #6366f1, #4f46e5)',
    borderRadius: '4px 4px 0 0',
  },
  barZero: { background: '#eee' },
  barLabel: { fontSize: 10, color: '#aaa', lineHeight: 1 },
  note: { color: '#999', fontSize: 12, margin: '10px 0 0' },
  error: { color: '#d33' },
} as const;
