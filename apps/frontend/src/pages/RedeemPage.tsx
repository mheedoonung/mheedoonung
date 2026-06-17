// หน้าเติมบัตร — กรอกรหัสบัตรเพื่อเปิดสิทธิ์เข้าใช้งาน
// - POST /cards/redeem {code}
// - สำเร็จ -> refresh สถานะ user แล้วไปหน้าหลัก
// - ผิดพลาด -> แสดงข้อความ error (map จาก ApiError)
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RedeemBody, RedeemResponse } from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

// map รหัส error จาก backend -> ข้อความภาษาไทย
function errorMessage(err: unknown): string {
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

export function RedeemPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // submit ฟอร์มเติมบัตร
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
      // อัปเดตสถานะ user (เพื่อให้ isActive เป็น true) ก่อนเด้งหน้า
      await refresh();
      setSuccess(`เติมบัตรสำเร็จ! เพิ่มสิทธิ์ใช้งาน ${res.daysAdded} วัน`);
      // เด้งไปหน้าหลักหลังเติมสำเร็จ
      navigate('/', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h1 style={styles.title}>เติมบัตรเข้าใช้งาน</h1>
        <p style={styles.subtitle}>กรอกรหัสบัตรเพื่อเปิดสิทธิ์ดูหนัง</p>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          style={styles.input}
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting}
          style={{ ...styles.button, ...(submitting ? styles.disabled : {}) }}
        >
          {submitting ? 'กำลังเติมบัตร...' : 'เติมบัตร'}
        </button>
        {error && <p style={styles.error}>{error}</p>}
        {success && <p style={styles.success}>{success}</p>}
      </form>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f5f5',
  },
  card: {
    background: '#fff',
    padding: 32,
    borderRadius: 12,
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    textAlign: 'center' as const,
    maxWidth: 360,
    width: '100%',
  },
  title: { margin: '0 0 8px', fontSize: 22 },
  subtitle: { margin: '0 0 24px', color: '#666' },
  input: {
    width: '100%',
    padding: '12px 14px',
    fontSize: 16,
    border: '1px solid #ccc',
    borderRadius: 8,
    boxSizing: 'border-box' as const,
    marginBottom: 16,
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
  error: { color: '#d33', marginTop: 16 },
  success: { color: '#0a8a2a', marginTop: 16 },
} as const;
