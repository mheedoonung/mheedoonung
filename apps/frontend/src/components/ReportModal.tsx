// Modal แจ้งปัญหา — user กดเปิดเองจากปุ่ม "แจ้งปัญหา" (WatchPage/HomePage)
// เลือกหมวด + พิมพ์รายละเอียด (บังคับ) — ระบบแนบ context ให้เอง (path/movieSlug/userAgent)
import { useEffect, useState } from 'react';
import { REPORT_CATEGORIES } from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';

export function ReportModal({
  open,
  movieSlug,
  onClose,
}: {
  open: boolean;
  movieSlug?: string; // มาจาก WatchPage = แนบชื่อเรื่องให้อัตโนมัติ
  onClose: () => void;
}): JSX.Element | null {
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // เปิดใหม่ทุกครั้ง = ฟอร์มว่าง (กันค้างค่าจากรอบก่อน)
  useEffect(() => {
    if (open) {
      setCategory('');
      setText('');
      setSent(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = category !== '' && text.trim() !== '' && !sending;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      await api.post('/reports', {
        category,
        text: text.trim(),
        path: location.pathname,
        ...(movieSlug ? { movieSlug } : {}),
      });
      setSent(true);
      window.setTimeout(onClose, 1600);
    } catch (e) {
      setError(
        e instanceof ApiClientError && e.payload.message
          ? e.payload.message
          : 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง',
      );
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
        aria-label="แจ้งปัญหา"
      >
        {sent ? (
          <>
            <div style={styles.icon}>🙏</div>
            <h2 style={styles.title}>ได้รับเรื่องแล้ว</h2>
            <p style={styles.text}>ทีมงานจะรีบตรวจสอบให้เร็วที่สุด</p>
          </>
        ) : (
          <>
            <div style={styles.icon}>⚠️</div>
            <h2 style={styles.title}>แจ้งปัญหา</h2>
            <p style={styles.hint}>เจอปัญหาอะไร เลือกหมวดแล้วเล่าให้ฟังหน่อย</p>
            <div style={styles.chips}>
              {REPORT_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  style={category === c ? styles.chipActive : styles.chip}
                >
                  {c}
                </button>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                movieSlug
                  ? 'เล่ารายละเอียดปัญหา เช่น กระตุกช่วงไหน ขึ้น error ว่าอะไร'
                  : 'เล่ารายละเอียดปัญหาที่เจอ'
              }
              maxLength={2000}
              rows={4}
              style={styles.textarea}
            />
            {movieSlug && <p style={styles.contextNote}>จะแนบชื่อเรื่องที่กำลังดูไปให้อัตโนมัติ</p>}
            {error && <p style={styles.error}>{error}</p>}
            <button
              type="button"
              style={canSubmit ? styles.primary : styles.primaryDisabled}
              onClick={submit}
              disabled={!canSubmit}
            >
              {sending ? 'กำลังส่ง...' : 'ส่งเรื่อง'}
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
  title: { margin: '0 0 6px', fontSize: 20 },
  text: { margin: '0 0 8px', color: '#555', fontSize: 15, lineHeight: 1.6 },
  hint: { margin: '0 0 12px', color: '#666', fontSize: 13 },
  chips: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  chip: {
    padding: '7px 12px',
    background: '#f3f4f6',
    color: '#444',
    border: '1px solid #e5e7eb',
    borderRadius: 999,
    fontSize: 13,
    cursor: 'pointer',
  },
  chipActive: {
    padding: '7px 12px',
    background: '#fff7ed',
    color: '#c2410c',
    border: '1px solid #ea580c',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'vertical' as const,
    marginBottom: 6,
  },
  contextNote: { margin: '0 0 10px', color: '#999', fontSize: 12 },
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
