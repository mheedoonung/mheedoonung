// หน้าเข้าสู่ระบบของแอดมิน (route /admin)
// - form username/password -> POST /admin/login
// - สำเร็จ -> ไปหน้าจัดการบัตร /admin/cards
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdminLoginBody } from '@mheedoonung/shared';
import { api, ApiClientError } from '../api/client';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // submit ฟอร์ม login แอดมิน
  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: AdminLoginBody = { username: username.trim(), password };
      await api.post<{ ok: true }>('/admin/login', body);
      // backend ตั้ง admin session cookie ให้แล้ว -> ไปหน้าจัดการบัตร
      navigate('/admin/cards', { replace: true });
    } catch (e) {
      // 401 = user/pass ผิด
      if (e instanceof ApiClientError && e.status === 401) {
        setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      } else {
        setError('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h1 style={styles.title}>เข้าสู่ระบบแอดมิน</h1>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="ชื่อผู้ใช้"
          autoComplete="username"
          style={styles.input}
          disabled={submitting}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="รหัสผ่าน"
          autoComplete="current-password"
          style={styles.input}
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting}
          style={{ ...styles.button, ...(submitting ? styles.disabled : {}) }}
        >
          {submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
        </button>
        {error && <p style={styles.error}>{error}</p>}
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
    maxWidth: 360,
    width: '100%',
  },
  title: { margin: '0 0 24px', fontSize: 22, textAlign: 'center' as const },
  input: {
    width: '100%',
    padding: '12px 14px',
    fontSize: 16,
    border: '1px solid #ccc',
    borderRadius: 8,
    boxSizing: 'border-box' as const,
    marginBottom: 16,
  },
  button: {
    width: '100%',
    padding: '12px 16px',
    background: '#111827',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    cursor: 'pointer',
  },
  disabled: { opacity: 0.6, cursor: 'not-allowed' },
  error: { color: '#d33', marginTop: 16, textAlign: 'center' as const },
} as const;
