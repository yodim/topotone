/**
 * A stand-in drawing for Phase 0: a sky and three bands of hills drifting left at
 * different speeds. Phase 1 replaces it with the real engine and the debug style.
 */
import type { DrawFn } from './engine';

const BANDS = [
  { base: 0.55, amp: 0.08, speed: 12, freq: 0.006, color: '#aab4c0' },
  { base: 0.68, amp: 0.07, speed: 30, freq: 0.009, color: '#6f7f8f' },
  { base: 0.82, amp: 0.05, speed: 70, freq: 0.014, color: '#3d4a57' },
];

export const drawPlaceholder: DrawFn = (ctx, { surface, time }) => {
  const w = surface.cssWidth;
  const h = surface.cssHeight;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#e9e4d8');
  sky.addColorStop(1, '#f6f3ec');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  for (const band of BANDS) {
    const shift = time * band.speed;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 8; x += 8) {
      const u = (x + shift) * band.freq;
      const y = h * (band.base - band.amp * (Math.sin(u) * 0.6 + Math.sin(u * 2.3 + 1.7) * 0.4));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = band.color;
    ctx.fill();
  }

  ctx.fillStyle = '#3d4a57';
  ctx.font = '500 14px system-ui, sans-serif';
  ctx.fillText('Topotone', 16, 28);
};
