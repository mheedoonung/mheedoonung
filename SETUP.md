# mheedoonung — คู่มือติดตั้ง & deploy

เว็บดูหนังจาก Cloudflare R2: login ด้วย LINE → เติม "บัตร" → ดูหนังเต็มเรื่อง (MP4 บน R2) ผ่าน Cloudflare Worker ที่ป้องกันด้วย signed token (v2)

> เอกสารนี้ครอบเฟส 1–6 (ครบวงจร) — สิ่งที่ยังไม่ทำดูหัวข้อ [สิ่งที่ยังไม่ทำ](#สิ่งที่ยังไม่ทำ)

---

## สารบัญ
1. [สถาปัตยกรรม](#1-สถาปัตยกรรม)
2. [Prerequisites](#2-prerequisites)
3. [ติดตั้งสำหรับ dev](#3-ติดตั้งสำหรับ-dev)
4. [สร้าง LINE Login channel](#4-สร้าง-line-login-channel)
5. [เตรียมไฟล์หนัง + อัปขึ้น R2 + เพิ่มเรคคอร์ด](#5-เตรียมไฟล์หนัง--อัปขึ้น-r2--เพิ่มเรคคอร์ด)
6. [Deploy production](#6-deploy-production)
7. [ตาราง env ทั้งหมด](#7-ตาราง-env-ทั้งหมด)
8. [การตั้งค่า cookie/CORS ข้ามโดเมน (สำคัญ)](#8-การตั้งค่า-cookiecors-ข้ามโดเมน-สำคัญ)
9. [Checklist ขึ้น production](#9-checklist-ขึ้น-production)
10. [API reference](#10-api-reference)
11. [การกันดูดวิดีโอ (v2) + ทางอัปเกรด DRM](#11-การกันดูดวิดีโอ-v2--ทางอัปเกรด-drm)
12. [Troubleshooting](#12-troubleshooting)
13. [สิ่งที่ยังไม่ทำ](#สิ่งที่ยังไม่ทำ)

---

## 1. สถาปัตยกรรม

```
                ┌─────────────┐   LINE OAuth / LIFF
                │   LINE       │◀───────────────────┐
                └─────────────┘                     │
                                                    │
  ┌──────────────┐   fetch (cookie session)   ┌─────────────┐   ┌──────────┐
  │  Frontend    │ ─────────────────────────▶ │  Backend     │──▶│ MongoDB  │
  │ React/Vite   │   /me /cards /movies        │ Elysia/Bun   │   │ users/   │
  │ app.x.com    │   /playback/*               │ api.x.com    │   │ cards/   │
  └──────┬───────┘                             └──────┬───────┘   │ admins/  │
         │                                            │           │ movies   │
         │ 1) POST /playback/start → grant            │           └──────────┘
         │ 2) fetch /__auth?token (set cookie)        │ ออก grant (HMAC+IP+exp)
         │ 3) <video src=fileUrl>                     │
         ▼                                            ▼
  ┌─────────────────────────────────────────────────────────┐   ┌──────────┐
  │  Cloudflare video-worker (video.x.com)                   │──▶│ R2 bucket│
  │  /__auth → ตั้ง cookie | /<r2Key> → verify → stream Range │   │ movies/  │
  └─────────────────────────────────────────────────────────┘   └──────────┘
         egress R2 → client ฟรี (ไม่ผ่าน backend)
```

| ส่วน | ที่อยู่ใน repo | runtime | หน้าที่ |
|---|---|---|---|
| shared | `packages/shared` | — | types/DTO กลาง (`@mheedoonung/shared`) |
| backend | `apps/backend` | Bun + Elysia | auth (LINE/admin), บัตร, แคตตาล็อก, ออก playback grant |
| frontend | `apps/frontend` | Vite/React | UI: login, เติมบัตร, แคตตาล็อก, player |
| video-worker | `apps/video-worker` | Cloudflare Worker | ตรวจ grant + เสิร์ฟไฟล์จาก R2 (Range) |

---

## 2. Prerequisites

- **Bun** ≥ 1.3 (`curl -fsSL https://bun.sh/install | bash`)
- **MongoDB** — local (Docker) หรือ MongoDB Atlas
- **Cloudflare account** — เปิดใช้ R2 + Workers (Wrangler ใช้ผ่าน `bunx wrangler` ได้เลย)
- **LINE Developers account** — สร้าง LINE Login channel (+ LIFF ถ้าต้องการ)
- **ffmpeg** — สำหรับ encode ไฟล์หนัง (`brew install ffmpeg`)

---

## 3. ติดตั้งสำหรับ dev

```bash
# 1) ติดตั้ง dependency ทั้ง monorepo (ที่ root)
bun install

# 2) MongoDB (ถ้าไม่มี ใช้ docker)
docker run -d --name mdn-mongo -p 27017:27017 mongo:7

# 3) ตั้งค่า env (copy ตัวอย่างแล้วแก้)
cp apps/backend/.env.example      apps/backend/.env
cp apps/frontend/.env.example     apps/frontend/.env
cp apps/video-worker/.dev.vars.example apps/video-worker/.dev.vars
#   - backend .env: ตั้ง JWT_SECRET, LINE_CHANNEL_ID, LINE_CHANNEL_SECRET, ADMIN_PASSWORD
#   - VIDEO_GRANT_SECRET ใน backend/.env กับ video-worker/.dev.vars ต้อง "ตรงกัน"
#     (ค่า dev default ตรงกันอยู่แล้ว: dev-video-secret-change-me)

# 4) seed admin + หนังตัวอย่าง
bun run seed

# 5) รัน 3 ส่วน (คนละ terminal)
bun run dev:backend    # http://localhost:3000
bun run dev:frontend   # http://localhost:5173
bun run dev:worker     # http://localhost:8787  (= bunx wrangler dev)
```

เปิด http://localhost:5173 → กดเข้าสู่ระบบด้วย LINE → เติมบัตร (สร้างบัตรที่ `/admin/cards`) → เลือกหนัง

> หมายเหตุ: หน้าเล่นจริงต้องมีไฟล์อยู่บน R2 และ worker ทำงาน (ดูข้อ 5) — ถ้ายังไม่มีไฟล์ player จะขึ้น error โหลดวิดีโอ

### สร้างบัตร(admin)
ไปที่ http://localhost:5173/admin → login ด้วย `ADMIN_USERNAME`/`ADMIN_PASSWORD` → `/admin/cards` → กรอกจำนวนวัน + จำนวนใบ → ระบบจะแสดงรหัสบัตรให้ส่งต่อผู้ใช้

---

## 4. สร้าง LINE Login channel

1. ไปที่ [LINE Developers Console](https://developers.line.biz/console/) → สร้าง **Provider** → สร้าง **LINE Login channel**
2. เก็บ **Channel ID** และ **Channel secret** → ใส่ใน `apps/backend/.env`
   ```
   LINE_CHANNEL_ID=xxxxxxxxxx
   LINE_CHANNEL_SECRET=xxxxxxxxxxxxxxxx
   ```
3. **Callback URL** (web OAuth) — ใส่ใน LINE console (LINE Login → Callback URL) ให้ตรงกับ backend:
   - dev: `http://localhost:3000/auth/line/callback`
   - prod: `https://api.your-domain.com/auth/line/callback`
   - ค่านี้ต้องตรงกับ `LINE_LOGIN_REDIRECT_URI` ใน backend .env
4. Scope ที่ใช้: `profile openid` (โค้ดร้องขอให้อัตโนมัติ)
5. **(ถ้าจะใช้ LIFF บนมือถือ)** — สร้าง LIFF app:
   - Endpoint URL = URL ของ frontend (dev: `http://localhost:5173`, prod: `https://app.your-domain.com`)
   - Size: Full, Scope: `profile openid`
   - เก็บ **LIFF ID** → ใส่ `VITE_LIFF_ID` ใน `apps/frontend/.env`
   - ถ้าไม่ตั้ง `VITE_LIFF_ID` ระบบจะใช้ web OAuth (redirect) อัตโนมัติ

---

## 5. เตรียมไฟล์หนัง + อัปขึ้น R2 + เพิ่มเรคคอร์ด

### 5.1 สร้าง R2 bucket
Cloudflare Dashboard → R2 → Create bucket ชื่อ `mheedoonung-movies`
(ตั้ง **location hint = APAC** ตอนสร้าง — เปลี่ยนทีหลังไม่ได้ เหมาะกับผู้ใช้ไทย/ลาว)
ให้ตรงกับ `bucket_name` ใน `apps/video-worker/wrangler.toml`

### 5.2 Encode เป็น MP4 (single rate ~2Mbps + faststart)
```bash
ffmpeg -i source.mkv \
  -c:v libx264 -preset slow -crf 23 -maxrate 2.5M -bufsize 5M \
  -c:a aac -b:a 128k \
  -pix_fmt yuv420p \
  -movflags +faststart \
  the-movie.mp4
```
- `-movflags +faststart` = ย้าย moov atom ไปต้นไฟล์ → เล่น/seek ได้ทันที (จำเป็น)

### 5.3 อัปขึ้น R2 (key = `movies/<slug>.mp4`, Content-Type ถูก)
ผ่าน wrangler:
```bash
bunx wrangler r2 object put mheedoonung-movies/movies/the-movie.mp4 \
  --file=the-movie.mp4 --content-type=video/mp4
```
หรือผ่าน aws-cli (S3-compatible):
```bash
aws s3 cp the-movie.mp4 s3://mheedoonung-movies/movies/the-movie.mp4 \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  --content-type video/mp4
```

### 5.4 เพิ่มเรคคอร์ดหนังใน MongoDB
ระบบจัดการแคตตาล็อกฝั่ง admin **ยังไม่ทำ** — ตอนนี้เพิ่มผ่าน `mongosh`/Compass โดยตรง
(วันที่เก็บเป็น **ISO string** ไม่ใช่ Date object — สำคัญ ให้ใช้ `.toISOString()`):
```js
db.movies.insertOne({
  slug: "the-movie",                  // unique, url-friendly (ตรงกับ /movie/:slug)
  title: "ชื่อหนัง",
  originalTitle: "Original Title",     // optional
  synopsis: "เรื่องย่อ...",
  year: 2024,
  genres: ["แอคชั่น", "ดราม่า"],
  country: "ไทย", language: "ไทย",
  contentRating: "น 15+",             // optional
  cast: ["นักแสดง A"], director: "ผู้กำกับ",  // optional
  posterUrl: "https://cdn.../poster.jpg",
  backdropUrl: "https://cdn.../backdrop.jpg", // optional
  video: { r2Key: "movies/the-movie.mp4", durationSec: 7200, width: 1920, height: 1080 },
  status: "published",                // 'draft' = ซ่อนจากแคตตาล็อก
  featured: false,
  viewCount: 0,
  publishedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
})
```
> `video.r2Key` ต้องตรงกับ object key ที่อัปขึ้น R2 เป๊ะ — backend จะออก grant สำหรับ key นี้ และ worker จะดึงจาก key นี้
> ดูโครงสร้างเต็มได้ที่ `apps/backend/src/scripts/seed.ts`

---

## 6. Deploy production

สมมติโดเมน: frontend `app.x.com`, backend `api.x.com`, worker `video.x.com`

### 6.1 Backend (Bun + Elysia)
- host ที่ไหนก็ได้ที่รัน Bun ได้ (VM/Fly.io/Render/…)
- ตั้ง env production (ดูข้อ 7) — `NODE_ENV=production` จะเปิด guard บังคับ secret/cookie ปลอดภัย
- รัน: `cd apps/backend && bun src/index.ts` (หรือ process manager)

### 6.2 Frontend (static)
```bash
cd apps/frontend && bunx vite build      # ได้ dist/
```
- ตั้ง `VITE_API_URL`, `VITE_LIFF_ID` ก่อน build (build-time)
- deploy `dist/` ขึ้น static host (Cloudflare Pages/Netlify/…)

### 6.3 video-worker (Cloudflare)
```bash
cd apps/video-worker
# แก้ wrangler.toml: bucket_name, ALLOWED_ORIGIN=https://app.x.com, ENVIRONMENT=production
bunx wrangler secret put VIDEO_GRANT_SECRET   # ใส่ค่า "เดียวกับ" backend
bunx wrangler deploy
```
- ผูก **custom domain** `video.x.com` ให้ worker (Cloudflare → Workers → Custom Domains)
- ตั้ง backend `VIDEO_BASE_URL=https://video.x.com`

---

## 7. ตาราง env ทั้งหมด

### Backend (`apps/backend/.env`)
| ตัวแปร | dev | prod | หมายเหตุ |
|---|---|---|---|
| `PORT` | 3000 | 3000 | |
| `MONGODB_URI` | `mongodb://localhost:27017` | (Atlas URI) | |
| `MONGODB_DB` | `mheedoonung` | `mheedoonung` | |
| `JWT_SECRET` | (dev default) | **สุ่มยาว ≥32** | prod throw ถ้าเป็น default/สั้น |
| `SESSION_COOKIE_NAME` | `mdn_session` | | |
| `ADMIN_COOKIE_NAME` | `mdn_admin` | | |
| `COOKIE_SECURE` | false | **true** (บังคับใน prod) | |
| `COOKIE_SAMESITE` | `lax` | `lax`/`none` | ดูข้อ 8 |
| `COOKIE_DOMAIN` | (ว่าง) | `.x.com` (ถ้าต้องการ) | |
| `FRONTEND_URL` | `http://localhost:5173` | `https://app.x.com` | redirect หลัง login + CORS |
| `CORS_ORIGINS` | `http://localhost:5173` | `https://app.x.com` | คั่นหลายค่าด้วย `,` |
| `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` | (ของจริง) | (ของจริง) | |
| `LINE_LOGIN_REDIRECT_URI` | `http://localhost:3000/auth/line/callback` | `https://api.x.com/auth/line/callback` | ต้องตรงกับ LINE console |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | admin/changeme | (ของจริง) | seed admin |
| `VIDEO_GRANT_SECRET` | (dev default) | **สุ่มยาว ≥32** | ต้องตรงกับ worker; prod throw ถ้า default/สั้น |
| `VIDEO_BASE_URL` | `http://localhost:8787` | `https://video.x.com` | prod ต้องเป็น absolute https |
| `VIDEO_TOKEN_TTL_SECONDS` | 120 | 120 | อายุ grant (refresh ทุก ~ครึ่ง) |
| `NODE_ENV` | development | **production** | เปิด guard ความปลอดภัย |

### Frontend (`apps/frontend/.env`, build-time)
| ตัวแปร | ค่า |
|---|---|
| `VITE_API_URL` | `http://localhost:3000` / `https://api.x.com` |
| `VITE_LIFF_ID` | (ว่าง = web OAuth) / LIFF ID |
| `VITE_APP_NAME` | `mheedoonung` |

### video-worker (`wrangler.toml` vars + secret)
| ตัวแปร | ค่า |
|---|---|
| `MOVIES_BUCKET` (binding) | bucket `mheedoonung-movies` |
| `COOKIE_NAME` | `mdn_video` |
| `ALLOWED_ORIGIN` | `http://localhost:5173` / `https://app.x.com` (คั่น `,` ได้) |
| `ENFORCE_IP` | `false` (เปิดเป็น `true` หลังทดสอบ E2E แล้ว) |
| `ENVIRONMENT` | `development` / `production` (prod บังคับให้ตั้ง ALLOWED_ORIGIN) |
| `VIDEO_GRANT_SECRET` (secret) | = ค่าเดียวกับ backend |

---

## 8. การตั้งค่า cookie/CORS ข้ามโดเมน (สำคัญ)

ระบบมี cookie 2 ชุด:
1. **session cookie (backend)** — ตั้งโดย backend, frontend แนบไปกับทุก fetch (`credentials:'include'`)
2. **video cookie (worker)** — ตั้งโดย worker (`SameSite=None; Secure` เสมอ), `<video>` แนบไปกับ Range request

**กติกา SameSite ของ session cookie (backend):**
- ถ้า `app.x.com` กับ `api.x.com` อยู่ **โดเมนแม่เดียวกัน** (`x.com`) → ถือเป็น same-site → `COOKIE_SAMESITE=lax` ใช้ได้ (แนะนำตั้ง `COOKIE_DOMAIN=.x.com`)
- ถ้า frontend กับ backend อยู่ **คนละโดเมน** (เช่น Pages กับ API คนละ root) → ต้อง `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true` (HTTPS) ไม่งั้น `/me` ฝั่ง frontend จะไม่ส่ง cookie
- `CORS_ORIGINS`/`FRONTEND_URL` ต้องเป็น origin ของ frontend เป๊ะ (CORS + credentials ใช้ `*` ไม่ได้)

**video cookie (worker)** ตั้ง `SameSite=None; Secure` อยู่แล้ว → ทำงานข้าม site ได้ ขอแค่:
- worker เสิร์ฟผ่าน **HTTPS** (custom domain Cloudflare = HTTPS อยู่แล้ว)
- `ALLOWED_ORIGIN` ของ worker = origin frontend (สำหรับ CORS ตอน `/__auth`)
- `<video>` **ห้ามตั้ง `crossorigin`** (โค้ดทำไว้แล้ว) เพื่อให้ส่ง cookie ข้าม origin แบบ no-cors

---

## 9. Checklist ขึ้น production

- [ ] `JWT_SECRET` และ `VIDEO_GRANT_SECRET` สุ่มใหม่ ยาว ≥ 32 ตัว (ไม่ใช้ค่า dev)
- [ ] `VIDEO_GRANT_SECRET` ใน backend = secret ใน worker (`wrangler secret put`)
- [ ] `NODE_ENV=production` (backend) + `ENVIRONMENT=production` (worker)
- [ ] `COOKIE_SECURE=true`, `COOKIE_SAMESITE` ตั้งตามข้อ 8
- [ ] `ALLOWED_ORIGIN` (worker) + `CORS_ORIGINS`/`FRONTEND_URL` (backend) = origin frontend จริง
- [ ] LINE Callback URL ใน console = `LINE_LOGIN_REDIRECT_URI`; LIFF Endpoint = frontend URL
- [ ] R2 bucket สร้างแล้ว (location APAC) + อัปไฟล์หนัง + Content-Type `video/mp4`
- [ ] worker ผูก custom domain (HTTPS) + `VIDEO_BASE_URL` ชี้มาที่นั่น
- [ ] ทดสอบเล่น 1 เรื่องจริง (โหลด + seek) ก่อนเปิดใช้
- [ ] **ทดสอบ `ENFORCE_IP=true` แบบ E2E** ว่าไม่ 403 ผิด ๆ ก่อนเปิด (default = false)
- [ ] เปลี่ยน `ADMIN_PASSWORD` จาก default

---

## 10. API reference (ย่อ)

| Method · Path | สิทธิ์ | หน้าที่ |
|---|---|---|
| `GET /health` | - | health |
| `GET /auth/line/login` → callback | - | web OAuth |
| `POST /auth/line` `{idToken}` | - | LIFF login |
| `GET /me` · `POST /auth/logout` | - | สถานะ/ออกระบบ |
| `POST /cards/redeem` `{code}` | user | เติมบัตร (สะสมวัน) |
| `POST /admin/login` `{username,password}` · `/admin/logout` · `GET /admin/me` | - / admin | admin auth |
| `POST /admin/cards` `{days,quantity,note?}` | admin | สร้างบัตร |
| `GET /admin/cards?status&page&limit` | admin | ลิสต์บัตร |
| `POST /admin/cards/:code/revoke` | admin | ยกเลิกบัตร (เฉพาะ unused) |
| `GET /movies?genre&q&sort&page&limit` · `GET /movies/genres` | user | แคตตาล็อก (เฉพาะ published) |
| `GET /movies/:slug` | user + active | รายละเอียด |
| `POST /playback/start` `{slug}` | user + active | ออก grant + เซ็ต stream |
| `POST /playback/refresh` `{streamId}` | user + active | ต่ออายุ (409 ถ้าถูกเตะ) |
| `POST /playback/stop` `{streamId}` | user | ปิดสตรีม |

**worker:** `GET /__auth?token=<grant>` (ตั้ง cookie) · `GET|HEAD /<r2Key>` (เสิร์ฟไฟล์ Range)

---

## 11. การกันดูดวิดีโอ (v2) + ทางอัปเกรด DRM

**v2 ที่ใช้อยู่** = grant token (HMAC ผูก user/stream/r2Key/IP, อายุ ~120s) → cookie อายุสั้นที่ worker + concurrency 1 (1 บัญชี = 1 stream) + ผูก IP (ออปชัน) — กัน **แชร์ลิงก์/hotlink/แชร์บัญชี** ได้ดี และคง **egress R2 ฟรี**

**ข้อจำกัด (ตามธรรมชาติของ MP4 ในเบราว์เซอร์):** คนที่ login + active แล้วยังใช้ `yt-dlp`/`ffmpeg` ดูดไฟล์ของตัวเองได้ — v2 กัน "คนจ่ายเงินแล้วดูด" ไม่ได้ 100%

**ถ้าต้องกัน rip จริงจัง → DRM** (Widevine/FairPlay/PlayReady) เป็นทางเดียว:
- ต้อง re-package ทั้ง catalog เป็น CENC (Shaka Packager) + license server (SaaS เช่น EZDRM/Axinom/castLabs) + ทำ EME ฝั่ง frontend
- มีค่าใช้จ่าย license ต่อ stream + งานวิศวกรรมเพิ่มมาก (Cloudflare Stream ที่ scale 2PB แพงเกินไป — ตัดทิ้ง)
- เป็นโปรเจกต์แยก ทำเมื่อพบการรั่วจริงจัง (ดูบริบทใน `r2-video-streaming-conversation.md`)

---

## 12. Troubleshooting

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| `/me` ขึ้น CORS error / ไม่ติด session | `CORS_ORIGINS`/`FRONTEND_URL` ไม่ตรง origin frontend; คนละโดเมนต้อง `COOKIE_SAMESITE=none`+`COOKIE_SECURE=true` |
| login LINE redirect ไม่ได้ | Callback URL ใน LINE console ≠ `LINE_LOGIN_REDIRECT_URI` |
| วิดีโอ 401 ตลอด | (1) `VIDEO_GRANT_SECRET` backend ≠ worker (2) `/__auth` set cookie ไม่ได้ (ALLOWED_ORIGIN ไม่ตรง / ไม่ใช่ HTTPS) (3) ตั้ง `crossorigin` ที่ `<video>` (อย่าตั้ง) |
| วิดีโอ 403 เมื่อ `ENFORCE_IP=true` | IP ที่ backend ใส่ใน grant ≠ `cf-connecting-ip` ที่ worker เห็น — ปิด `ENFORCE_IP` หรือให้ backend อยู่หลัง Cloudflare เดียวกัน แล้วทดสอบ E2E |
| seek/เล่นกระตุก | ไฟล์ไม่ได้ encode `+faststart`, หรือ R2 bucket ไม่ใช่ APAC |
| backend ไม่บูตใน prod | guard เตือน: ตั้ง `JWT_SECRET`/`VIDEO_GRANT_SECRET` ให้ยาว ≥32 + `VIDEO_BASE_URL` เป็น https |
| เล่นแล้วถูกเตะทันที (409) | บัญชีถูกเปิดอีกอุปกรณ์ (concurrency=1 ตามตั้งใจ) |

---

## สิ่งที่ยังไม่ทำ

- **ระบบจัดการแคตตาล็อกฝั่ง admin** (เพิ่ม/แก้/ลบหนังผ่าน UI) — ตอนนี้เพิ่มหนังผ่าน mongosh (ข้อ 5.4)
- **DRM** — ดูข้อ 11
- **ทดสอบ E2E จริง** — ต้องมี MongoDB + LINE channel + R2/wrangler + เบราว์เซอร์ (โค้ดผ่าน typecheck/build/roundtrip ครบแล้ว)
- ระบบ search/filter ขั้นสูง, แนะนำหนัง, ประวัติการดู ฯลฯ
