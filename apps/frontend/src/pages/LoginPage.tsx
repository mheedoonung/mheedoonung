// หน้าเข้าสู่ระบบ — ปุ่มเดียวสำหรับ login ด้วย LINE
// - ถ้า login อยู่แล้ว -> เด้งไปหน้าหลัก
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

// ชื่อแอปจาก env (ใช้แสดงหัวข้อ)
const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'mheedoonung';

export function LoginPage() {
  const { user, loading, login, devLogin } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devUserId, setDevUserId] = useState('devuser-001');

  // ถ้า login อยู่แล้วให้ไปหน้าหลัก
  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  // กดปุ่มเข้าสู่ระบบ
  const handleLogin = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await login();
      // กรณี web OAuth จะ redirect ออกไปแล้ว; กรณี LIFF จะอัปเดต state เอง
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เข้าสู่ระบบไม่สำเร็จ');
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>{APP_NAME}</h1>
        <p style={styles.subtitle}>กรุณาเข้าสู่ระบบเพื่อใช้งาน</p>
        <button
          type="button"
          onClick={handleLogin}
          disabled={submitting}
          style={{ ...styles.lineButton, ...(submitting ? styles.disabled : {}) }}
        >
          {submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบด้วย LINE'}
        </button>
        {error && <p style={styles.error}>{error}</p>}

        {/* แผง dev — โชว์เฉพาะตอน dev build (import.meta.env.DEV) ใช้เทสต์ local โดยไม่ต้องมี LINE */}
        {import.meta.env.DEV && (
          <div style={styles.devPanel}>
            <p style={styles.devLabel}>🔧 dev login (ต้องตั้ง DEV_LOGIN_ENABLED=true ฝั่ง backend)</p>
            <input
              value={devUserId}
              onChange={(e) => setDevUserId(e.target.value)}
              placeholder="lineUserId (เปลี่ยนเพื่อจำลองคนละเครื่อง)"
              style={styles.devInput}
            />
            <button
              type="button"
              style={styles.devButton}
              onClick={async () => {
                setError(null);
                try {
                  await devLogin(devUserId);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'dev login ไม่สำเร็จ');
                }
              }}
            >
              เข้าสู่ระบบ (dev)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// สไตล์อย่างง่าย (inline) — ยังไม่เน้นสวย
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
  title: { margin: '0 0 8px', fontSize: 24 },
  subtitle: { margin: '0 0 24px', color: '#666' },
  lineButton: {
    width: '100%',
    padding: '12px 16px',
    background: '#06C755',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    cursor: 'pointer',
  },
  disabled: { opacity: 0.6, cursor: 'not-allowed' },
  error: { color: '#d33', marginTop: 16 },
  devPanel: {
    marginTop: 24,
    paddingTop: 16,
    borderTop: '1px dashed #ccc',
    textAlign: 'left' as const,
  },
  devLabel: { fontSize: 12, color: '#999', margin: '0 0 8px' },
  devInput: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #ddd',
    borderRadius: 6,
    marginBottom: 8,
    boxSizing: 'border-box' as const,
  },
  devButton: {
    width: '100%',
    padding: '10px 16px',
    background: '#555',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
} as const;

