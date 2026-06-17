# Image ของ backend (Bun + Elysia) — รัน TS ตรงไม่ต้อง build
# build context = repo root (ดู docker-compose.yml: context: ..)
FROM oven/bun:1.3-alpine

WORKDIR /app

# 1) copy manifest ของ "ทุก" workspace + lockfile ก่อน (ให้ workspace graph ตรงกับ lockfile
#    ไม่งั้น --frozen-lockfile จะ error ว่า out-of-sync) — ใช้ layer cache ตอน install
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/video-worker/package.json apps/video-worker/

# 2) ติดตั้ง dependency (workspace) — ไม่เอา devDeps (Bun รัน TS ได้โดยไม่ต้อง tsc)
RUN bun install --frozen-lockfile --production

# 3) copy source (เฉพาะ workspace ที่ backend ใช้)
COPY packages/shared packages/shared
COPY apps/backend apps/backend

# รันแบบ non-root (image oven/bun มี user 'bun' อยู่แล้ว)
USER bun

EXPOSE 3000

# env มาจาก compose (process.env) — ไม่ต้องมีไฟล์ .env ใน image
CMD ["bun", "apps/backend/src/index.ts"]
