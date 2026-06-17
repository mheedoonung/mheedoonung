// entry point ของ frontend — mount React app เข้า #root
// (index.html ชี้มาที่ /src/main.tsx)
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './auth/AuthContext';
import { App } from './App';
import './index.css';

// หา element root (ถ้าไม่เจอถือว่า config index.html ผิด — โยน error ให้รู้ทันที)
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('ไม่พบ element #root ใน index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    {/* ครอบทั้งแอปด้วย AuthProvider เพื่อให้ทุกหน้าเข้าถึงสถานะ auth ได้ */}
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
