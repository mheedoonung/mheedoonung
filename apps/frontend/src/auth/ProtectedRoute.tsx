// ProtectedRoute — ป้องกัน route ของ user area
// - ระหว่างโหลดสถานะ auth ครั้งแรก: แสดงข้อความกำลังโหลด
// - ถ้ายังไม่ login: redirect ไป /login
// - ถ้า requireActive=true และ user ยังไม่ active (ยังไม่เติมบัตร/หมดอายุ): redirect ไป /redeem
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
  // ต้อง active (มีบัตรใช้งานได้) ถึงจะเข้าได้ไหม (ค่าเริ่มต้น false)
  requireActive?: boolean;
}

export function ProtectedRoute({ children, requireActive = false }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  // ยังโหลดสถานะ auth ไม่เสร็จ — ยังไม่ตัดสินใจ redirect
  if (loading) {
    return <div style={{ padding: 24 }}>กำลังโหลด...</div>;
  }

  // ยังไม่ login -> ไปหน้า login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // ต้อง active แต่ยังไม่ active -> ไปหน้าเติมบัตร
  if (requireActive && !user.isActive) {
    return <Navigate to="/redeem" replace />;
  }

  return <>{children}</>;
}
