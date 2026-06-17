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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
