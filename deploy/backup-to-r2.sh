#!/bin/bash
# backup MongoDB -> Cloudflare R2 (host เดียว = ไม่มี HA ต้องมี backup off-host แน่นอน)
# ตั้ง cron บน host เช่น (ทุกชั่วโมง):
#   0 * * * * /path/to/repo/deploy/backup-to-r2.sh >> /var/log/mdn-backup.log 2>&1
#
# ต้องมี env (อ่านจาก deploy/.env หรือ environment):
#   MONGO_ROOT_USERNAME, MONGO_ROOT_PASSWORD
#   R2_BUCKET (เช่น mheedoonung-backups), R2_ENDPOINT (https://<acct>.r2.cloudflarestorage.com)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  (R2 S3 token)
#   RETENTION_DAYS (default 7)
#   BACKUP_AGE_RECIPIENT (แนะนำ): public key ของ age สำหรับเข้ารหัส archive ฝั่ง client ก่อนอัป R2
#     - สร้าง key: `age-keygen -o backup-age.key` แล้วเก็บ private key ไว้ "นอก host นี้"
#     - เอาเฉพาะบรรทัด public key (age1...) มาใส่ BACKUP_AGE_RECIPIENT
#     - restore ต้องมี private key: `age -d -i backup-age.key <file> | ...`
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# โหลด env จาก deploy/.env ถ้ามี
[ -f "$SCRIPT_DIR/.env" ] && set -a && . "$SCRIPT_DIR/.env" && set +a

RETENTION_DAYS="${RETENTION_DAYS:-7}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

# เข้ารหัส archive ฝั่ง client ก่อนอัป R2 ถ้าตั้ง BACKUP_AGE_RECIPIENT ไว้
#   dump นี้มีข้อมูลผู้ใช้ทั้งหมด (LINE profile, session, admin) — gzip อย่างเดียวคือ plaintext
#   ถ้า R2 token/bucket หลุดหรือถูกตั้ง public พลาด = ข้อมูลทั้ง DB รั่ว
#   วาง private key ไว้นอก host นี้ เพื่อให้ token ที่อยู่บน host ถอดไฟล์เองไม่ได้
ENC_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
if [ -n "$ENC_RECIPIENT" ]; then
  if ! command -v age >/dev/null 2>&1; then
    echo "[backup] ERROR: ตั้ง BACKUP_AGE_RECIPIENT ไว้แต่ไม่พบคำสั่ง 'age' บน host — ติดตั้ง age ก่อน (กันอัปไฟล์ที่ไม่ได้เข้ารหัสโดยไม่ตั้งใจ)" >&2
    exit 1
  fi
  ARCHIVE="mheedoonung-${TS}.archive.gz.age"
else
  echo "[backup] WARN: ไม่ได้ตั้ง BACKUP_AGE_RECIPIENT — archive จะถูกอัปแบบ gzip ที่ยังไม่เข้ารหัส (ไม่แนะนำสำหรับ production)" >&2
  ARCHIVE="mheedoonung-${TS}.archive.gz"
fi
TMP="/tmp/${ARCHIVE}"
# กัน partial file ค้างใน /tmp (อาจมีข้อมูล dump บางส่วน) ถ้า dump/upload ล้มเหลวกลางคัน
trap 'rm -f "$TMP"' EXIT

echo "[backup] เริ่ม dump @ ${TS}"
# dump ผ่าน container mongo ที่รันอยู่ (gzip archive ก้อนเดียว)
#
# *สำคัญ*: ห้ามใส่ password บน argv ของ mongodump เช่น `--password ..` หรือ `--uri="mongodb://user:pass@.."`
#   เพราะ argv ของ process มองเห็นได้จาก `docker exec mongo ps aux` / /proc/<pid>/cmdline
#   ระหว่าง dump รันอยู่ (cron ทุกชั่วโมง) -> root MongoDB password รั่ว
#   mongodump ไม่อ่าน URI/password จาก env var ทั่วไป (เอกสาร: รองรับเฉพาะ AWS_* สำหรับ MONGODB-AWS)
#   จึงใช้ `--config=<yaml>` ที่อ่าน uri จากไฟล์ (วิธีที่ docs แนะนำสำหรับซ่อน secret จาก command line)
#
# วิธี: ส่ง URI เข้า container ผ่าน env (-e MDN_BACKUP_URI) แล้วใน container เขียนเป็นไฟล์ config
#   permission 600 ใน tmpfs (/dev/shm ไม่แตะดิสก์), รัน mongodump --config, ลบไฟล์ทิ้งเสมอ (trap)
#   ทั้ง URI และ config path ไม่เคยปรากฏบน argv ของ mongodump
# export เพื่อให้ส่งต่อด้วย `-e MDN_BACKUP_URI` (รูปแบบชื่ออย่างเดียว) — ค่าไม่ปรากฏบน argv
#   ของ docker CLI ฝั่ง host ด้วย (เทียบกับ `-e KEY=value` ที่ค่าจะโผล่บน command line)
export MDN_BACKUP_URI="mongodb://${MONGO_ROOT_USERNAME}:${MONGO_ROOT_PASSWORD}@127.0.0.1:27017/mheedoonung?authSource=admin"
# สคริปต์ที่รัน "ภายใน" container: สร้าง config 600 -> dump -> ลบ config (ครอบด้วย trap กันค้าง)
DUMP_IN_CONTAINER='
set -eu
CFG="$(mktemp /dev/shm/mdn-dump.XXXXXX.yaml)"
trap "rm -f \"$CFG\"" EXIT
umask 077
printf "uri: %s\n" "$MDN_BACKUP_URI" > "$CFG"
exec mongodump --config="$CFG" --archive --gzip
'
if [ -n "$ENC_RECIPIENT" ]; then
  # dump -> เข้ารหัสด้วย age (public key) -> ไฟล์ ciphertext
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T -e MDN_BACKUP_URI mongo \
    sh -c "$DUMP_IN_CONTAINER" \
    | age -r "$ENC_RECIPIENT" -o "$TMP"
