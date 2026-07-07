// เกณฑ์เด้งถาม feedback — เก็บทุกอย่างใน localStorage ฝั่ง client ล้วน
// กติกา: ดูสะสม ≥30 นาที + ไม่เคยส่ง + ปัดไม่เกิน 2 ครั้ง (ปัดครั้งแรกเว้น 30 วัน)
// เทส local: localStorage.setItem('mdn_watch_sec', '9999') แล้ว reload หน้าแรก
// ponytail: per-device ไม่ sync ข้ามเครื่อง — ยอมรับ (อย่างแย่ user โดนถามซ้ำบนอีกเครื่อง
//   ซึ่ง backend มี unique index กันส่งซ้ำอยู่แล้ว)

const WATCH_KEY = 'mdn_watch_sec';
const STATE_KEY = 'mdn_feedback';

const MIN_WATCH_SECONDS = 10 * 60;
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DISMISS = 3;

interface FeedbackState {
  submitted?: boolean;
  dismissCount?: number;
  lastDismissedAt?: string; // ISO
}

// localStorage อาจ throw (private mode เก่า) — ทุกตัวเลยครอบ try/catch ให้เงียบ
function readState(): FeedbackState {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as FeedbackState;
  } catch {
    return {};
  }
}

function writeState(state: FeedbackState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // เงียบ — แค่ไม่จำสถานะ
  }
}

// เวลาดูสะสม (วินาที) — WatchPage บวกเพิ่มเรื่อย ๆ ระหว่างเล่น
export function getWatchSeconds(): number {
  try {
    const n = Number(localStorage.getItem(WATCH_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function addWatchSeconds(seconds: number): void {
  try {
    localStorage.setItem(WATCH_KEY, String(getWatchSeconds() + seconds));
  } catch {
    // เงียบ — แค่ไม่นับ
  }
}

// ควรเด้งถามไหม (HomePage เรียกตอน mount)
export function shouldAskFeedback(): boolean {
  if (getWatchSeconds() < MIN_WATCH_SECONDS) return false;
  const s = readState();
  if (s.submitted) return false;
  const dismissed = s.dismissCount ?? 0;
  if (dismissed >= MAX_DISMISS) return false;
  if (s.lastDismissedAt) {
    const t = new Date(s.lastDismissedAt).getTime();
    if (Number.isFinite(t) && Date.now() - t < DISMISS_COOLDOWN_MS) return false;
  }
  return true;
}

// กด "ไว้ทีหลัง"/ปิด modal
export function markDismissed(): void {
  const s = readState();
  writeState({
    ...s,
    dismissCount: (s.dismissCount ?? 0) + 1,
    lastDismissedAt: new Date().toISOString(),
  });
}

// ส่ง feedback สำเร็จ (หรือ server บอกว่าเคยส่งแล้ว) — ไม่ถามอีก
export function markSubmitted(): void {
  writeState({ ...readState(), submitted: true });
}
