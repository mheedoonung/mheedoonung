# บทสนทนาเต็ม: Cloudflare R2 สำหรับ Stream Video

> Export บทสนทนาทั้งหมดเพื่อใช้เป็น context ต่อกับ Claude Code (ราคา R2 verify จาก Cloudflare docs ทางการ ณ มิ.ย. 2026)

---

## Turn 1

**User:** สรุปราคาการใช้งาน r2 เพื่อ stream video ให้หน่อย

**Claude:**

ราคา R2 ปัจจุบัน:

| รายการ | Standard | Infrequent Access |
|---|---|---|
| Storage | $0.015 / GB-month | $0.01 / GB-month |
| Class A ops (write) | $4.50 / ล้าน requests | $9.00 / ล้าน requests |
| Class B ops (read) | $0.36 / ล้าน requests | $0.90 / ล้าน requests |
| Data Retrieval | ไม่มี | $0.01 / GB |
| Egress (transfer ออก internet) | ฟรี | ฟรี |

Free tier ต่อเดือน: storage 10 GB, Class A 1 ล้าน requests, Class B 10 ล้าน requests

**จุดสำคัญสำหรับ stream video:**

หัวใจคือ egress ฟรีทุก volume — เหมาะกับงาน video มากเพราะ video เป็น bandwidth-heavy งานที่ปกติบน S3 ค่า egress จะกินบิลเป็นหลัก แต่บน R2 เป็นศูนย์ (เคสเก็บ 1TB serve egress 10TB/เดือน: S3 ตกประมาณ $923/เดือน ส่วน R2 ราว $15–20/เดือน)

สิ่งที่ต้องคิดเพิ่มเฉพาะงาน streaming:
1. **Class B ops จาก segment requests** — ถ้าใช้ HLS/DASH วิดีโอถูกหั่นเป็น segment แต่ละ segment fetch = 1 GetObject = 1 Class B op
2. **อย่า serve production ผ่าน `r2.dev` โดยตรง** — r2.dev rate-limit สำหรับ test เท่านั้น ของจริงต้องผูก custom domain
3. **R2 = raw storage** — ไม่ทำ transcoding/ABR/DRM ให้ ถ้าต้องการ pipeline ครบใช้ Cloudflare Stream (คิดราคาแยก per-minute)

**ตัวอย่างคำนวณ** (เก็บ 100GB, serve 5TB/เดือน, ~6M segment requests):
- Storage: (100−10) × $0.015 = $1.35
- Egress 5TB: $0
- Class B 6M: หัก free 10M → $0
- รวม ≈ $1.35/เดือน (เทียบ S3 egress 5TB อย่างเดียว ~$250–450)

---

## Turn 2

**User:** Standard กับ Infrequent Access ต่างกันยังไง

**Claude:**

ต่างกันที่ logic การคิดเงิน — IA ลดค่า storage แต่เก็บแพงตอนเข้าถึง เหมาะกับข้อมูลที่นาน ๆ อ่านที

| | Standard | Infrequent Access |
|---|---|---|
| Storage | $0.015/GB | $0.01/GB (ถูกกว่า) |
| Class A (write) | $4.50/M | $9.00/M (แพง 2x) |
| Class B (read) | $0.36/M | $0.90/M (แพง 2.5x) |
| Data Retrieval | ไม่มี | $0.01/GB ทุกครั้งที่อ่าน |
| Min storage duration | ไม่มี | 30 วัน (ลบก่อนก็โดนคิดเต็ม) |

**จุดคุ้มทุน (break-even):** ต่อ 1 GB ที่อ่าน N ครั้ง/เดือน
- Standard = $0.015 (คงที่)
- IA = $0.01 + ($0.01 × N)
- เท่ากันที่ N = 0.5 → ถ้าไฟล์ถูกอ่านบ่อยกว่าทุก 2 เดือนครั้ง Standard ถูกกว่าทันที

