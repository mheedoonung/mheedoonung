# mheedoonung

เว็บดูหนังจาก Cloudflare R2 — ผู้ใช้ต้อง login ผ่าน LINE และมี "บัตรเติมเงิน" ที่ยัง active จึงจะดูหนังได้
บัตรสร้างโดย admin, กำหนดจำนวนวันได้, ใช้ครั้งเดียว, เริ่มนับวันตอนผู้ใช้กรอก

## เทคโนโลยี

- Runtime: Bun 1.3 (รัน `.ts` ตรงได้), TypeScript strict, ESM
- Backend: ElysiaJS + official `mongodb` driver, validation ด้วย Elysia `t` (TypeBox)
- Frontend: React + Vite + react-router-dom + @line/liff
- Session: `@elysiajs/jwt` + cookie, รหัสผ่าน argon2id ผ่าน `Bun.password`

- Video: Cloudflare Worker คั่นหน้า R2 (เสิร์ฟ MP4 รองรับ Range) ป้องกันด้วย signed grant (HMAC+IP+cookie อายุสั้น) + concurrency 1

## โครงสร้าง

```
mheedoonung/
  packages/shared/      types/DTO ที่ใช้ร่วมกัน (@mheedoonung/shared)
  apps/backend/         ElysiaJS API (@mheedoonung/backend)
  apps/frontend/        React + Vite (@mheedoonung/frontend)
  apps/video-worker/    Cloudflare Worker เสิร์ฟวิดีโอจาก R2 (@mheedoonung/video-worker)
```

## วิธีรัน (dev) แบบสั้น

```bash
bun install
cp apps/backend/.env.example apps/backend/.env          # ตั้ง JWT_SECRET, LINE_*, ADMIN_PASSWORD
cp apps/frontend/.env.example apps/frontend/.env
cp apps/video-worker/.dev.vars.example apps/video-worker/.dev.vars  # VIDEO_GRANT_SECRET ตรงกับ backend
docker run -d -p 27017:27017 mongo:7                    # ถ้ายังไม่มี MongoDB
bun run seed                                            # admin + หนังตัวอย่าง
bun run dev:backend    # :3000
bun run dev:frontend   # :5173
bun run dev:worker     # :8787 (= bunx wrangler dev)
```

## สถานะ

เฟส 1–6 เสร็จ (LINE/admin auth + ระบบบัตร + แคตตาล็อก + playback v2 + player UI) —
ผ่าน typecheck/bundle/build/grant-roundtrip ครบ แต่ยังไม่ได้ทดสอบ E2E จริง

## เอกสารฉบับเต็ม

ดูการตั้งค่า LINE channel, R2/encode/upload, deploy production, env ทั้งหมด, การกันดูด/DRM,
และ troubleshooting ที่ **[SETUP.md](./SETUP.md)**
