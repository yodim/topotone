/**
 * Feature meters, toggled with D: one bar per feature, flashes for onsets per band,
 * and the frame rate. Drawn by the app on top of the style, never part of the world.
 */
import type { FeatureFrame, FeatureSource } from '../audio/features';

const BARS: { label: string; value: (f: FeatureFrame) => number }[] = [
  { label: 'rms', value: (f) => f.rms },
  { label: 'low', value: (f) => f.low },
  { label: 'mid', value: (f) => f.mid },
  { label: 'high', value: (f) => f.high },
  { label: 'centroid', value: (f) => f.centroid },
  { label: 'flux', value: (f) => f.flux },
  { label: 'pitch', value: (f) => f.pitch ?? 0 },
  { label: 'confidence', value: (f) => f.pitchConfidence },
];

const ONSETS: { label: string; value: (f: FeatureFrame) => number }[] = [
  { label: 'L', value: (f) => f.onsetLow },
  { label: 'M', value: (f) => f.onsetMid },
  { label: 'H', value: (f) => f.onsetHigh },
];

export class Meters {
  visible = false;
  fps = 0;
  private latest: FeatureFrame | null = null;
  private lastNow: number | null = null;
  private readonly flashes = [0, 0, 0];

  constructor(
    private readonly source: FeatureSource,
    public seed: number,
  ) {}

  toggle(): void {
    this.visible = !this.visible;
  }

  /** Reads the frames since the previous call, so no onset is missed at high speeds. */
  update(now: number, dt: number): void {
    if (dt > 0) this.fps = this.fps === 0 ? 1 / dt : this.fps * 0.95 + (1 / dt) * 0.05;
    for (let i = 0; i < this.flashes.length; i++) {
      this.flashes[i] = Math.max(0, (this.flashes[i] ?? 0) - dt * 4);
    }
    if (!this.visible) {
      this.lastNow = now;
      return;
    }
    const from = this.lastNow !== null && this.lastNow < now ? this.lastNow : now - 0.05;
    this.lastNow = now;
    const frames = this.source.frames(from, now);
    for (const f of frames) {
      ONSETS.forEach((o, i) => {
        this.flashes[i] = Math.max(this.flashes[i] ?? 0, o.value(f));
      });
    }
    this.latest = frames[frames.length - 1] ?? this.latest;
  }

  /** A thin red line where the playhead is: what is heard right now. */
  drawPlayhead(ctx: CanvasRenderingContext2D, x: number, height: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(198, 40, 40, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 28);
    ctx.lineTo(Math.round(x) + 0.5, height);
    ctx.stroke();
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, height: number): void {
    const pad = 12;
    const rowH = 16;
    const barW = 140;
    const panelW = 250;
    const panelH = pad * 2 + rowH * (BARS.length + 2);
    const x0 = pad;
    const y0 = height - panelH - pad;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillRect(x0, y0, panelW, panelH);
    ctx.font = '11px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    let y = y0 + pad + rowH / 2;
    ctx.fillStyle = '#222';
    ctx.fillText(`${this.fps.toFixed(0)} fps  seed ${this.seed}`, x0 + pad, y);
    y += rowH;

    const f = this.latest;
    for (const bar of BARS) {
      const v = f ? bar.value(f) : 0;
      ctx.fillStyle = '#222';
      ctx.fillText(bar.label, x0 + pad, y);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.fillRect(x0 + 90, y - 4, barW, 8);
      ctx.fillStyle = bar.label === 'pitch' && f?.pitch === null ? 'rgba(0,0,0,0.15)' : '#3d6fb4';
      ctx.fillRect(x0 + 90, y - 4, barW * Math.min(1, Math.max(0, v)), 8);
      y += rowH;
    }

    ctx.fillStyle = '#222';
    ctx.fillText('onsets', x0 + pad, y);
    ONSETS.forEach((o, i) => {
      const cx = x0 + 100 + i * 34;
      ctx.fillStyle = `rgba(214, 69, 65, ${0.12 + 0.88 * (this.flashes[i] ?? 0)})`;
      ctx.beginPath();
      ctx.arc(cx, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.fillText(o.label, cx + 9, y);
    });
    ctx.restore();
  }
}
