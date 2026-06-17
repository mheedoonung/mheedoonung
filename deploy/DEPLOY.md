# Deploy แบบ self-host (1 host: 2 vCPU / 8GB) — backend + MongoDB co-located

frontend = static (Cloudflare Pages), video-worker = Cloudflare Worker → **ไม่อยู่บน host นี้**
host นี้รันแค่ **backend (Bun/Elysia) + MongoDB** ผ่าน Docker Compose

## โทโพโลยี
```
              Cloudflare (edge)
  app.x.com  ─► Pages (frontend static build)
  api.x.com  ─► Tunnel ─┐
  video.x.com─► Worker ─┼──► R2 (ไฟล์หนัง)
                        │
        ┌───────────────▼──────────────────────────┐
        │  HOST 2vCPU/8GB  (docker compose)         │
        │  ┌────────────┐   internal   ┌─────────┐  │
        │  │ cloudflared│──► backend:3000 ──► mongo │  │
        │  └────────────┘   network     │ :27017  │  │
        │            (mongo ไม่ publish ออก host)   │  │
        └───────────────────────────────────────────┘
                   │ cron: mongodump ─► R2 (backups)
```

## การแบ่งทรัพยากร (2 vCPU / 8GB)
| service | cpu | mem | หมายเหตุ |
|---|---|---|---|
| mongo | 1.0 | 3g | WiredTiger cache cap 1.5g (dataset เล็ก แต่กัน OOM) |
| backend | 0.8 | 1g | Bun single-thread เบามาก |
| cloudflared | 0.1 | 256m | tunnel |
| (OS/page cache) | ~0.1 | ~3.7g | เหลือให้ระบบ + ช่วย mongo I/O |

> backend ได้ ~1 core, mongo ได้ ~1 core → balanced ดีกับ workload นี้ (backend ไม่ค่อยใช้ CPU เพราะไม่สตรีมวิดีโอ)

## ขั้นตอน deploy

```bash
# 1) เตรียม env (จาก repo root)
cp deploy/.env.example         deploy/.env          # mongo creds, CF tunnel token, R2 backup
cp deploy/backend.env.example  deploy/backend.env   # JWT/VIDEO secret, LINE, cookie, video
#   - ตั้ง MONGO_*_PASSWORD, JWT_SECRET, VIDEO_GRANT_SECRET (>=32, VIDEO ตรงกับ worker)
#   - COOKIE_DOMAIN/FRONTEND_URL/CORS_ORIGINS/LINE_* ให้ตรงโดเมนจริง
chmod +x deploy/mongo-init.sh deploy/backup-to-r2.sh

# 2) build + start (mongo จะสร้าง appuser ครั้งแรกอัตโนมัติ)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build

# 3) seed admin + หนังตัวอย่าง (รันครั้งเดียว ใน container backend)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  run --rm backend bun apps/backend/src/scripts/seed.ts

# 4) ดูสถานะ/health
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f backend
```

> ⚠️ **ต้องแทนค่า `CHANGE_ME_*` ทุกตัวด้วยค่าสุ่มจริง** ก่อน deploy:
> - `JWT_SECRET`, `VIDEO_GRANT_SECRET`, `ADMIN_PASSWORD` (ใน `backend.env`): backend มี guard เช็คทั้งความยาว >=32, ค่า dev default, **และคำว่า `CHANGE_ME`** → ถ้าลืม replace backend จะ **ไม่บูต** (กันค่า placeholder ที่อยู่ใน repo หลุดไป prod)
> - `MONGO_ROOT_PASSWORD`, `MONGO_APP_PASSWORD` (ใน `.env`): backend ไม่มี guard ดักโดยตรง — ถ้าลืม replace ค่า `CHANGE_ME` จะถูกใช้สร้าง user จริงตอน initdb (เดาได้ = อันตราย) แล้ว backend จะ auth ไม่ผ่านเอง **ต้อง replace เองเสมอ**
> - สร้างค่าสุ่มได้ด้วย: `openssl rand -base64 36`
> - backup → R2: ตั้ง `BACKUP_AGE_RECIPIENT` (ใน `.env`) เพื่อเข้ารหัส dump ฝั่ง client ก่อนอัป (ดู section Backup)

