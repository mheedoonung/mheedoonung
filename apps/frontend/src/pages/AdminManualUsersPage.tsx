// หน้าจัดการ "ผู้ใช้สมัครมือ" ของแอดมิน (route /admin/manual-users — อยู่ใต้ AdminLayout)
// สำหรับลูกค้าที่ไม่มี LINE เข้าระบบไม่ได้ — admin สร้าง username/password ให้ (remark ไว้เทียบว่ามาจาก social ไหน)
// ลูกค้าเข้าที่หน้า /login ปกติแล้วกด toggle "ไม่มี LINE?"
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AdminSetPasswordBody, CreateManualUserBody, ManualUserListItem, ManualUserListResponse } from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

function isActive(accessExpiresAt: string | null): boolean {
  return !!accessExpiresAt && new Date(accessExpiresAt).getTime() > Date.now();
}

export function AdminManualUsersPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdUsername, setCreatedUsername] = useState<string | null>(null);

  const [items, setItems] = useState<ManualUserListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // แถวที่กำลังตั้งรหัสผ่านใหม่ให้ (id ของ user) + ค่าที่กรอก + สถานะ/error ของแถวนั้น
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetSaving, setResetSaving] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDoneId, setResetDoneId] = useState<string | null>(null);

  const loadItems = useCallback(async (): Promise<void> => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await api.get<ManualUserListResponse>('/admin/manual-users');
      setItems(res.items);
    } catch {
      setListError('โหลดรายชื่อไม่สำเร็จ');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleCreate = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreatedUsername(null);
    try {
      const body: CreateManualUserBody = {
        username: username.trim(),
        password,
        displayName: displayName.trim(),
      };
      const trimmedNote = note.trim();
      if (trimmedNote) body.note = trimmedNote;
      await api.post<ManualUserListItem>('/admin/manual-users', body);
      setCreatedUsername(body.username);
      setUsername('');
      setPassword('');
      setDisplayName('');
      setNote('');
      await loadItems();
    } catch (e) {
      if (e instanceof ApiClientError) {
        setCreateError(e.payload.message ?? 'สร้างผู้ใช้ไม่สำเร็จ');
      } else {
        setCreateError('สร้างผู้ใช้ไม่สำเร็จ กรุณาลองใหม่');
      }
    } finally {
      setCreating(false);
    }
  };

  const openReset = (id: string): void => {
    setResetId(id);
    setResetPassword('');
    setResetError(null);
    setResetDoneId(null);
  };

  const submitReset = async (): Promise<void> => {
    if (!resetId || resetPassword.length < 6) return;
    setResetSaving(true);
    setResetError(null);
    try {
      const body: AdminSetPasswordBody = { newPassword: resetPassword };
      await api.post(`/admin/manual-users/${resetId}/password`, body);
      setResetDoneId(resetId);
      setResetId(null);
    } catch (e) {
      setResetError(e instanceof ApiClientError ? e.payload.message ?? 'ตั้งรหัสผ่านไม่สำเร็จ' : 'ตั้งรหัสผ่านไม่สำเร็จ');
    } finally {
      setResetSaving(false);
    }
  };

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>ผู้ใช้สมัครมือ (ไม่มี LINE)</h1>
      <p style={styles.subtitle}>
        สำหรับลูกค้าที่ไม่มี LINE — สร้าง username/password แล้วบอกลูกค้าเข้าที่หน้า <code>/login</code> ปกติ
        แล้วกด "ไม่มี LINE? เข้าสู่ระบบด้วยชื่อผู้ใช้"
      </p>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>สร้างผู้ใช้ใหม่</h2>
        <form onSubmit={handleCreate} style={styles.form}>
          <label style={styles.label}>
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={styles.input}
              disabled={creating}
              required
              minLength={3}
            />
          </label>
          <label style={styles.label}>
            รหัสผ่าน
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              disabled={creating}
              required
              minLength={6}
            />
          </label>
          <label style={styles.label}>
            ชื่อที่แสดง
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={styles.input}
              disabled={creating}
              required
            />
          </label>
          <label style={styles.label}>
            Remark (ไม่บังคับ — ที่มา เช่น "FB: ชื่อบัญชี")
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ ...styles.input, minWidth: 220 }}
              disabled={creating}
              maxLength={200}
            />
          </label>
          <button
            type="submit"
            disabled={creating}
            style={{ ...styles.primaryButton, ...(creating ? styles.disabled : {}) }}
          >
            {creating ? 'กำลังสร้าง...' : 'สร้างผู้ใช้'}
          </button>
        </form>
        {createError && <p style={styles.error}>{createError}</p>}
        {createdUsername && (
          <p style={styles.success}>สร้าง "{createdUsername}" สำเร็จ — ส่ง username/password ให้ลูกค้าทางที่ปลอดภัย</p>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>รายชื่อผู้ใช้สมัครมือ ({items.length})</h2>
        {listError && <p style={styles.error}>{listError}</p>}
        {listLoading && <p>กำลังโหลด...</p>}
        {!listLoading && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Username</th>
                <th style={styles.th}>ชื่อที่แสดง</th>
                <th style={styles.th}>Remark</th>
                <th style={styles.th}>สถานะ</th>
                <th style={styles.th}>หมดอายุ</th>
                <th style={styles.th}>สร้างเมื่อ</th>
                <th style={styles.th}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td style={styles.td} colSpan={7}>
                    ยังไม่มีผู้ใช้สมัครมือ
                  </td>
                </tr>
              )}
              {items.map((u) => (
                <tr key={u.id}>
                  <td style={styles.td}>{u.username}</td>
                  <td style={styles.td}>{u.displayName}</td>
                  <td style={styles.td}>{u.note ?? '-'}</td>
                  <td style={styles.td}>{isActive(u.accessExpiresAt) ? 'ใช้งานอยู่' : 'ไม่ active'}</td>
                  <td style={styles.td}>{formatDate(u.accessExpiresAt)}</td>
                  <td style={styles.td}>{formatDate(u.createdAt)}</td>
                  <td style={styles.td}>
                    {resetId === u.id ? (
                      <div style={styles.resetRow}>
                        <input
                          type="text"
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                          placeholder="รหัสผ่านใหม่ (≥6 ตัว)"
                          style={styles.resetInput}
                          disabled={resetSaving}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => void submitReset()}
                          disabled={resetSaving || resetPassword.length < 6}
                          style={styles.smallPrimaryButton}
                        >
                          {resetSaving ? '...' : 'บันทึก'}
                        </button>
                        <button type="button" onClick={() => setResetId(null)} style={styles.smallGhostButton}>
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => openReset(u.id)} style={styles.smallGhostButton}>
                        เปลี่ยนรหัสผ่าน
                      </button>
                    )}
                    {resetDoneId === u.id && <div style={styles.success}>ตั้งรหัสผ่านใหม่แล้ว</div>}
                    {resetId === u.id && resetError && <div style={styles.error}>{resetError}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

const styles = {
  main: { maxWidth: 900, margin: '0 auto', padding: 24 },
  title: { fontSize: 26, margin: '0 0 4px' },
  subtitle: { color: '#777', fontSize: 14, marginTop: 0, marginBottom: 20 },
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
    minWidth: 160,
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
  error: { color: '#d33', marginTop: 12 },
  success: { color: '#15803d', marginTop: 12 },
  table: { width: '100%', borderCollapse: 'collapse' as const, marginTop: 4 },
  th: {
    textAlign: 'left' as const,
    padding: '8px 10px',
    borderBottom: '2px solid #eee',
    fontSize: 14,
    color: '#555',
  },
  td: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: 14 },
  resetRow: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const },
  resetInput: {
    padding: '5px 8px',
    fontSize: 13,
    border: '1px solid #ccc',
    borderRadius: 6,
    minWidth: 130,
  },
  smallPrimaryButton: {
    padding: '5px 10px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  },
  smallGhostButton: {
    padding: '5px 10px',
    background: '#f3f4f6',
    color: '#444',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
} as const;
