# video-worker

Cloudflare Worker คั่นหน้า R2 — ตรวจ "grant token" (HMAC ที่ backend ออกให้) แล้วเสิร์ฟไฟล์หนังจาก R2 (egress ฟรี, รองรับ HTTP Range/seek)

## การทำงาน (v2 protection)
1. frontend เรียก `POST /playback/start` ที่ backend → ได้ `authUrl` (มี grant) + `fileUrl`
2. frontend `fetch(authUrl, { credentials: 'include' })` → worker `/__auth` ตรวจ grant แล้ว `Set-Cookie` (HttpOnly, Secure, SameSite=None, อายุสั้น ~2 นาที)
3. `<video src={fileUrl}>` → ทุก Range request แนบ cookie อัตโนมัติ → worker ตรวจ cookie + เช็คว่า `grant.key` ตรงไฟล์ที่ขอ (+ IP ถ้าเปิด `ENFORCE_IP`) → ดึงจาก R2
4. frontend `POST /playback/refresh` ทุก ~ttl/2 → ได้ grant ใหม่ → `fetch(authUrl)` set cookie ใหม่ (ต่อเนื่องโดยไม่ต้องเปลี่ยน `<video src>`); ถ้าบัญชีถูกเปิดจากอีกเครื่อง refresh จะได้ 409 → ถูกเตะใน ~ttl

grant format ต้องตรงกับ backend (`apps/backend/src/lib/crypto.ts` hmacSign) — โค้ด verify อยู่ใน `src/grant.ts` (WebCrypto)

## ตั้งค่า
- `wrangler.toml`: เปลี่ยน `bucket_name` เป็น R2 bucket จริง, `ALLOWED_ORIGIN` เป็นโดเมน frontend
- secret `VIDEO_GRANT_SECRET` ต้องตรงกับ backend:
  - dev: `cp .dev.vars.example .dev.vars`
  - prod: `bunx wrangler secret put VIDEO_GRANT_SECRET`

## รัน
```bash
cp .dev.vars.example .dev.vars        # ครั้งแรก
bun run dev        # = bunx wrangler dev (รันที่ http://localhost:8787)
bun run deploy     # = bunx wrangler deploy
bun run typecheck  # tsc --noEmit
```
ฝั่ง backend ตั้ง `VIDEO_BASE_URL=http://localhost:8787` (dev) ให้ตรงกับ worker

## หมายเหตุ
- ต้องอัปไฟล์หนังขึ้น R2 ด้วย object key ตรงกับ `movies.video.r2Key` (เช่น `movies/<slug>.mp4`) + Content-Type `video/mp4` (`--movflags +faststart` ตอน encode เพื่อ seek ได้ทันที)
- `ENFORCE_IP=true` กันแชร์ลิงก์/cookie ข้ามเครือข่ายได้ แต่ผู้ใช้ที่ IP เปลี่ยนบ่อย (มือถือ) อาจสะดุด — backend ต่อ IP ใหม่ให้ทุกครั้งที่ refresh อยู่แล้ว