else
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T -e MDN_BACKUP_URI mongo \
    sh -c "$DUMP_IN_CONTAINER" > "$TMP"
fi
unset MDN_BACKUP_URI

echo "[backup] อัปขึ้น R2: s3://${R2_BUCKET}/mongo/${ARCHIVE}"
aws s3 cp "$TMP" "s3://${R2_BUCKET}/mongo/${ARCHIVE}" \
  --endpoint-url "$R2_ENDPOINT"

rm -f "$TMP"

# ลบ backup เก่าเกิน RETENTION_DAYS (เทียบจากชื่อไฟล์ timestamp)
echo "[backup] ลบ backup เก่ากว่า ${RETENTION_DAYS} วัน"
CUTOFF="$(date -u -d "${RETENTION_DAYS} days ago" +%Y%m%dT%H%M%SZ 2>/dev/null || date -u -v-"${RETENTION_DAYS}"d +%Y%m%dT%H%M%SZ)"
aws s3 ls "s3://${R2_BUCKET}/mongo/" --endpoint-url "$R2_ENDPOINT" | awk '{print $4}' | while read -r f; do
  [ -z "$f" ] && continue
  # รองรับทั้งไฟล์ gzip ธรรมดา (.archive.gz) และไฟล์เข้ารหัส (.archive.gz.age)
  # (\.age)? = ส่วน .age มีหรือไม่มีก็ได้ — ถ้าไม่รองรับ ไฟล์เข้ารหัสจะไม่ถูก prune แล้วบวมไม่จบ
  fts="$(echo "$f" | sed -n 's/^mheedoonung-\(.*\)\.archive\.gz\(\.age\)\{0,1\}$/\1/p')"
  [ -z "$fts" ] && continue
  if [[ "$fts" < "$CUTOFF" ]]; then
    aws s3 rm "s3://${R2_BUCKET}/mongo/${f}" --endpoint-url "$R2_ENDPOINT"
  fi
done

echo "[backup] เสร็จ"
# restore (ตัวอย่าง) — เลี่ยงใส่ password บน argv เช่นเดียวกับ dump: ส่ง URI ผ่าน env (-e MDN_BACKUP_URI)
#   แล้วใน container เขียนเป็น config 600 ใน /dev/shm ให้ mongorestore --config (มี trap ลบทิ้ง)
#   export MDN_BACKUP_URI="mongodb://$MONGO_ROOT_USERNAME:$MONGO_ROOT_PASSWORD@127.0.0.1:27017/mheedoonung?authSource=admin"
#   R='set -eu; CFG="$(mktemp /dev/shm/mdn-rst.XXXXXX.yaml)"; trap "rm -f \"$CFG\"" EXIT; umask 077;
#      printf "uri: %s\n" "$MDN_BACKUP_URI" > "$CFG"; exec mongorestore --config="$CFG" --archive --gzip --drop'
#   # ไฟล์เข้ารหัส (.archive.gz.age) — ต้องมี age private key (เก็บไว้นอก host นี้):
#   aws s3 cp s3://$R2_BUCKET/mongo/<file>.age - --endpoint-url $R2_ENDPOINT | age -d -i backup-age.key | \
#     docker compose exec -T -e MDN_BACKUP_URI mongo sh -c "$R"
#   # ไฟล์ gzip ธรรมดา (.archive.gz):
#   aws s3 cp s3://$R2_BUCKET/mongo/<file> - --endpoint-url $R2_ENDPOINT | \
#     docker compose exec -T -e MDN_BACKUP_URI mongo sh -c "$R"
