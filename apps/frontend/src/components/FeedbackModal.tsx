// Modal ขอ feedback จาก user ที่ดูหนังจริง (เด้งจาก HomePage เมื่อเข้าเกณฑ์ใน lib/feedbackGate)
// ชั้น 1: ดาว 1-5 (บังคับ) / ชั้น 2: chips + ข้อความ (optional) — ปิด/ไว้ทีหลัง = dismiss (จำใน localStorage)
import { useEffect, useRef, useState } from 'react';
import { FEEDBACK_TAGS } from '@mheedoonung/shared';
import { api } from '../api/client';
import { getWatchSeconds, markDismissed, markSubmitted } from '../lib/feedbackGate';

export function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // กันยิง dismiss ตอนปิดหลัง "ส่งสำเร็จ" (ส่งแล้ว server ไม่ถามอีกอยู่แล้ว)
  const sentRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // ปิดทุกทาง (ปุ่มไว้ทีหลัง/backdrop/Esc) = dismiss — จำใน localStorage ไม่ให้เด้งถี่
  const handleClose = (): void => {
    if (!sentRef.current) markDismissed();
    onClose();
  };

  const toggleTag = (tag: string): void => {
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    if (rating < 1 || sending) return;
    setSending(true);
    try {
      await api.post('/feedback', {
        rating,
        tags: [...tags],
        text: text.trim() || undefined,
        watchedSeconds: getWatchSeconds(),
      });
      sentRef.current = true;
      markSubmitted();
      setSent(true);
      // โชว์ขอบคุณแป๊บเดียวแล้วปิดเอง
      window.setTimeout(onClose, 1600);
    } catch {
      // ส่งไม่ผ่าน (network/server พัง) — ปิดเงียบ ไม่ mark ว่าส่งแล้ว เกณฑ์เดิมจะถามใหม่รอบหน้า
      // (ปิดโดยไม่นับ dismiss ด้วย — ไม่ใช่ความผิด user)
      sentRef.current = true;
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={handleClose} role="presentation">
      <div
        style={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="ขอความเห็นจากคุณ"
      >
        {sent ? (
          <>
            <div style={styles.icon}>🐻❤️</div>
            <h2 style={styles.title}>ขอบคุณมากๆ เลย!</h2>
            <p style={styles.text}>เราจะเอาไปปรับปรุงให้ดีขึ้น</p>
          </>
        ) : (
          <>
            <div style={styles.icon}>🐻</div>
            <h2 style={styles.title}>ดูหนังกับเราเป็นยังไงบ้าง</h2>
            <div style={styles.stars} role="radiogroup" aria-label="ให้คะแนน 1 ถึง 5 ดาว">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  style={styles.starBtn}
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} ดาว`}
                >
                  <span style={{ opacity: n <= rating ? 1 : 0.25 }}>⭐</span>
                </button>
              ))}
            </div>
            {rating > 0 && (
              <>
                <p style={styles.hint}>มีอะไรอยากให้ปรับไหม (เลือกได้ ไม่บังคับ)</p>
                <div style={styles.chips}>
                  {FEEDBACK_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      style={tags.has(tag) ? styles.chipActive : styles.chip}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="บอกเราเพิ่มเติมได้เลย (ไม่บังคับ)"
                  maxLength={1000}
                  rows={3}
                  style={styles.textarea}
                />
              </>
            )}
            <button
              type="button"
              style={rating > 0 ? styles.primary : styles.primaryDisabled}
              onClick={submit}
              disabled={rating < 1 || sending}
            >
              {sending ? 'กำลังส่ง...' : 'ส่งความเห็น'}
            </button>
            <button type="button" style={styles.closeBtn} onClick={handleClose}>
              ไว้ทีหลัง
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
    maxWidth: 360,
    textAlign: 'center' as const,
    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  },
  icon: { fontSize: 44, lineHeight: 1, marginBottom: 8 },
  title: { margin: '0 0 12px', fontSize: 20 },
  text: { margin: '0 0 8px', color: '#555', fontSize: 15, lineHeight: 1.6 },
  stars: { display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 14 },
  starBtn: {
    background: 'transparent',
    border: 'none',
    fontSize: 30,
    cursor: 'pointer',
    padding: '2px 4px',
    lineHeight: 1,
  },
  hint: { margin: '0 0 8px', color: '#666', fontSize: 13 },
  chips: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  chip: {
    padding: '6px 12px',
    background: '#f3f4f6',
    color: '#444',
    border: '1px solid #e5e7eb',
    borderRadius: 999,
    fontSize: 13,
    cursor: 'pointer',
  },
  chipActive: {
    padding: '6px 12px',
    background: '#eef2ff',
    color: '#4f46e5',
    border: '1px solid #4f46e5',
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
    marginBottom: 14,
  },
  primary: {
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 10,
    boxShadow: '0 2px 8px rgba(37,99,235,0.35)',
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
