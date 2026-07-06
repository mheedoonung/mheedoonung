// Modal เตือนสิทธิ์ใช้งานใกล้หมด (เหลือ <1 วัน) — เด้งครั้งเดียวต่อวัน (ดู HomePage localStorage)
// ปุ่ม: เติมเวลาด้วยรหัสบัตร (เปิด RedeemModal) / ซื้อบัตรผ่าน LINE OA / ปิด
import { useEffect, useRef } from 'react';

// ลิงก์ LINE OA จาก env — ว่าง = ซ่อนปุ่ม
const LINE_OA_URL = import.meta.env.VITE_LINE_OA_URL ?? '';

export function ExpiryWarningModal({
  open,
  expiresText,
  onTopup,
  onClose,
}: {
  open: boolean;
  expiresText: string;
  onTopup: () => void;
  onClose: () => void;
}): JSX.Element | null {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div style={styles.overlay} onClick={onClose} role="presentation">
      <div
        style={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="สิทธิ์ใช้งานใกล้จะหมด"
      >
        <div style={styles.icon}>⏰</div>
        <h2 style={styles.title}>สิทธิ์ใช้งานใกล้จะหมด</h2>
        <p style={styles.text}>
          เหลือเวลาใช้งานน้อยกว่า 1 วัน
          <br />
          หมดเวลา {expiresText}
        </p>
        <button type="button" style={styles.primary} onClick={onTopup}>
          + เติมเวลาด้วยรหัสบัตร
        </button>
        {LINE_OA_URL && (
          <a
            href={LINE_OA_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.lineBtn}
            onClick={onClose}
          >
            ซื้อบัตรเติมเงินผ่าน LINE
          </a>
        )}
        <button type="button" style={styles.closeBtn} onClick={onClose}>
          ปิด
        </button>
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
  title: { margin: '0 0 8px', fontSize: 20, color: '#dc2626' },
  text: { margin: '0 0 22px', color: '#555', fontSize: 15, lineHeight: 1.6 },
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
  lineBtn: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '12px 16px',
    background: '#06c755', // เขียว LINE
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    textDecoration: 'none',
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