## Cloudflare Tunnel (expose backend)
1. Cloudflare Zero Trust → Networks → Tunnels → Create tunnel → คัดลอก **token** ใส่ `CF_TUNNEL_TOKEN` ใน `deploy/.env`
2. Public Hostname: `api.x.com` → Service `http://backend:3000`
3. ข้อดี: ไม่เปิด inbound port บน host, TLS ที่ edge, และ backend เห็น **cf-connecting-ip เดียวกับ worker** → `ENFORCE_IP` ใช้ได้ตรงกัน
> ทางเลือกแทน tunnel: ใส่ Caddy/nginx (auto-HTTPS) หน้า backend แล้ว orange-cloud `api.x.com` — แต่ tunnel ง่ายและปลอดภัยกว่าสำหรับ host เดียว

## Frontend (ไม่อยู่บน host นี้)
```bash
cd apps/frontend
# ตั้ง VITE_API_URL=https://api.x.com, VITE_LIFF_ID (ถ้าใช้) ก่อน build
bunx vite build          # -> dist/  อัปขึ้น Cloudflare Pages (app.x.com)
```

## Backup (จำเป็น — host เดียว = ไม่มี HA)
ตั้ง cron บน host:
```cron
0 * * * * /path/to/repo/deploy/backup-to-r2.sh >> /var/log/mdn-backup.log 2>&1
```
- dump → (เข้ารหัส age) → gzip → R2 ทุกชั่วโมง, เก็บ `RETENTION_DAYS` วัน (dataset เล็ก backup ถี่ได้)
- **เข้ารหัสฝั่ง client (แนะนำ)**: ตั้ง `BACKUP_AGE_RECIPIENT` (public key จาก `age-keygen`) ใน `deploy/.env` → archive จะถูกเข้ารหัสก่อนอัป (`*.archive.gz.age`); เก็บ **private key ไว้นอก host นี้** เพื่อให้ R2 token ที่อยู่บน host ถอดไฟล์เองไม่ได้ ถ้าเว้นว่างสคริปต์จะอัปแบบไม่เข้ารหัส (มี WARN)
- creds ของ mongodump/mongorestore ส่งผ่าน env (`-e MONGODB_BACKUP_URI`) ไม่ใส่บน argv (กัน password โผล่ใน `ps`/`/proc`)
- **ทดสอบ restore จริง** อย่างน้อยครั้งนึง (คำสั่ง restore อยู่ท้าย `backup-to-r2.sh` — รวมขั้น `age -d` สำหรับไฟล์ที่เข้ารหัส)

## ความจุที่คาดได้ (setup นี้)
- backend ~1 core + mongo ~1 core: รับ **คนดูพร้อมกันหลักพันถึง ~10–15k** ก่อนเริ่มแย่ง CPU
- โหลดหลัก = heartbeat `/playback/refresh` (1/60วิ/คน) → ที่ 3k คน ≈ 50 writes/s (mongo ว่างมาก)
- ตามโจทย์ 10k users → **เพียงพอสบาย** (วิดีโอ bytes ไม่แตะ host นี้ — วิ่ง R2→Worker→client)
- **Lever ลดโหลด**: เพิ่ม `VIDEO_TOKEN_TTL_SECONDS` (120→300) → heartbeat ลดครึ่ง

## ⚠️ ความเสี่ยงที่ต้องรับรู้ (host เดียว)
- **ไม่มี HA**: host/pod ตาย = ทั้งระบบล่ม (login/ดูหนังไม่ได้) — backup off-host จึงสำคัญสุด
- **DB + backend อยู่เครื่องเดียว**: ถ้า backend spike แย่ง CPU mongo → ตั้ง cpu limit ไว้กันแล้ว (ปรับได้)
- ทางโตต่อ: backend stateless (JWT cookie) → ย้าย/เพิ่ม replica ได้ง่าย; mongo อยากได้ HA → ทำ replica set 3 host

## คำสั่งที่ใช้บ่อย
```bash
C="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
$C up -d --build          # deploy/อัปเดต
$C restart backend        # restart เฉพาะ backend
$C logs -f backend mongo  # ดู log
$C down                   # หยุด (volume mongo-data ยังอยู่)
```
