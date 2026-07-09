// หน้าเข้าสู่ระบบ — ปุ่มเดียวสำหรับ login ด้วย LINE
// - ถ้า login อยู่แล้ว -> เด้งไปหน้าหลัก
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiClientError } from '../api/client';

// ชื่อแอปจาก env (ใช้แสดงหัวข้อ)
const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'mheedoonung';

export function LoginPage() {
  const { user, loading, login, devLogin, manualLogin } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devUserId, setDevUserId] = useState('devuser-001');

  // สลับไปฟอร์ม username/password (ลูกค้าไม่มี LINE — admin สร้างให้) — ซ่อนไว้ ไม่ให้กระทบ user หลักที่ใช้ LINE
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualUsername, setManualUsername] = useState('');
  const [manualPassword, setManualPassword] = useState('');

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

  // เข้าระบบด้วย username/password (ลูกค้าไม่มี LINE)
  const handleManualLogin = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await manualLogin(manualUsername.trim(), manualPassword);
    } catch (e) {
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
      <div style={styles.card}>
        <img src="/mheedoonung.png" alt={APP_NAME} style={styles.logo} />
        <p style={styles.subtitle}>กรุณาเข้าสู่ระบบเพื่อใช้งาน</p>

        {!showManualForm ? (
          <>
            <button
              type="button"
              onClick={handleLogin}
              disabled={submitting}
              style={{ ...styles.lineButton, ...(submitting ? styles.disabled : {}) }}
            >
              {submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบด้วย LINE'}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setShowManualForm(true);
              }}
              style={styles.manualToggle}
            >
              ไม่มี LINE? เข้าสู่ระบบด้วยชื่อผู้ใช้
            </button>
          </>
        ) : (
          <form onSubmit={handleManualLogin} style={styles.manualForm}>
            <input
              type="text"
              value={manualUsername}
              onChange={(e) => setManualUsername(e.target.value)}
              placeholder="ชื่อผู้ใช้"
              autoComplete="username"
              style={styles.manualInput}
              disabled={submitting}
            />
            <input
              type="password"
              value={manualPassword}
              onChange={(e) => setManualPassword(e.target.value)}
              placeholder="รหัสผ่าน"
              autoComplete="current-password"
              style={styles.manualInput}
              disabled={submitting}
            />
            <button
              type="submit"
              disabled={submitting}
              style={{ ...styles.lineButton, ...(submitting ? styles.disabled : {}) }}
            >
              {submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setShowManualForm(false);
              }}
              style={styles.manualToggle}
            >
              กลับไปเข้าสู่ระบบด้วย LINE
            </button>
          </form>
        )}
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
  logo: {
    width: 128,
    height: 128,
    objectFit: 'contain' as const,
    display: 'block',
    margin: '0 auto 16px',
  },
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
  manualToggle: {
    display: 'block',
    width: '100%',
    marginTop: 12,
    padding: 0,
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: 13,
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  manualForm: { display: 'flex', flexDirection: 'column' as const, gap: 12 },
  manualInput: {
    width: '100%',
    padding: '12px 14px',
    fontSize: 16,
    border: '1px solid #ccc',
    borderRadius: 8,
    boxSizing: 'border-box' as const,
  },
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

