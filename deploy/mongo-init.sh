#!/bin/bash
# init script — รันครั้งแรกที่ mongo สร้าง volume (โดย entrypoint ของ image mongo)
# สร้าง "appuser" ที่มีสิทธิ์เฉพาะ readWrite บน DB mheedoonung (ไม่ใช้ root ใน backend)
set -euo pipefail

mongosh \
  --quiet \
  --username "$MONGO_INITDB_ROOT_USERNAME" \
  --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin <<EOF
db = db.getSiblingDB('mheedoonung');
db.createUser({
  user: 'appuser',
  pwd: '${MONGO_APP_PASSWORD}',
  roles: [{ role: 'readWrite', db: 'mheedoonung' }]
});
print('[mongo-init] สร้าง appuser (readWrite @ mheedoonung) สำเร็จ');
EOF
