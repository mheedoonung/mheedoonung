// App — กำหนด routing ของทั้งแอป
// เส้นทาง:
//   /login        : หน้าเข้าสู่ระบบด้วย LINE
//   /redeem       : หน้าเติมบัตร (ต้อง login)
//   /             : หน้าหลัก user area (ต้อง login + active)
//   /admin        : หน้าเข้าสู่ระบบแอดมิน
//   /admin/cards  : หน้าจัดการบัตร (guard ภายในหน้าผ่าน /admin/me)
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { InstallPrompt } from './components/InstallPrompt';
import { LoginPage } from './pages/LoginPage';
import { RedeemPage } from './pages/RedeemPage';
import { HomePage } from './pages/HomePage';
import { MovieDetailPage } from './pages/MovieDetailPage';
import { WatchPage } from './pages/WatchPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminCardsPage } from './pages/AdminCardsPage';

export function App() {
  return (
    <BrowserRouter>
      {/* ปุ่มติดตั้ง PWA — โชว์ลอยทุกหน้า (ซ่อนเองถ้าติดตั้งแล้ว/เบราว์เซอร์ไม่รองรับ) */}
      <InstallPrompt />
      <Routes>
        {/* หน้าเข้าสู่ระบบผู้ใช้ */}
        <Route path="/login" element={<LoginPage />} />

        {/* หน้าเติมบัตร — ต้อง login (แต่ยังไม่ต้อง active) */}
        <Route
          path="/redeem"
          element={
            <ProtectedRoute>
              <RedeemPage />
            </ProtectedRoute>
          }
        />

        {/* หน้าหลัก — ต้อง login และ active */}
        <Route
          path="/"
          element={
            <ProtectedRoute requireActive>
              <HomePage />
            </ProtectedRoute>
          }
        />

        {/* หน้ารายละเอียดหนัง — ต้อง login + active */}
        <Route
          path="/movie/:slug"
          element={
            <ProtectedRoute requireActive>
              <MovieDetailPage />
            </ProtectedRoute>
          }
        />

        {/* หน้าเล่นวิดีโอ — ต้อง login + active */}
        <Route
          path="/watch/:slug"
          element={
            <ProtectedRoute requireActive>
              <WatchPage />
            </ProtectedRoute>
          }
        />

        {/* ส่วนแอดมิน */}
        <Route path="/admin" element={<AdminLoginPage />} />
        <Route path="/admin/cards" element={<AdminCardsPage />} />

        {/* path อื่น ๆ -> กลับหน้าหลัก */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
