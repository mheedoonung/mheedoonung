// Context จัดการสถานะ auth ของผู้ใช้ (LINE user)
// - โหลด /me ตอน mount เพื่อรู้ว่า login อยู่ไหม
// - มี login() (เริ่ม flow LINE) และ logout()
// - refresh() ให้ดึง /me ใหม่ (เช่นหลัง redeem เพื่ออัปเดต isActive)
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { MeResponse, PublicUser } from '@mheedoonung/shared';
import { api } from '../api/client';
import { loginWithLine, tryLiffAutoLogin } from '../lib/lineLogin';

// รูปร่างของ context ที่เปิดให้ component ใช้
interface AuthContextValue {
  user: PublicUser | null;
  // กำลังโหลดสถานะ auth ครั้งแรกอยู่ไหม
  loading: boolean;
  // เริ่ม flow login ด้วย LINE (web OAuth หรือ LIFF)
  login: () => Promise<void>;
  // ออกจากระบบ (เคลียร์ session ฝั่ง backend + state)
  logout: () => Promise<void>;
  // ดึง /me ใหม่เพื่อรีเฟรชสถานะ (เช่นหลังเติมบัตร)
  refresh: () => Promise<void>;
  // (DEV เท่านั้น) เข้าระบบโดยไม่ผ่าน LINE — backend จะ 404 ถ้าไม่ได้เปิด DEV_LOGIN_ENABLED
  devLogin: (lineUserId?: string, displayName?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Provider — ครอบทั้งแอปใน main.tsx
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // ดึง /me — อัปเดต user ตามที่ server ตอบ (res.user เป็น null = ไม่ได้ login แล้วจริง)
  // network error ชั่วคราว -> คง user เดิมไว้ (อย่าเผลอดีดคนที่ session ยังดีออกไป login)
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await api.get<MeResponse>('/me');
      setUser(res.user);
    } catch {
      // เงียบ — ค่าเดิมยังใช้ได้อยู่
    }
  }, []);

  // โหลดสถานะ auth ครั้งแรกตอน mount
  useEffect(() => {
    let active = true;
    (async () => {
      // 1) มี session อยู่แล้วไหม
      try {
        const res = await api.get<MeResponse>('/me');
        if (res.user) {
          if (active) {
            setUser(res.user);
            setLoading(false);
          }
          return;
        }
      } catch {
        // ยังไม่ login -> ไปลอง LIFF ต่อ
      }
      // 2) ยังไม่ login -> ถ้าเข้าผ่าน LINE in-app browser (LIFF) ลอง auto-login แบบเงียบ
      //    (ไม่ใช่ LIFF / ไม่ได้ตั้ง LIFF ID -> คืน null, ตกไปหน้า login ตามปกติ)
      try {
        const liffRes = await tryLiffAutoLogin();
        if (active && liffRes?.user) setUser(liffRes.user);
      } catch {
        // เงียบ
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // เริ่ม flow login — กรณี LIFF จะได้ MeResponse กลับมาแล้วอัปเดต state ทันที
  // กรณี web OAuth จะ redirect ออกไป (โค้ดหลังจากนั้นไม่ทำงาน)
  const login = useCallback(async (): Promise<void> => {
    const result = await loginWithLine();
    if (result && result.user) {
      setUser(result.user);
    }
  }, []);

  // ออกจากระบบ
  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  // (DEV เท่านั้น) เข้าระบบผ่าน /auth/dev-login
  const devLogin = useCallback(async (lineUserId?: string, displayName?: string): Promise<void> => {
    const res = await api.post<MeResponse>('/auth/dev-login', { lineUserId, displayName });
    if (res.user) setUser(res.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, refresh, devLogin }),
    [user, loading, login, logout, refresh, devLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// hook สำหรับใช้ context — โยน error ถ้าใช้นอก Provider
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth ต้องถูกใช้ภายใน <AuthProvider>');
  }
  return ctx;
}
