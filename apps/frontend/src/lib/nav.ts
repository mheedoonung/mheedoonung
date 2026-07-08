// ปุ่ม "← กลับ" ในแอป: ย้อนตาม history จริง (คง query string ของหน้าก่อน เช่น /?page=2)
// เดิมใช้ <Link to="/"> = เดินหน้าไปหน้าแรกเปล่า ๆ -> pagination/ตัวกรองที่เลือกไว้หาย
// เข้าหน้านี้ตรง ๆ (แชร์ลิงก์/แท็บใหม่ — ไม่มีหน้าก่อนใน SPA) -> fallback ไปหน้าแรก
// (react-router v6 เก็บลำดับ history ไว้ใน history.state.idx — 0 = หน้าแรกของ session)
import type { NavigateFunction } from 'react-router-dom';

export function goBack(navigate: NavigateFunction): void {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate('/');
}
