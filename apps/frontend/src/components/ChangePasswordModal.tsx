// Modal เปลี่ยนรหัสผ่าน — เฉพาะ user สมัครมือ (authMethod:'manual', ไม่มี LINE) เปิดจาก HomePage
import { useEffect, useState } from 'react';
import type { ChangePasswordBody } from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';

export function ChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // เปิดใหม่ทุกครั้ง = ฟอร์มว่าง
  useEffect(() => {
    if (open) {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setDone(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = oldPassword !== '' && newPassword.length >= 6 && newPassword === confirmPassword && !sending;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      const body: ChangePasswordBody = { oldPassword, newPassword };
      await api.post('/auth/change-password', body);
      setDone(true);
      window.setTimeout(onClose, 1600);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        setError('รหัสผ่านเดิมไม่ถูกต้อง');
      } else {
        setError(e instanceof ApiClientError && e.payload.message ? e.payload.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ ลองใหม่อีกครั้ง');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose} role="presentation">
      <div
        style={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="เปลี่ยนรหัสผ่าน"
      >
        {done ? (
          <>
            <div style={styles.icon}>✅</div>
            <h2 style={styles.title}>เปลี่ยนรหัสผ่านสำเร็จ</h2>
          </>
        ) : (
          <>
            <div style={styles.icon}>🔒</div>
            <h2 style={styles.title}>เปลี่ยนรหัสผ่าน</h2>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="รหัสผ่านเดิม"
              autoComplete="current-password"
              style={styles.input}
              disabled={sending}
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)"
              autoComplete="new-password"
              style={styles.input}
              disabled={sending}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="ยืนยันรหัสผ่านใหม่"
              autoComplete="new-password"
              style={styles.input}
              disabled={sending}
            />
            {newPassword !== '' && confirmPassword !== '' && newPassword !== confirmPassword && (
              <p style={styles.error}>รหัสผ่านใหม่ไม่ตรงกัน</p>
            )}
            {error && <p style={styles.error}>{error}</p>}
            <button
              type="button"
              style={canSubmit ? styles.primary : styles.primaryDisabled}
              onClick={submit}
              disabled={!canSubmit}
            >
              {sending ? 'กำลังบันทึก...' : 'เปลี่ยนรหัสผ่าน'}
            </button>
            <button type="button" style={styles.closeBtn} onClick={onClose}>
              ยกเลิก
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 1000,
  },
  dialog: {
    background: '#fff',
    color: '#1f2937',
    padding: '28px 24px',
    borderRadius: 14,
    width: '100%',
    maxWidth: 380,
    textAlign: 'center' as const,
    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  },
  icon: { fontSize: 40, lineHeight: 1, marginBottom: 8 },
  title: { margin: '0 0 16px', fontSize: 20 },
  input: {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  error: { margin: '0 0 10px', color: '#dc2626', fontSize: 13 },
  primary: {
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #ea580c, #c2410c)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 10,
    boxShadow: '0 2px 8px rgba(234,88,12,0.35)',
  },
  primaryDisabled: {
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    background: '#d1d5db',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'not-allowed',
    marginBottom: 10,
  },
  closeBtn: {
    display: 'block',
    width: '100%',
    padding: '10px 16px',
    background: 'transparent',
    color: '#888',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    cursor: 'pointer',
  },
} as const;
