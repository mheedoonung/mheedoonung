// Service worker จิ๋ว — มีไว้เพื่อให้ผ่านเงื่อนไข "installable" ของ Chrome/Android เท่านั้น
// ห้าม cache: แอปนี้เป็นวิดีโอ + auth cookie + R2 (playback v2 / บัตรเติมเงิน) — cache แล้วพัง
// ponytail: passthrough เปล่า ๆ; ถ้าจะทำ offline shell ค่อยเพิ่ม cache เฉพาะ static ทีหลัง
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // ไม่ respondWith -> เบราว์เซอร์ทำ network request ตามปกติ (cookie/Range แนบครบ)
});
