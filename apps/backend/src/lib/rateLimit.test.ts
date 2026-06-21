import { expect, test } from 'bun:test';
import { rateLimit } from './rateLimit';

test('บล็อกเมื่อเกิน max ภายใน window', () => {
  const k = 'unit:block';
  for (let i = 0; i < 3; i++) expect(rateLimit(k, 3, 60_000)).toBe(true);
  expect(rateLimit(k, 3, 60_000)).toBe(false); // ครั้งที่ 4 เกินโควตา
});

test('รีเซ็ตหลัง window หมด', async () => {
  const k = 'unit:reset';
  expect(rateLimit(k, 1, 2)).toBe(true);
  expect(rateLimit(k, 1, 2)).toBe(false);
  await Bun.sleep(5);
  expect(rateLimit(k, 1, 2)).toBe(true);
});