**สรุปสำหรับ video:**
- วิดีโอ active catalog → Standard ชัวร์
- วิดีโอเก่า/archive แทบไม่มีคนดู → IA คุ้ม
- Pattern นิยม: lifecycle rule ย้าย Standard → IA หลังเก็บ X วัน
- งาน streaming ที่ยังมีคนดู: Standard เกือบทุกกรณี

---

## Turn 3

**User:** ประเมินให้หน่อยถ้า storage 8tb คนดู 1 หมื่นคน ดูคนละ 100เรื่องต่อเดือน เรื่องละ 2gb

**Claude:**

สมมติฐาน: 8 TB = 8,000 GB, ยอดดู = 10,000 × 100 = 1,000,000 views/เดือน, egress = 1,000,000 × 2 GB = 2,000 TB (~2 PB)/เดือน

**ค่า R2 ต่อเดือน:**
- Storage (Standard): (8,000 − 10) × $0.015 = $119.85
- Egress 2 PB: $0
- Class B ops (สวิงตามวิธี serve):

| วิธี serve | ops/view | ops รวม/เดือน | ค่าใช้จ่าย |
|---|---|---|---|
| Progressive (1 ไฟล์/ดู 1 GET) | 1 | 1M (ฟรีหมด) | $0 |
| HLS/DASH (~500 segment) | ~500 | 500M − 10M ฟรี | ~$176 |

ถ้าผูก custom domain + CDN cache (~85% hit) → ops จริงถึง R2 ~75M → ~$24/เดือน

**รวมค่า R2:**
| Scenario | ต่อเดือน |
|---|---|
| Progressive download | ~$120 |
| HLS + CDN cache (เคสจริง) | ~$145 |
| HLS ไม่ cache เลย (worst case) | ~$296 |

**เทียบ S3** (egress 2PB, ไล่ tier us-east-1):
- 9.9 TB แรก × $0.09 = $891
- 40 TB ถัดมา × $0.085 = $3,400
- 100 TB ถัดมา × $0.07 = $7,000
- เกิน 150 TB × $0.05 → 1,850 TB × $0.05 = $92,500
- รวม egress ≈ $103,800 + storage $184 → **S3 ≈ $104,000/เดือน**

ประหยัดราว $103,000+/เดือน (~99.7%) ทั้งหมดมาจาก egress ฟรี

**ข้อควรระวัง:** ต้อง serve ผ่าน custom domain + CDN cache (ไม่ใช่ r2.dev), segment size ยิ่งยาว ops ยิ่งน้อย

---

## Turn 4

**User:** ความยาวเฉลี่ยแต่ละเรื่องคือ 2 ชม - 2.5ชม

**Claude:**

ความยาว 2–2.5 ชม. ที่ไฟล์ 2GB = bitrate ราว ~1.8–2.2 Mbps (SD/low-HD) — segment count ต่อเรื่องเพิ่มขึ้นเยอะ ทำให้ Class B เป็นตัวแปรหลัก (Storage $120 + egress $0 ไม่เปลี่ยน เพราะคิดจากขนาดไฟล์ไม่ใช่ความยาว)

**Segment count (HLS 6 วินาที):**
- 2 ชม. = 7,200/6 = 1,200 segments/เรื่อง
- 2.5 ชม. = 9,000/6 = 1,500 segments/เรื่อง

**Class B ops/เดือน (1M views):**
| Config | ops จริงถึง R2 | ค่าใช้จ่าย |
|---|---|---|
| 6s segment, ไม่ cache | 1.2–1.5B | $430–540 |
| 6s segment, CDN cache ~85% | ~180–225M | $61–77 |
| 10s segment, CDN cache ~85% | ~110–135M | ~$36–45 |

**สรุปค่า R2 รวม:**
| Scenario | รวม |
|---|---|
| HLS 6s + CDN cache (เคสจริง) | ~$185–200 |
| HLS 10s + CDN cache (optimize) | ~$155–165 |
| HLS 6s ไม่ cache (worst) | ~$550–660 |

S3 ยังเท่าเดิม ~$104,000/เดือน

