// fetch wrapper สำหรับเรียก backend API
// - base URL อ่านจาก VITE_API_URL
// - credentials: 'include' เสมอ (ให้ส่ง/รับ cookie session)
// - คืน JSON ที่ parse แล้ว; ถ้า response ไม่ ok -> โยน ApiClientError ที่ถือ ApiError ไว้
import type { ApiError } from '@mheedoonung/shared';

// base URL ของ backend (ตัด trailing slash ออกกันพลาด)
const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

// error ที่โยนเมื่อ API ตอบกลับไม่สำเร็จ — เก็บ status + payload (ApiError) ไว้ให้ UI อ่าน
export class ApiClientError extends Error {
  readonly status: number;
  readonly payload: ApiError;

  constructor(status: number, payload: ApiError) {
    super(payload.message ?? payload.error ?? `HTTP ${status}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.payload = payload;
  }
}

// option เสริมของ request (นอกเหนือจาก fetch ปกติ) — body ถ้าเป็น object จะถูก JSON.stringify ให้
interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

// แกนกลางของการเรียก API — ประกอบ URL, ใส่ header/credentials, จัดการ error/JSON
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;

  // ประกอบ header — ใส่ Content-Type เฉพาะตอนมี body ที่ต้อง stringify
  const finalHeaders: Record<string, string> = { ...(headers as Record<string, string> | undefined) };
  let finalBody: BodyInit | undefined;
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: finalBody,
    // ส่ง cookie ข้าม origin เสมอ (session ของเราเป็น cookie)
    credentials: 'include',
  });

  // พยายาม parse JSON (บาง response อาจว่าง เช่น 204)
  const text = await res.text();
  const data: unknown = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    // map เป็น ApiError ให้ UI อ่าน (ถ้า body ไม่ใช่รูป ApiError ก็สร้างขึ้นเอง)
    const payload: ApiError =
      isApiError(data) ? data : { error: 'request_failed', message: `HTTP ${res.status}` };
    throw new ApiClientError(res.status, payload);
  }

  return data as T;
}

// parse JSON แบบไม่โยน (คืน null ถ้าพัง)
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// type guard: เช็คว่า value มีรูปร่างเป็น ApiError ไหม
function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  );
}

// API client — helper ตาม HTTP method ที่ใช้บ่อย
export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'POST', body }),
  // เปิดเผย base URL ไว้ให้ส่วนที่ต้อง redirect ตรง ๆ (เช่น web OAuth) ใช้
  baseUrl: API_BASE,
};
