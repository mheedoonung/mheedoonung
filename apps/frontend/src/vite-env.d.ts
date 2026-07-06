/// <reference types="vite/client" />

// ประกาศ type ของ environment variables ฝั่ง frontend (Vite)
// ทำให้ import.meta.env.VITE_* มี type ที่ชัดเจนภายใต้ strict mode
interface ImportMetaEnv {
  // URL ของ backend API (เช่น http://localhost:3000)
  readonly VITE_API_URL?: string;
  // LIFF ID สำหรับ login ผ่าน LINE app (ปล่อยว่างได้ -> ใช้ web OAuth แทน)
  readonly VITE_LIFF_ID?: string;
  // ชื่อแอปที่แสดงใน UI
  readonly VITE_APP_NAME?: string;
  // ลิงก์ LINE OA สำหรับซื้อบัตรเติมเงิน (เช่น https://line.me/R/ti/p/@youroa) — ปล่อยว่าง = ซ่อนปุ่ม
  readonly VITE_LINE_OA_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
