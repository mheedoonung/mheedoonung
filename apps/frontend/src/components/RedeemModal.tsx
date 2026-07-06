// Modal เติมเวลาดูหนัง — เปิดจากปุ่มในหน้าหลัก (เติมได้ตลอด ไม่ต้องรอสิทธิ์หมด)
// backend สะสมเวลาให้เอง: max(now, วันหมดอายุเดิม) + วันของบัตร (ดู card.service.ts)
import { useEffect, useRef, useState, type FormEvent } from 'react';
import confetti from 'canvas-confetti';
import type { RedeemBody, RedeemResponse } from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

// map รหัส error จาก backend -> ข้อความภาษาไทย (ใช้ร่วมกับ RedeemPage)
export function redeemErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    switch (err.payload.error) {
      case 'invalid_code':
        return 'ไม่พบรหัสบัตรนี้ กรุณาตรวจสอบอีกครั้ง';
      case 'already_used':
        return 'บัตรนี้ถูกใช้ไปแล้ว';
      case 'revoked':
        return 'บัตรนี้ถูกยกเลิกการใช้งาน';
      case 'unauthorized':
        return 'กรุณาเข้าสู่ระบบก่อนเติมบัตร';
      default:
        return err.payload.message ?? 'เติมบัตรไม่สำเร็จ';
    }
  }
  return 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
}

// พลุฉลอง — ยิงจากซ้าย+ขวาสวนเข้ากลางสั้น ๆ (canvas วาดบน body เอง อยู่ต่อได้แม้ปิด modal)
function celebrate(): void {
  const colors = ['#f94144', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#577590', '#e56399'];
  const end = Date.now() + 700;
  confetti({ particleCount: 80, spread: 80, startVelocity: 45, origin: { y: 0.7 }, colors });
  (function frame() {
    confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors });
    confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

export function RedeemModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const { refresh } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // เก็บ onClose ล่าสุดใน ref: parent ส่ง arrow ใหม่ทุก render (เช่นตอน refresh auth) ถ้าใส่ใน dep
  //   effect จะ re-run -> cleanup + reset state ทิ้ง. ใช้ ref กัน
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // วินาทีที่เหลือก่อนปิดอัตโนมัติ (null = ยังไม่เริ่มนับ/ยังไม่สำเร็จ)
  const [countdown, setCountdown] = useState<number | null>(null);

  // เปิด modal -> โฟกัส input + ล้างสถานะเก่า; ปิดด้วย Escape (dep แค่ [open] เท่านั้น)
  useEffect(() => {
    if (!open) {
      setCountdown(null);
      return;
    }
    setCode('');
    setError(null);
    setSuccess(null);
    setCountdown(null);
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // นับถอยหลังปิดอัตโนมัติ: 5->0 ทีละวินาที ถึง 0 ปิด modal (cleanup เคลียร์ timer เอง)
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      onCloseRef.current();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError('กรุณากรอกรหัสบัตร');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const body: RedeemBody = { code: trimmed };
      const res = await api.post<RedeemResponse>('/cards/redeem', body);
      await refresh(); // อัปเดต accessExpiresAt ใน header ทันที
      setSuccess(`เติมสำเร็จ! เพิ่มเวลา ${res.daysAdded} วัน 🎉`);
      setCode('');
      celebrate();
      setCountdown(5); // เริ่มนับถอยหลังปิดอัตโนมัติ (พลุยังเล่นต่อบนหน้าหลักหลังปิด)
    } catch (err) {
      setError(redeemErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose} role="presentation">
      <div
        style={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="เติมเวลาดูหนัง"
      >
        <button type="button" onClick={onClose} style={styles.close} aria-label="ปิด">
          ✕
        </button>
        <h2 style={styles.title}>เติมเวลาดูหนัง</h2>
        <p style={styles.subtitle}>กรอกรหัสบัตร — เวลาจะถูกเพิ่มต่อจากสิทธิ์เดิม</p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            style={styles.input}
            disabled={submitting}
          />
          <button
            type="submit"
            disabled={submitting}
            style={{ ...styles.button, ...(submitting ? styles.disabled : {}) }}
          >
            {submitting ? 'กำลังเติม...' : 'เติมเวลา'}
          </button>
        </form>
        {error && <p style={styles.error}>{error}</p>}
        {success && (
          <div style={styles.successBox}>
            <p style={styles.success}>{success}</p>
            {countdown !== null && (
              <>
                <p style={styles.countdown}>ปิดอัตโนมัติใน {countdown} วินาที</p>
                <button type="button" style={styles.closeNow} onClick={() => onCloseRef.current()}>
                  ปิดเลย
                </button>
              </>
            )}
          </div>
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
    position: 'relative' as const,
    background: '#fff',
    color: '#1f2937',
    padding: 24,
    borderRadius: 12,
    width: '100%',
    maxWidth: 360,
    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  },
  close: {
    position: 'absolute' as const,
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    border: 'none',
    background: 'transparent',
    fontSize: 18,
    color: '#888',
    cursor: 'pointer',
  },
  title: { margin: '0 0 6px', fontSize: 20 },
  subtitle: { margin: '0 0 20px', color: '#666', fontSize: 14 },
  input: {
    width: '100%',
    padding: '12px 14px',
    fontSize: 16, // >=16 กัน iOS zoom ตอนโฟกัส
    border: '1px solid #ccc',
    borderRadius: 8,
    boxSizing: 'border-box' as const,
    marginBottom: 12,
    textAlign: 'center' as const,
    letterSpacing: 1,
  },
  button: {
    width: '100%',
    padding: '12px 16px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    cursor: 'pointer',
  },
  disabled: { opacity: 0.6, cursor: 'not-allowed' },
  error: { color: '#d33', marginTop: 14, marginBottom: 0 },
  successBox: { marginTop: 16, textAlign: 'center' as const },
  success: { color: '#0a8a2a', margin: 0, fontWeight: 600 },
  countdown: { color: '#888', fontSize: 13, margin: '8px 0 12px' },
  closeNow: {
    padding: '8px 20px',
    background: '#0a8a2a',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
} as const;