**Lever คุมบิล:** CDN cache ให้แน่น, ขยาย segment เป็น 10 วิ (ลด ops ~40%), ระวัง ABR หลาย rendition, bitrate ต่ำ (~2Mbps) ถ้าอัปคุณภาพ storage จะโตแต่ egress ยังฟรี

---

## Turn 5

**User:** สำหรับ r2 เราสามารถกำหนด จำนวนวินาทีของ segment ได้หรือ ส่วนความชัด video ต้นฉบับมีเรทเดียว

**Claude:**

ไม่ได้ — R2 เป็น object storage ล้วน ๆ ไม่มี transcoding/packaging/segmenting ในตัว มองทุกอย่างเป็น "object" จำนวนวินาทีต่อ segment กำหนดที่ **ขั้นตอน packaging ก่อน upload** ต่างหาก

**กำหนด segment ตอน package ด้วย ffmpeg:**
```bash
ffmpeg -i source.mp4 \
  -c:v libx264 -c:a aac \
  -g 250 -keyint_min 250 -sc_threshold 0 \
  -hls_time 10 \
  -hls_segment_type fmp4 \
  -hls_playlist_type vod \
  output.m3u8
```
- `-hls_time 10` = target 10 วิ/segment
- `-g 250 -keyint_min 250` = keyframe ทุก 10 วิ (ที่ 25fps) — สำคัญเพราะ segment ตัดที่ keyframe เสมอ ตั้ง GOP = segment duration จะได้ยาวเป๊ะ
- `-sc_threshold 0` = ปิด scene-cut keyframe

**ข่าวดีจาก single rendition:** เรทเดียว = ไม่มี ABR ladder → ตัด concern เรื่อง ABR switching ทิ้งได้ segment count/view = ความยาว ÷ segment duration เป๊ะ, storage เก็บชุดเดียว
- 10s segment: 2 ชม. = 720, 2.5 ชม. = 900 segments/เรื่อง → รวม ~$155–165/เดือน

**ถ้าไม่อยากทำ pipeline เอง:** Cloudflare Stream จัดการ transcode+package+ABR+delivery ให้ แต่คิด per-minute delivered ซึ่งที่ volume 2PB น่าจะแพงกว่า R2+package เองมาก

---

## Turn 6

**User:** อ้าว r2 ไม่สามารถกำหนด meme type [MIME type] แล้วโยน public url ออกไปแล้วสามารถดู video บน url นั้นได้เลยเหมือนของ s3 หรือ

**Claude:**

ใช่ — R2 ทำได้เหมือน S3 ทุกอย่างในจุดนี้:
- **Content-Type / MIME type**: set ได้ (S3-compatible) กำหนดตอน PutObject เช่น `video/mp4`
- **Public URL เล่นวิดีโอตรง ๆ**: ได้ ผูก custom domain → `https://cdn.yourdomain.com/movie.mp4` แปะใน `<video>` เล่นได้เลย รองรับ HTTP Range request → seek ได้เหมือน S3
- เรทเดียวไม่จำเป็นต้องทำ HLS ก็ได้ โยน MP4 ก้อนเดียวแล้ว serve ตรง ๆ (ใช้ `-movflags +faststart`)

**แต่มี catch สำหรับไฟล์ 2GB — เรื่อง cache:**

| Plan | Max file size ที่ cache ได้ |
|---|---|
| Free / Pro / Business | 512 MB ต่อไฟล์ |
| Enterprise | 5 GB ต่อไฟล์ (ขอเพิ่มได้) |

ไฟล์ 2GB > 512MB → ถ้าไม่ใช่ Enterprise MP4 ก้อนเดียวจะไม่ถูก cache ที่ edge ทุก request วิ่งไป R2 origin (egress ยังฟรี แต่ไม่ได้ความเร็ว/latency จาก edge)

**เหตุผลที่ HLS ยังน่าสนใจแม้เรทเดียว:** segment เล็ก (ไม่กี่ MB) < 512MB → cache ที่ edge ได้ทุก plan
- Direct MP4 ก้อนเดียว: ง่ายสุด Class B น้อย แต่ไม่ cache (ถ้าไม่ Enterprise)
- HLS segment เล็ก: cache edge ได้ → เร็วกว่า origin โหลดน้อยกว่าตอน scale

