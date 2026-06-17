// หน้าจัดการบัตรของแอดมิน (route /admin/cards)
// - ตรวจสิทธิ์แอดมินผ่าน GET /admin/me ตอน mount; ถ้าไม่ใช่แอดมิน -> เด้งไป /admin
// - ฟอร์มสร้างบัตร (days, quantity, note) -> POST /admin/cards แสดง codes ที่สร้าง
// - ตาราง GET /admin/cards (กรองตาม status + แบ่งหน้า) + ปุ่ม revoke บัตร unused
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  CardListItem,
  CardListResponse,
  CardStatus,
  CreateCardsBody,
  CreateCardsResponse,
} from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';

// จำนวนต่อหน้าในตาราง
const PAGE_LIMIT = 50;

// ตัวเลือกตัวกรองสถานะ ('' = ทั้งหมด)
type StatusFilter = '' | CardStatus;

// แปลงสถานะบัตร -> ข้อความภาษาไทย
function statusLabel(s: CardStatus): string {
  switch (s) {
    case 'unused':
      return 'ยังไม่ใช้';
    case 'redeemed':
      return 'ใช้แล้ว';
    case 'revoked':
      return 'ยกเลิกแล้ว';
    default:
      return s;
  }
}

export function AdminCardsPage() {
  const navigate = useNavigate();

  // สถานะการตรวจสิทธิ์แอดมิน: 'checking' | 'authorized' | 'denied'
  const [authState, setAuthState] = useState<'checking' | 'authorized' | 'denied'>('checking');

  // ---- state ของฟอร์มสร้างบัตร ----
  const [days, setDays] = useState('30');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdCodes, setCreatedCodes] = useState<string[]>([]);

  // ---- state ของตารางบัตร ----
  const [items, setItems] = useState<CardListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // ตรวจสิทธิ์แอดมินตอน mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.get<{ admin: { username: string } }>('/admin/me');
        if (active) setAuthState('authorized');
      } catch {
        if (active) setAuthState('denied');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // ถ้าไม่ใช่แอดมิน -> เด้งไปหน้า login แอดมิน
  useEffect(() => {
    if (authState === 'denied') {
      navigate('/admin', { replace: true });
    }
  }, [authState, navigate]);

  // โหลดรายการบัตร (ตาม page + status filter ปัจจุบัน)
  const loadCards = useCallback(async (): Promise<void> => {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(PAGE_LIMIT));
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.get<CardListResponse>(`/admin/cards?${params.toString()}`);
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setListError('ไม่สามารถโหลดรายการบัตรได้');
    } finally {
      setListLoading(false);
    }
  }, [page, statusFilter]);

  // โหลดรายการบัตรเมื่อได้รับสิทธิ์ หรือเมื่อ page/filter เปลี่ยน
  useEffect(() => {
    if (authState === 'authorized') {
      void loadCards();
    }
  }, [authState, loadCards]);

  // สร้างบัตรใหม่
  const handleCreate = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const daysNum = Number(days);
    const qtyNum = Number(quantity);
    if (!Number.isInteger(daysNum) || daysNum <= 0) {
      setCreateError('จำนวนวันต้องเป็นจำนวนเต็มบวก');
      return;
    }
    if (!Number.isInteger(qtyNum) || qtyNum <= 0 || qtyNum > 1000) {
      setCreateError('จำนวนบัตรต้องอยู่ระหว่าง 1 ถึง 1000');
      return;
    }

    setCreating(true);
    setCreateError(null);
    setCreatedCodes([]);
    try {
      const body: CreateCardsBody = { days: daysNum, quantity: qtyNum };
      const trimmedNote = note.trim();
      if (trimmedNote) body.note = trimmedNote;
      const res = await api.post<CreateCardsResponse>('/admin/cards', body);
      setCreatedCodes(res.codes);
      // รีเฟรชตาราง: กลับไปหน้าแรกเพื่อเห็นบัตรใหม่
      if (page === 1) {
        await loadCards();
      } else {
        setPage(1);
      }
    } catch (e) {
      if (e instanceof ApiClientError) {
        setCreateError(e.payload.message ?? 'สร้างบัตรไม่สำเร็จ');
      } else {
        setCreateError('สร้างบัตรไม่สำเร็จ กรุณาลองใหม่');
      }
    } finally {
      setCreating(false);
    }
  };

  // ยกเลิกบัตร (เฉพาะบัตรที่ยังไม่ใช้)
  const handleRevoke = async (code: string): Promise<void> => {
    setListError(null);
    try {
      await api.post<{ ok: true }>(`/admin/cards/${encodeURIComponent(code)}/revoke`);
      await loadCards();
    } catch (e) {
      if (e instanceof ApiClientError) {
        setListError(e.payload.message ?? 'ยกเลิกบัตรไม่สำเร็จ (ยกเลิกได้เฉพาะบัตรที่ยังไม่ใช้)');
      } else {
        setListError('ยกเลิกบัตรไม่สำเร็จ');
      }
    }
  };

  // เปลี่ยนตัวกรองสถานะ -> รีเซ็ตกลับหน้าแรก
  const handleFilterChange = (value: StatusFilter): void => {
    setStatusFilter(value);
    setPage(1);
  };

  // จำนวนหน้าทั้งหมด
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  // ระหว่างตรวจสิทธิ์
  if (authState === 'checking') {
    return <div style={{ padding: 24 }}>กำลังตรวจสอบสิทธิ์...</div>;
  }
  // denied จะถูก redirect ใน effect ด้านบน — แสดงข้อความชั่วคราว
  if (authState === 'denied') {
    return <div style={{ padding: 24 }}>กำลังพาไปหน้าเข้าสู่ระบบ...</div>;
  }

  return (
    <div style={styles.page}>
      <main style={styles.main}>
        <h1 style={styles.title}>จัดการบัตร</h1>

        {/* ฟอร์มสร้างบัตร */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>สร้างบัตรใหม่</h2>
          <form onSubmit={handleCreate} style={styles.form}>
            <label style={styles.label}>
              จำนวนวัน
              <input
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                style={styles.input}
                disabled={creating}
              />
            </label>
            <label style={styles.label}>
              จำนวนบัตร
              <input
                type="number"
                min={1}
                max={1000}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                style={styles.input}
                disabled={creating}
              />
            </label>
            <label style={styles.label}>
              หมายเหตุ (ไม่บังคับ)
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={styles.input}
                disabled={creating}
              />
            </label>
            <button
              type="submit"
              disabled={creating}
              style={{ ...styles.primaryButton, ...(creating ? styles.disabled : {}) }}
            >
              {creating ? 'กำลังสร้าง...' : 'สร้างบัตร'}
            </button>
          </form>
          {createError && <p style={styles.error}>{createError}</p>}
          {createdCodes.length > 0 && (
            <div style={styles.codesBox}>
              <strong>สร้างบัตรสำเร็จ {createdCodes.length} ใบ:</strong>
              <ul style={styles.codesList}>
                {createdCodes.map((c) => (
                  <li key={c} style={styles.codeItem}>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ตารางรายการบัตร */}
        <section style={styles.section}>
          <div style={styles.tableHeader}>
            <h2 style={styles.sectionTitle}>รายการบัตร ({total} ใบ)</h2>
            <label style={styles.filterLabel}>
              กรองสถานะ:
              <select
                value={statusFilter}
                onChange={(e) => handleFilterChange(e.target.value as StatusFilter)}
                style={styles.select}
              >
                <option value="">ทั้งหมด</option>
                <option value="unused">ยังไม่ใช้</option>
                <option value="redeemed">ใช้แล้ว</option>
                <option value="revoked">ยกเลิกแล้ว</option>
              </select>
            </label>
          </div>

          {listError && <p style={styles.error}>{listError}</p>}
          {listLoading && <p>กำลังโหลด...</p>}

          {!listLoading && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>รหัสบัตร</th>
                  <th style={styles.th}>จำนวนวัน</th>
                  <th style={styles.th}>สถานะ</th>
                  <th style={styles.th}>หมายเหตุ</th>
                  <th style={styles.th}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td style={styles.td} colSpan={5}>
                      ไม่มีบัตร
                    </td>
                  </tr>
                )}
                {items.map((card) => (
                  <tr key={card.id}>
                    <td style={styles.td}>{card.code}</td>
                    <td style={styles.td}>{card.days}</td>
                    <td style={styles.td}>{statusLabel(card.status)}</td>
                    <td style={styles.td}>{card.note ?? '-'}</td>
                    <td style={styles.td}>
                      {card.status === 'unused' ? (
                        <button
                          type="button"
                          onClick={() => void handleRevoke(card.code)}
                          style={styles.revokeButton}
                        >
                          ยกเลิก
                        </button>
                      ) : (
                        <span style={styles.muted}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* แบ่งหน้า */}
          {totalPages > 1 && (
            <div style={styles.pagination}>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
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
                disabled={page >= totalPages}
                style={styles.pageButton}
              >
                ถัดไป
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#fafafa' },
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
  form: { display: 'flex', flexWrap: 'wrap' as const, gap: 12, alignItems: 'flex-end' },
  label: { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 14, color: '#444' },
  input: {
    padding: '8px 10px',
    fontSize: 15,
    border: '1px solid #ccc',
    borderRadius: 6,
    minWidth: 120,
  },
  primaryButton: {
    padding: '9px 18px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 15,
    cursor: 'pointer',
  },
  disabled: { opacity: 0.6, cursor: 'not-allowed' },
  codesBox: { marginTop: 16, padding: 12, background: '#f0fdf4', borderRadius: 8 },
  codesList: { margin: '8px 0 0', paddingLeft: 18 },
  codeItem: { fontFamily: 'monospace', fontSize: 15 },
  tableHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  filterLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 },
  select: { padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' },
  table: { width: '100%', borderCollapse: 'collapse' as const, marginTop: 12 },
  th: {
    textAlign: 'left' as const,
    padding: '8px 10px',
    borderBottom: '2px solid #eee',
    fontSize: 14,
    color: '#555',
  },
  td: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: 14 },
  muted: { color: '#aaa' },
  revokeButton: {
    padding: '4px 10px',
    background: '#fee2e2',
    color: '#b91c1c',
    border: '1px solid #fca5a5',
    borderRadius: 6,
    cursor: 'pointer',
  },
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
