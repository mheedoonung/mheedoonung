// เลือกหนังแนะนำสำหรับ end screen — แก้ปัญหา "ขึ้นแต่เรื่องเดิม"
// กติกา: ตัดเรื่องปัจจุบัน + เรื่องที่เพิ่งดูไป (จำ 20 เรื่องล่าสุดใน localStorage)
//        แนวเดียวกันขึ้นก่อน (สูงสุด 4) ที่เหลือเติมจากเรื่องอื่น แล้วสุ่มลำดับภายในกลุ่ม
//        pool ไม่พอ (catalog เล็ก) ค่อยยอมเติมเรื่องที่เคยดูกลับมา
import type { PublicMovie } from '@mheedoonung/shared';

const RECENT_KEY = 'mdn_recent_watched';
const RECENT_MAX = 20;
const RELATED_SLOTS = 4;

export function recentWatched(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

// บันทึกว่าเพิ่งดูเรื่องนี้ (ล่าสุดอยู่หน้าสุด, กันซ้ำ, เก็บไม่เกิน RECENT_MAX)
export function markWatched(slug: string): void {
  try {
    const list = [slug, ...recentWatched().filter((s) => s !== slug)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // เงียบ — แค่ความจำการแนะนำ
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// เลือก count เรื่องจาก candidates
export function pickSuggestions(
  candidates: PublicMovie[],
  currentSlug: string,
  currentGenres: string[],
  recentSlugs: string[],
  count: number,
): PublicMovie[] {
  const seen = new Set(recentSlugs);
  const pool = candidates.filter((m) => m.slug !== currentSlug);
  const fresh = pool.filter((m) => !seen.has(m.slug));
  // ตัดเรื่องที่ดูแล้วออกก่อน — เหลือไม่พอค่อยเติมเรื่องที่เคยดูกลับ (catalog เล็กช่วงแรก)
  const usable = fresh.length >= count ? fresh : [...fresh, ...pool.filter((m) => seen.has(m.slug))];

  const genreSet = new Set(currentGenres);
  const related = usable.filter((m) => m.genres.some((g) => genreSet.has(g)));
  const others = usable.filter((m) => !m.genres.some((g) => genreSet.has(g)));

  // แนวเดียวกันนำ (สุ่มภายในกลุ่ม สูงสุด RELATED_SLOTS) แล้วเติมด้วยเรื่องอื่นสุ่ม
  const picked = [...shuffle(related).slice(0, RELATED_SLOTS), ...shuffle(others)];
  // ยังไม่ครบ (related เกิน slot แต่ others น้อย) เติม related ที่เหลือ
  if (picked.length < count) {
    const usedSlugs = new Set(picked.map((m) => m.slug));
    picked.push(...related.filter((m) => !usedSlugs.has(m.slug)));
  }
  return picked.slice(0, count);
}
