import { describe, expect, it } from 'vitest';
import { CHUNK_SECONDS, LAYERS, chunkIndexAt, chunkStart } from '../src/world/scene';

describe('LAYERS', () => {
  it('is ordered far to near, within 0..1', () => {
    const depths = LAYERS.map((l) => l.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    for (const d of depths) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('has one entry per role', () => {
    const roles = LAYERS.map((l) => l.role);
    expect(new Set(roles).size).toBe(roles.length);
  });
});

describe('chunk indexing', () => {
  it('maps music time to the chunk that contains it', () => {
    expect(chunkIndexAt(0)).toBe(0);
    expect(chunkIndexAt(CHUNK_SECONDS - 0.001)).toBe(0);
    expect(chunkIndexAt(CHUNK_SECONDS)).toBe(1);
    expect(chunkIndexAt(-0.001)).toBe(-1);
  });

  it('round-trips through chunkStart', () => {
    for (const i of [-3, 0, 1, 250]) {
      expect(chunkIndexAt(chunkStart(i))).toBe(i);
    }
  });
});
