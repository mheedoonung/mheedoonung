// เทส logic คัดหนังแนะนำ (pickSuggestions เป็น pure function — สุ่มลำดับแต่คุณสมบัติต้องคงที่)
import { describe, expect, test } from 'bun:test';
import type { PublicMovie } from '@mheedoonung/shared';
import { pickSuggestions } from './suggest';

function movie(slug: string, genres: string[]): PublicMovie {
  return {
    id: slug,
    slug,
    title: slug,
    synopsis: '',
    durationSec: 100,
    genres,
    posterUrl: '',
    featured: false,
    viewCount: 0,
  };
}

const CATALOG = [
  movie('a1', ['ดราม่า']),
  movie('a2', ['ดราม่า']),
  movie('a3', ['ดราม่า', 'โรแมนติก']),
  movie('b1', ['แอคชั่น']),
  movie('b2', ['แอคชั่น']),
  movie('b3', ['สยองขวัญ']),
  movie('b4', ['คอเมดี้']),
  movie('current', ['ดราม่า']),
];

describe('pickSuggestions', () => {
  test('ไม่มีเรื่องปัจจุบันปนมา + จำนวนไม่เกินที่ขอ', () => {
    for (let i = 0; i < 20; i++) {
      const picked = pickSuggestions(CATALOG, 'current', ['ดราม่า'], [], 6);
      expect(picked.length).toBe(6);
      expect(picked.some((m) => m.slug === 'current')).toBe(false);
    }
  });

  test('ตัดเรื่องที่เพิ่งดูออกเมื่อ pool ใหญ่พอ', () => {
    for (let i = 0; i < 20; i++) {
      const picked = pickSuggestions(CATALOG, 'current', ['ดราม่า'], ['a1', 'b1'], 5);
      expect(picked.some((m) => m.slug === 'a1' || m.slug === 'b1')).toBe(false);
    }
  });

  test('pool เล็ก (ดูมาแล้วเกือบหมด) ยอมเติมเรื่องที่เคยดูกลับ — ไม่คืน list โหรงเหรง', () => {
    const recent = ['a1', 'a2', 'a3', 'b1', 'b2'];
    const picked = pickSuggestions(CATALOG, 'current', ['ดราม่า'], recent, 6);
    expect(picked.length).toBe(6); // fresh มีแค่ 2 (b3,b4) ต้องเติมกลับจนครบ
  });

  test('แนวเดียวกันต้องนำหน้า (ตัวแรกเป็นแนวเดียวกันเสมอเมื่อมีให้เลือก)', () => {
    for (let i = 0; i < 20; i++) {
      const picked = pickSuggestions(CATALOG, 'current', ['ดราม่า'], [], 6);
      expect(picked[0]!.genres).toContain('ดราม่า');
    }
  });

  test('ผลไม่ใช่ลำดับเดิมตายตัว (มีการสุ่มจริง)', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 30; i++) {
      orders.add(
        pickSuggestions(CATALOG, 'current', ['ดราม่า'], [], 6)
          .map((m) => m.slug)
          .join(','),
      );
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});