ทั้งคู่ egress ฟรี ความต่างคือ performance + origin load ไม่ใช่ราคา

---

## Turn 7

**User:** Pro

**Claude:**

Pro plan = cache เพดาน 512MB ต่อไฟล์ → ไฟล์ 2GB serve เป็น MP4 ก้อนเดียวจะไม่ถูก cache → ฟันธงควรไป HLS แบบหั่น segment เพื่อให้แต่ละชิ้นเล็กพอ edge cache ได้

**ทำไม HLS ชนะ:** ที่ bitrate ~2Mbps segment 10 วิ ≈ ~2.5MB, 6 วิ ≈ ~1.5MB — เล็กกว่า 512MB เยอะ cache ได้สบาย user ส่วนใหญ่โดน edge ไม่แตะ R2 origin

**Setup แนะนำ:**
1. Package เป็น HLS, segment 10 วิ (long-form 2 ชม. ใช้ 10 วิคุ้ม), keyframe align
2. Upload segment + .m3u8 ขึ้น R2, Content-Type ถูก (`application/vnd.apple.mpegurl` สำหรับ .m3u8)
3. ผูก custom domain (ห้าม r2.dev)
4. ตั้ง cache แน่น — Cache Rule "Cache Everything" + `Cache-Control: public, max-age=31536000, immutable` ที่ segment

**ค่าใช้จ่าย (Pro + HLS 10s + cache):**
| รายการ | ต่อเดือน |
|---|---|
| Storage 8TB | $120 |
| Egress 2PB | $0 |
| Class B (cache hit ~85–90%) | ~$26–40 |
| รวม | ~$150–160/เดือน |

หมายเหตุ: serve media ผ่าน R2 + custom domain เป็น path ที่ Cloudflare ออกแบบมาให้ทำ (egress ฟรี) ต่างจากการยัด video ใส่ plain CDN เฉย ๆ

---

## Turn 8

**User:** แต่การทำวิ่งทะลุไปโหลดไฟล์ 2gb แบบไม่ผ่าน cache แต่ก็ทำให้จำนวน request ลดลงนิ่

**Claude:**

ใช่เลย จับประเด็นถูก — direct MP4 ที่ไม่ cache มี request น้อยกว่า HLS มาก

| | Direct MP4 (uncached) | HLS cached ~85% |
|---|---|---|
| Request/view | ~10–50 (Range request) | 720–900 segments |
| Class B ops ถึง R2/เดือน | ~10–50M | ~110–135M (เฉพาะ cache miss) |
| ค่า Class B | ~$0–15 | ~$35–45 |
| ไบต์จาก R2 origin | 100% (2PB) | ~15% (~300TB) |
| Edge cache | ไม่มี | มี |

เรื่องราคา Class B → direct MP4 ชนะจริง ส่วนต่างแค่ ~$30/เดือน (น้อยมาก)

**Trade-off จริงคือ performance / delivery ไม่ใช่ราคา:**
- Direct MP4 uncached: ทุก view ดึงจาก R2 origin (ผ่าน network Cloudflare, R2 uncached ~60–70 MB/s) แต่ latency สูงกว่าสำหรับ user ไกล, seek ยิง Range ใหม่ทุกครั้ง, spike origin รับเต็ม
- HLS cached: request เยอะกว่า Class B แพงนิด แต่ ~85% เสิร์ฟจาก edge เร็ว origin โหลดน้อย

**จุดที่เอียงไปทาง MP4:** library ~4,000 เรื่องเป็น long-tail — เรื่องคนดูน้อย cache ไม่ค่อย hit อยู่ดี
- content เย็น (ส่วนใหญ่) → direct MP4 ดีกว่า (cache ช่วยไม่ได้อยู่แล้ว)
- content ฮิต → HLS cache คุ้ม

