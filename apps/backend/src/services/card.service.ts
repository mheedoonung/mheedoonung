// service ระบบบัตร: สร้าง/เติม/ลิสต์/ยกเลิกบัตร
// หมายเหตุ: _id ใน DB เป็น ObjectId; เวลาส่งออก API จะแปลงเป็น string เอง
import { ObjectId, type Collection } from 'mongodb';
import type {
  Card,
  CardStatus,
  User,
  CardListItem,
  CardListResponse,
  CardSummaryResponse,
} from '@mheedoonung/shared';
import { collections } from '../db/mongo';
import { generateCardCode, normalizeCardCode } from '../lib/crypto';
import { extendUserAccess } from '../lib/accessTime';

// 1 วัน = มิลลิวินาที (ใช้คำนวณ accessExpiresAt แบบสะสม)
const DAY_MS = 24 * 60 * 60 * 1000;

// จำนวนบัตรสูงสุดที่สร้างได้ต่อครั้ง (กันสร้างเยอะเกินจน loop ค้าง)
const MAX_QUANTITY = 1000;

// error code ของ redeem ที่ route จะ map เป็น HTTP status
// invalid_code -> 400 (ไม่พบบัตร), already_used -> 409, revoked -> 409
export type RedeemErrorCode = 'invalid_code' | 'already_used' | 'revoked';

// error เฉพาะของ redeem (route จะอ่าน .code ไป map เป็น status/ApiError)
export class RedeemError extends Error {
  readonly code: RedeemErrorCode;
  constructor(code: RedeemErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RedeemError';
    this.code = code;
  }
}

// error เฉพาะของ revoke (เฟสนี้ revoke ได้เฉพาะบัตร unused)
// invalid_code -> 404 (ไม่พบบัตร), not_revocable -> 409 (redeemed/revoked แล้ว)
export type RevokeErrorCode = 'invalid_code' | 'not_revocable';

export class RevokeError extends Error {
  readonly code: RevokeErrorCode;
  constructor(code: RevokeErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RevokeError';
    this.code = code;
  }
}

// ตรวจว่า error เป็น duplicate key (E11000) จาก unique index หรือไม่
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// สร้างบัตรใหม่ตามจำนวนที่ขอ — คืน codes[] ที่สร้างได้
// retry ทีละใบถ้าชน unique index (code ซ้ำ) จนกว่าจะ insert สำเร็จ
export async function createCards(
  body: { days: number; quantity: number; note?: string },
  createdBy: string,
): Promise<string[]> {
  const days = Math.floor(body.days);
  const quantity = Math.floor(body.quantity);

  // validate ค่าพื้นฐาน (route ก็ validate ด้วย TypeBox แต่กันไว้อีกชั้น)
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('days ต้องเป็นจำนวนเต็มบวก');
  }
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
    throw new Error(`quantity ต้องอยู่ในช่วง 1-${MAX_QUANTITY}`);
  }

  const cards = collections.cards;
  const createdAt = new Date().toISOString();
  const codes: string[] = [];

  // insert ทีละใบ + retry ถ้าชน unique index (โอกาสชนต่ำมากแต่กันไว้)
  for (let i = 0; i < quantity; i++) {
    let inserted = false;
    // retry สูงสุด 5 ครั้งต่อใบ (ถ้าชนซ้ำ ๆ ถือว่าผิดปกติ)
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const code = generateCardCode();
      const doc: Omit<Card, '_id'> = {
        code,
        days,
        status: 'unused',
        redeemedByUserId: null,
        redeemedAt: null,
        expiresAt: null,
        createdBy,
        createdAt,
      };
      // ใส่ note เฉพาะเมื่อมีค่า (กันเขียน undefined/null ลง DB ทั้งที่ type เป็น optional)
      if (body.note !== undefined) {
        doc.note = body.note;
      }
      try {
        await cards.insertOne(doc);
        codes.push(code);
        inserted = true;
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // code ชน — สุ่มใหม่แล้วลองอีกครั้ง
          continue;
        }
        throw err;
      }
    }
    if (!inserted) {
      throw new Error('ไม่สามารถสร้างรหัสบัตรที่ไม่ซ้ำได้ (retry หมด)');
    }
  }

  return codes;
}

