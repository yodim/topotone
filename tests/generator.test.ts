import { describe, expect, it } from 'vitest';
import { SyntheticSource } from '../src/audio/sources/synthetic';
import { World } from '../src/world/generator';
import { CHUNK_SECONDS, LAYERS, RIDGE_SAMPLES, type LayerChunk } from '../src/world/scene';

const world = (seed: number) => new World(seed, new SyntheticSource(seed, () => 0));

/** FNV-1a over everything a chunk holds. */
function hashChunks(chunks: LayerChunk[]): string {
  let h = 0x811c9dc5;
  const eat = (bytes: Uint8Array) => {
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  };
  const text = new TextEncoder();
  for (const c of chunks) {
    eat(text.encode(`${c.role}|${c.index}|${c.seed}|${c.depth}`));
    eat(new Uint8Array(c.ridge.buffer, c.ridge.byteOffset, c.ridge.byteLength));
    eat(text.encode(JSON.stringify(c.objects)));
    eat(text.encode(JSON.stringify(c.water)));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** All chunks of the first 60 seconds, every layer. */
function firstMinute(w: World): LayerChunk[] {
  const count = 60 / CHUNK_SECONDS;
  return LAYERS.flatMap((_, layer) => Array.from({ length: count }, (_, i) => w.chunk(layer, i)));
}

describe('World', () => {
  it('builds the same first minute for the same seed', () => {
    expect(hashChunks(firstMinute(world(1)))).toBe(hashChunks(firstMinute(world(1))));
  });

  it('builds the same chunks whatever order they are asked in', () => {
    const forward = world(2);
    const backward = world(2);
    const a = [0, 1, 2, 3, 4, 5].map((i) => forward.chunk(3, i));
    const b = [5, 4, 3, 2, 1, 0].map((i) => backward.chunk(3, i)).reverse();
    expect(hashChunks(a)).toBe(hashChunks(b));
  });

  it('builds a different world for a different seed', () => {
    expect(hashChunks(firstMinute(world(1)))).not.toBe(hashChunks(firstMinute(world(2))));
  });

  it('keeps the first minute of seed 1 stable', () => {
    // Update on purpose (vitest -u) when the mapping or the synthetic source changes.
    expect(hashChunks(firstMinute(world(1)))).toMatchInlineSnapshot(`"bdaed8e6"`);
  });

  it('has no seams: neighboring chunks share their edge sample exactly', () => {
    const w = world(3);
    for (let layer = 0; layer < LAYERS.length; layer++) {
      for (let i = -5; i < 20; i++) {
        const a = w.chunk(layer, i);
        const b = w.chunk(layer, i + 1);
        expect(a.ridge.length).toBe(RIDGE_SAMPLES + 1);
        expect(a.ridge[RIDGE_SAMPLES]).toBe(b.ridge[0]);
      }
    }
  });

  it('gives every object and water cell to exactly one chunk', () => {
    const w = world(4);
    for (let layer = 0; layer < LAYERS.length; layer++) {
      const seen = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const c = w.chunk(layer, i);
        const t0 = i * CHUNK_SECONDS;
        for (const o of c.objects) {
          expect(o.t).toBeGreaterThanOrEqual(t0);
          expect(o.t).toBeLessThan(t0 + CHUNK_SECONDS);
          const key = `${o.kind}@${o.t}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
        for (const s of c.water) {
          expect(s.t0).toBeGreaterThanOrEqual(t0);
          expect(s.t0).toBeLessThan(t0 + CHUNK_SECONDS);
        }
      }
    }
  });

  it('produces a varied world from the synthetic source', () => {
    // One world for every chunk: a fresh world per chunk would rebuild its features each time.
    const w = world(1);
    const chunks = firstMinute(w).concat(
      LAYERS.flatMap((_, l) => Array.from({ length: 60 }, (_, i) => w.chunk(l, i + 15))),
    );
    const kinds = new Set(chunks.flatMap((c) => c.objects.map((o) => o.kind)));
    expect(kinds).toContain('grass');
    expect(kinds).toContain('tree');
    for (const c of chunks) {
      for (const h of c.ridge) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps sky values in range and changes them smoothly', () => {
    const w = world(5);
    let prev = w.skyAt(-20);
    for (let t = -20; t < 120; t += 0.05) {
      const s = w.skyAt(t);
      for (const v of Object.values(s)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(s.mood - prev.mood)).toBeLessThan(0.05);
      prev = s;
    }
  });

  it('evicts chunks outside the retained range', () => {
    const w = world(6);
    for (let i = 0; i < 10; i++) w.chunk(0, i);
    w.retain(0, 4, 6);
    expect(w.stats().chunks).toBe(3);
  });
});