**สรุป:** ถ้า user กระจุก region ใกล้ ๆ + รับ latency origin-direct ได้ → direct MP4 ถูกกว่า ง่ายกว่า / ถ้า global + ซีเรียส latency + spike → HLS คำถามตัดสินคือ "user อยู่ที่ไหน + ซีเรียส playback latency แค่ไหน"

---

## Turn 9

**User:** user หลักอยู่ที่ไทยกับลาวเท่านั้น

**Claude:**

ฟันธง: ใช้ direct MP4 ไปเลย ไม่ต้องทำ HLS — เพราะประโยชน์หลักของ HLS+cache คือ edge ใกล้ user ทั่วโลก แต่ user กระจุกโซนเดียว (SEA) ทุกคนใกล้ PoP กรุงเทพฯ อยู่แล้ว ไม่ต้องแลกความซับซ้อน + Class B แพงขึ้น

ข้อดี: ง่ายสุด (ไม่ต้องทำ pipeline), Class B ถูกสุด (~$0–15), egress ฟรี, long-tail 4,000 เรื่องไม่ต้องห่วง cache miss

**กุญแจ: ตั้ง location hint ของ bucket เป็น APAC** — ทดแทน edge cache สำหรับเคสนี้ ข้อมูลอยู่ใกล้ไทย/ลาว → uncached ก็ latency ต่ำ
- ⚠️ ตั้งได้ตอนสร้าง bucket เท่านั้น เปลี่ยนทีหลังไม่ได้

**Setup ทั้งหมด:**
1. สร้าง R2 bucket ด้วย location hint = APAC
2. Encode MP4 ด้วย `-movflags +faststart`
3. Upload พร้อม `Content-Type: video/mp4`
4. ผูก custom domain
5. `<video src="https://cdn.yourdomain.com/movie.mp4">` → Range request จัดการ seek อัตโนมัติ
6. (เสริม) ตั้ง Cache-Control — ไฟล์ 2GB ไม่ cache แต่ poster/thumbnail ไฟล์เล็กจะ cache ที่ edge

**ค่าใช้จ่าย:**
| รายการ | ต่อเดือน |
|---|---|
| Storage 8TB | $120 |
| Egress 2PB | $0 |
| Class B (direct MP4) | ~$0–15 |
| รวม | ~$120–135/เดือน |

หมายเหตุ: ถ้าวันหนึ่ง user มือถือในลาวเจอ buffer บ่อย ทางแก้คือเพิ่ม rendition bitrate ต่ำ แล้วค่อยขยับมาทำ HLS + ABR

---

## Turn 10

**User:** เขียนสรุปสิ่งที่ต้องทำให้หน่อย

**Claude:** [สร้างไฟล์ runbook `r2-video-streaming-setup.md` — checklist 6 ขั้นพร้อมคำสั่ง ffmpeg/rclone/aws cli, custom domain, ค่าใช้จ่ายคาดการณ์ ~$120–135/เดือน, แผนสำรอง HLS]

---

## สรุปข้อมูลหลักที่ใช้อ้างอิง (สำหรับ context ต่อ)

- **R2 pricing:** Storage Standard $0.015/GB-mo, Class A $4.50/M, Class B $0.36/M, **Egress ฟรี**, free tier 10GB + 1M Class A + 10M Class B
- **โจทย์:** 8TB storage (~4,000 เรื่อง), 2GB/เรื่อง, เรทเดียว ~2Mbps, ยาว 2–2.5 ชม., 10,000 users × 100 เรื่อง/เดือน = 1M views, egress ~2PB/เดือน
- **Cloudflare plan:** Pro (cache เพดาน 512MB/ไฟล์)
- **User:** ไทย + ลาว เท่านั้น
- **สถาปัตยกรรมที่เลือก:** Direct MP4 (ไม่ทำ HLS) + R2 bucket location hint APAC + custom domain
- **ค่าใช้จ่ายคาด:** ~$120–135/เดือน (เทียบ S3 ~$104,000/เดือน)