// เติมบัตรให้ user — ต้อง atomic เพื่อกัน race
//  - กัน race สอง request redeem code "เดียวกัน" พร้อมกัน (ขั้น 1)
//  - กัน lost-update เมื่อ user "เดียวกัน" redeem คนละ code พร้อมกัน (ขั้น 3)
// ขั้นตอน:
//  1) findOneAndUpdate cards {code, status:'unused'} -> set redeemed (ผู้ชนะมีคนเดียว)
//  2) ถ้าไม่ได้ doc กลับมา -> หาเหตุผล (ไม่มี/ใช้แล้ว/ถูกยกเลิก) แล้ว throw RedeemError
//  3) สะสม user.accessExpiresAt = max(now, เดิม) + days*DAY_MS แบบ atomic ฝั่ง DB
//     (อ่านฐานจาก '$accessExpiresAt' ใน DB ผ่าน pipeline ไม่ใช่จาก snapshot ของ session)
export async function redeemCard(
  code: string,
  user: User,
): Promise<{ accessExpiresAt: string; daysAdded: number }> {
  const normalized = normalizeCardCode(code);
  const cards = collections.cards;
  const nowMs = Date.now();
  const redeemedAtIso = new Date(nowMs).toISOString();

  // user._id มาจาก session (ถูกแปลงเป็น string แล้ว) — ใช้เป็น redeemedByUserId
  const userId = user._id;
  if (!userId) {
    // กันกรณีผิดปกติ (user ไม่มี _id)
    throw new Error('user ไม่มี _id');
  }

  // expiresAt ของ "บัตร" = เวลาที่เติม + days (อายุของบัตรใบนั้น ๆ)
  // ส่วน accessExpiresAt ของ user คำนวณแบบสะสมในขั้นถัดไป
  // หมายเหตุ: ยังไม่รู้ days จนกว่าจะอ่านบัตร — จึงใช้ aggregation pipeline update
  //          เพื่อให้ set redeemedAt และ expiresAt(=now+days) ใน operation เดียวแบบ atomic
  const result = await cards.findOneAndUpdate(
    { code: normalized, status: 'unused' as CardStatus },
    [
      {
        $set: {
          status: 'redeemed',
          redeemedByUserId: userId,
          redeemedAt: redeemedAtIso,
          // expiresAt = now + days*DAY_MS แปลงเป็น ISO string
          // ($add คิดเป็น ms epoch แล้ว $toDate -> $toString เป็น ISO)
          expiresAt: {
            $toString: {
              $toDate: { $add: [nowMs, { $multiply: ['$days', DAY_MS] }] },
            },
          },
        },
      },
    ],
    { returnDocument: 'after' },
  );

  // ไม่เจอ doc ที่ update ได้ -> แยกเหตุผลว่าเพราะอะไร
  if (!result) {
    const existing = await cards.findOne({ code: normalized });
    if (!existing) {
      throw new RedeemError('invalid_code', 'ไม่พบรหัสบัตรนี้');
    }
    if (existing.status === 'redeemed') {
      throw new RedeemError('already_used', 'บัตรนี้ถูกใช้ไปแล้ว');
    }
    if (existing.status === 'revoked') {
      throw new RedeemError('revoked', 'บัตรนี้ถูกยกเลิกแล้ว');
    }
    // เหตุอื่น (เช่นถูก redeem ไปพร้อมกันโดย request อื่น) ถือว่าใช้แล้ว
    throw new RedeemError('already_used', 'บัตรนี้ถูกใช้ไปแล้ว');
  }

  const daysAdded = result.days;

  // ---- สะสม accessExpiresAt ของ user แบบ atomic ฝั่ง DB (ดู lib/accessTime) ----
  // ห้ามอ่านค่า user.accessExpiresAt จาก session (snapshot/stale) มาคำนวณแล้ว $set ทับ
  // เพราะถ้า user เดียวกัน redeem สองใบพร้อมกัน ทั้งคู่จะอ่านฐานเดิมเท่ากันแล้วเขียนทับกัน
  // (lost update) -> วันของบัตรใบหนึ่งหายไป ทั้งที่บัตรถูก mark redeemed ไปแล้ว
  const addedMs = daysAdded * DAY_MS;
  const accessExpiresAt = await extendUserAccess({ _id: new ObjectId(userId) }, addedMs);

  // ไม่ควรเป็น null (user มีอยู่จริงแน่ ๆ จาก session) — เผื่อไว้กันพัง
  if (!accessExpiresAt) {
    throw new Error('redeem_update_user_failed');
  }

  return { accessExpiresAt, daysAdded };
}

