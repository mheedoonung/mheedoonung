// จัดการ flow login ผ่าน LINE — รองรับ 2 ทาง:
// 1) LIFF (มือถือ/ใน LINE app) : ถ้ามี VITE_LIFF_ID และอยู่ในบริบท LIFF -> liff.init -> liff.login -> getIDToken -> POST /auth/line
// 2) Web OAuth : เปิดหน้า login ของ backend (GET /auth/line/login) ด้วยการ redirect ทั้งหน้า
import liff from '@line/liff';
import type { MeResponse } from '@mheedoonung/shared';
import { api } from '../api/client';

// LIFF ID จาก env (อาจว่าง = ไม่ได้ตั้งค่า LIFF)
const LIFF_ID = import.meta.env.VITE_LIFF_ID ?? '';

// เช็คว่าควรใช้ LIFF ไหม: ต้องมี LIFF ID ก่อน
function shouldUseLiff(): boolean {
  return typeof LIFF_ID === 'string' && LIFF_ID.trim().length > 0;
}

// login ผ่าน LIFF — คืน MeResponse เมื่อ login สำเร็จ (backend ตั้ง session cookie ให้แล้ว)
// ถ้ายังไม่ได้ login ใน LIFF จะ trigger liff.login() ซึ่ง redirect ออกไป (ฟังก์ชันนี้จะไม่ return ในเคสนั้น)
async function loginWithLiff(): Promise<MeResponse> {
  await liff.init({ liffId: LIFF_ID });

  // ยังไม่ login -> สั่ง login (จะ redirect ออกจากหน้า แล้วกลับมา init ใหม่รอบหน้า)
  if (!liff.isLoggedIn()) {
    liff.login();
    // หลัง liff.login() เบราว์เซอร์จะ redirect — โค้ดข้างล่างจะไม่ทำงาน
    // คืน user:null ไว้กัน type (ของจริงจะไม่ถึงตรงนี้)
    return { user: null };
  }

  // ได้ id token จาก LIFF แล้วส่งให้ backend verify + ตั้ง session
  const idToken = liff.getIDToken();
  if (!idToken) {
    throw new Error('ไม่สามารถดึง ID token จาก LIFF ได้ กรุณาลองใหม่อีกครั้ง');
  }

  // POST /auth/line {idToken} -> MeResponse (backend ตั้ง cookie session ให้)
  return api.post<MeResponse>('/auth/line', { idToken });
}

// เริ่ม flow login — เลือก LIFF หรือ web OAuth อัตโนมัติ
// - กรณี LIFF: คืน MeResponse (ผู้เรียกควรรีเฟรช auth state)
// - กรณี web: redirect ทั้งหน้าไป backend (ฟังก์ชันไม่ return)
export async function loginWithLine(): Promise<MeResponse | void> {
  if (shouldUseLiff()) {
    return loginWithLiff();
  }

  // web OAuth — ให้ backend เป็นคนสร้าง state + redirect ไป LINE
  window.location.href = `${api.baseUrl}/auth/line/login`;
}
