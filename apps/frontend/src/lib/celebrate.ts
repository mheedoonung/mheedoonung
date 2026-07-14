// พลุฉลอง — ยิงจากซ้าย+ขวาสวนเข้ากลางสั้น ๆ (canvas วาดบน body เอง อยู่ต่อได้แม้ปิด modal ที่เรียก)
// ใช้ร่วมกันตอนได้ของดี: เติมบัตรสำเร็จ (RedeemModal) / ได้รางวัล feedback (FeedbackModal)
import confetti from 'canvas-confetti';

export function celebrate(): void {
  const colors = ['#f94144', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#577590', '#e56399'];
  const end = Date.now() + 700;
  confetti({ particleCount: 80, spread: 80, startVelocity: 45, origin: { y: 0.7 }, colors });
  (function frame() {
    confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors });
    confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}