// แปลง doc บัตรจาก DB (_id เป็น ObjectId) -> CardListItem (id เป็น string)
function toCardListItem(doc: Card & { _id?: ObjectId | string }): CardListItem {
  const rawId: unknown = doc._id;
  const id = rawId instanceof ObjectId ? rawId.toHexString() : String(rawId ?? '');
  return {
    id,
    code: doc.code,
    days: doc.days,
    status: doc.status,
    note: doc.note,
    redeemedByUserId: doc.redeemedByUserId ?? null,
    redeemedAt: doc.redeemedAt ?? null,
    expiresAt: doc.expiresAt ?? null,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
  };
}

// ลิสต์บัตร (กรอง status ได้ + แบ่งหน้า) — เรียงใหม่สุดก่อน (createdAt มากไปน้อย)
export async function listCards(query: {
  status?: CardStatus;
  page?: number;
  limit?: number;
}): Promise<CardListResponse> {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 50)), 200);
  const skip = (page - 1) * limit;

  const filter: { status?: CardStatus } = {};
  if (query.status) filter.status = query.status;

  const cards = collections.cards as unknown as Collection<Card>;

  const [docs, total] = await Promise.all([
    cards
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    cards.countDocuments(filter),
  ]);

  return {
    items: docs.map((d) => toCardListItem(d as Card & { _id?: ObjectId | string })),
    total,
    page,
    limit,
  };
}

// สรุปยอดบัตรตามช่วงเวลา (อิง createdAt ที่เป็น ISO string -> เทียบ string ได้ตรง ๆ)
//   นับ "บัตรที่สร้าง" ในช่วง แยกตามสถานะ + รวมจำนวนวัน
export async function summarizeCards(query: {
  from?: string;
  to?: string;
}): Promise<CardSummaryResponse> {
  const range: Record<string, string> = {};
  if (query.from) range.$gte = query.from;
  if (query.to) range.$lte = query.to;
  const match = Object.keys(range).length ? { createdAt: range } : {};

  const rows = await collections.cards
    .aggregate<{ _id: CardStatus; count: number; days: number }>([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 }, days: { $sum: '$days' } } },
    ])
    .toArray();

  // เติมให้ครบทุกสถานะ (รวม 0) เพื่อ UI แสดงคงที่
  const STATUSES: CardStatus[] = ['unused', 'redeemed', 'revoked'];
  const byStatus = STATUSES.map((status) => {
    const r = rows.find((x) => x._id === status);
    return { status, count: r?.count ?? 0, days: r?.days ?? 0 };
  });

  return {
    from: query.from ?? null,
    to: query.to ?? null,
    total: byStatus.reduce((n, s) => n + s.count, 0),
    totalDays: byStatus.reduce((n, s) => n + s.days, 0),
    byStatus,
  };
}

// ยกเลิกบัตร — เฟสนี้ยกเลิกได้เฉพาะบัตรที่ยัง 'unused' (atomic กัน race กับ redeem)
//  - ถ้า update สำเร็จ -> ok
//  - ถ้าไม่สำเร็จ -> หาเหตุ: ไม่พบ (404) / redeemed-revoked แล้ว (409)
export async function revokeCard(code: string): Promise<{ ok: true }> {
  const normalized = normalizeCardCode(code);
  const cards = collections.cards;

  const result = await cards.findOneAndUpdate(
    { code: normalized, status: 'unused' as CardStatus },
    { $set: { status: 'revoked' as CardStatus } },
    { returnDocument: 'after' },
  );

  if (!result) {
    const existing = await cards.findOne({ code: normalized });
    if (!existing) {
      throw new RevokeError('invalid_code', 'ไม่พบรหัสบัตรนี้');
    }
    // redeemed หรือ revoked แล้ว -> ยกเลิกไม่ได้ในเฟสนี้
    throw new RevokeError('not_revocable', 'ยกเลิกได้เฉพาะบัตรที่ยังไม่ถูกใช้');
  }

  return { ok: true };
}
