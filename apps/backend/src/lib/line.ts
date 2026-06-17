// ฟังก์ชันที่เกี่ยวกับ LINE Login: verify id_token, แลก code -> token, และ upsert user
// สำคัญ: aud ของ id_token ต้องเท่ากับ LINE_CHANNEL_ID เสมอ (ห้ามเชื่อ client)
import { ObjectId } from 'mongodb';
import type { User } from '@mheedoonung/shared';
import { env } from '../config/env';
import { collections } from '../db/mongo';

// endpoint ของ LINE (คงที่ตามเอกสาร LINE Login v2.1)
const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

// โปรไฟล์ที่ดึงได้จาก id_token ของ LINE (เฉพาะ field ที่เราใช้)
export interface LineProfile {
  userId: string; // มาจาก sub
  displayName: string; // มาจาก name
  pictureUrl?: string; // มาจาก picture
}

// payload ที่ LINE คืนกลับจาก endpoint /verify (เฉพาะ field ที่สนใจ)
interface LineVerifyResponse {
  iss?: string;
  sub?: string; // line user id
  aud?: string; // ต้องเท่ากับ channel id ของเรา
  exp?: number; // unix seconds
  name?: string;
  picture?: string;
  // กรณี error LINE จะส่ง field เหล่านี้
  error?: string;
  error_description?: string;
}

// payload ที่ LINE คืนกลับจาก endpoint /token
interface LineTokenResponse {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

// สร้าง URL สำหรับ redirect ผู้ใช้ไปหน้า authorize ของ LINE (web OAuth)
// scope = profile openid (ต้องมี openid เพื่อให้ได้ id_token)
export function buildLineAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINE_CHANNEL_ID,
    redirect_uri: env.LINE_LOGIN_REDIRECT_URI,
    state,
    scope: 'profile openid',
  });
  return `${LINE_AUTHORIZE_URL}?${params.toString()}`;
}

// ตรวจสอบ id_token ของ LINE ผ่าน endpoint /verify
// LINE จะตรวจลายเซ็น/iss/exp ให้ และคืน claim กลับมา เราตรวจ aud + exp ซ้ำอีกชั้น
export async function verifyLineIdToken(idToken: string): Promise<LineProfile> {
  // ส่งแบบ x-www-form-urlencoded: id_token + client_id (= channel id ของเรา)
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: env.LINE_CHANNEL_ID,
  });

  const res = await fetch(LINE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json()) as LineVerifyResponse;

  // ถ้า HTTP ไม่ ok หรือ LINE ส่ง error กลับมา -> token ไม่ถูกต้อง
  if (!res.ok || data.error) {
    throw new Error(`line_verify_failed: ${data.error ?? res.status}`);
  }

  // ตรวจ aud ต้องตรงกับ channel id ของเราเสมอ (กันโทเค็นที่ออกให้ channel อื่น)
  if (data.aud !== env.LINE_CHANNEL_ID) {
    throw new Error('line_aud_mismatch');
  }

  // ตรวจ exp ไม่หมดอายุ (exp เป็น unix seconds)
  if (typeof data.exp !== 'number' || data.exp * 1000 <= Date.now()) {
    throw new Error('line_token_expired');
  }

  // ต้องมี sub (line user id) ถึงจะใช้ระบุตัวตนได้
  if (!data.sub) {
    throw new Error('line_token_no_sub');
  }

  return {
    userId: data.sub,
    // ถ้าไม่มี name (เช่น ผู้ใช้ไม่ได้ให้ scope profile) ใช้ค่า fallback
    displayName: data.name ?? 'LINE User',
    pictureUrl: data.picture,
  };
}

// แลก authorization code -> tokens (ใช้ใน web OAuth callback)
export async function exchangeCodeForTokens(
  code: string,
): Promise<{ idToken: string; accessToken: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.LINE_LOGIN_REDIRECT_URI,
    client_id: env.LINE_CHANNEL_ID,
    client_secret: env.LINE_CHANNEL_SECRET,
  });

  const res = await fetch(LINE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json()) as LineTokenResponse;

  if (!res.ok || data.error || !data.id_token || !data.access_token) {
    throw new Error(`line_token_exchange_failed: ${data.error ?? res.status}`);
  }

  return { idToken: data.id_token, accessToken: data.access_token };
}

// upsert user จากโปรไฟล์ LINE: หาโดย lineUserId
// - ถ้ามีอยู่แล้ว: อัปเดต displayName/pictureUrl/updatedAt
// - ถ้าเพิ่งสร้าง: ตั้ง createdAt + accessExpiresAt = null (ยังไม่เคย active)
// คืน User (พร้อม _id เป็น string)
export async function upsertUserFromLine(profile: LineProfile): Promise<User> {
  const now = new Date().toISOString();

  // ประกอบ $set โดยใส่ pictureUrl เฉพาะเมื่อมีค่า (กันเขียน undefined ลง DB)
  const setFields: Record<string, unknown> = {
    displayName: profile.displayName,
    updatedAt: now,
  };
  if (profile.pictureUrl !== undefined) {
    setFields.pictureUrl = profile.pictureUrl;
  }

  const result = await collections.users.findOneAndUpdate(
    { lineUserId: profile.userId },
    {
      $set: setFields,
      $setOnInsert: {
        lineUserId: profile.userId,
        accessExpiresAt: null,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  // หลัง upsert ด้วย returnDocument:'after' ควรได้ doc กลับมาเสมอ
  if (!result) {
    throw new Error('upsert_user_failed');
  }

  // แปลง _id (ObjectId) -> string ก่อนส่งคืน (เทียบกับ shared type ที่ใช้ string)
  const { _id, ...rest } = result as typeof result & { _id: ObjectId };
  return {
    _id: _id instanceof ObjectId ? _id.toHexString() : String(_id),
    ...rest,
  } as User;
}
