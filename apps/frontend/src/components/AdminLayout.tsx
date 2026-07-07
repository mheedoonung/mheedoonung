// Layout ของโซนแอดมิน — ตรวจสิทธิ์ /admin/me ที่เดียว + header เมนู (บัตร / Feedback) + ออกจากระบบ
// หน้า admin แต่ละหน้า render ผ่าน <Outlet/> ไม่ต้องเช็คสิทธิ์เอง
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export function AdminLayout() {
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<'checking' | 'authorized' | 'denied'>('checking');
  const [username, setUsername] = useState('');

  // ตรวจสิทธิ์แอดมินตอน mount — ไม่ผ่านเด้งกลับหน้า login แอดมิน
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get<{ admin: { username: string } }>('/admin/me');
        if (active) {
          setUsername(res.admin.username);
          setAuthState('authorized');
        }
      } catch {
        if (active) setAuthState('denied');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authState === 'denied') navigate('/admin', { replace: true });
  }, [authState, navigate]);

  const handleLogout = async (): Promise<void> => {
    try {
      await api.post('/admin/logout');
    } finally {
      navigate('/admin', { replace: true });
    }
  };

  if (authState === 'checking') {
    return <div style={{ padding: 24 }}>กำลังตรวจสอบสิทธิ์...</div>;
  }
  if (authState === 'denied') {
    return <div style={{ padding: 24 }}>กำลังพาไปหน้าเข้าสู่ระบบ...</div>;
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.brandWrap}>
          <img src="/mheedoonung.png" alt="หมีดูหนัง" style={styles.brand} />
          <strong style={styles.brandText}>แอดมิน</strong>
        </div>
        <nav style={styles.nav}>
          <NavLink to="/admin/cards" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
            จัดการบัตร
          </NavLink>
          <NavLink to="/admin/feedback" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
            Feedback
          </NavLink>
          <NavLink to="/admin/reports" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
            แจ้งปัญหา
          </NavLink>
          <NavLink to="/admin/followup" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
            ติดตามลูกค้า
          </NavLink>
          <NavLink to="/admin/dashboard" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
            Dashboard
          </NavLink>
        </nav>
        <div style={styles.right}>
          <span style={styles.username}>{username}</span>
          <button type="button" onClick={() => void handleLogout()} style={styles.logoutButton}>
            ออกจากระบบ
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#fafafa' },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap' as const,
    padding: '10px 20px',
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
    background: '#fff',
    borderBottom: '1px solid #eee',
    position: 'sticky' as const,
    top: 0,
    zIndex: 100,
  },
  brandWrap: { display: 'flex', alignItems: 'center', gap: 8 },
  brand: { width: 32, height: 32, objectFit: 'contain' as const, borderRadius: 6 },
  brandText: { fontSize: 16 },
  nav: { display: 'flex', gap: 4, flex: 1 },
  navLink: {
    padding: '8px 14px',
    borderRadius: 8,
    color: '#555',
    textDecoration: 'none',
    fontSize: 15,
  },
  navActive: {
    padding: '8px 14px',
    borderRadius: 8,
    background: '#eef2ff',
    color: '#4f46e5',
    textDecoration: 'none',
    fontSize: 15,
    fontWeight: 700 as const,
  },
  right: { display: 'flex', alignItems: 'center', gap: 10 },
  username: { color: '#888', fontSize: 14 },
  logoutButton: {
    padding: '7px 14px',
    background: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fca5a5',
    borderRadius: 999,
    fontSize: 14,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
} as const;
