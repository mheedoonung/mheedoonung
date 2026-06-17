import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// คอนฟิก Vite — dev server ที่พอร์ต 5173, plugin react
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
