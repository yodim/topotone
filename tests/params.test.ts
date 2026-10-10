import { describe, expect, it } from 'vitest';
import { MAX_SPEED, parseParams, seedFromText } from '../src/app/params';

describe('parseParams', () => {
  it('reads seed, style and speed', () => {
    expect(parseParams('?seed=river&style=ink&speed=2.5')).toEqual({
      seedText: 'river',
      style: 'ink',
      speed: 2.5,
    });
  });

  it('falls back to defaults', () => {
    expect(parseParams('')).toEqual({ seedText: null, style: null, speed: 1 });
    expect(parseParams('?seed=&speed=fast').speed).toBe(1);
    expect(parseParams('?speed=-3').speed).toBe(1);
    expect(parseParams('?speed=9999').speed).toBe(MAX_SPEED);
  });
});

describe('seedFromText', () => {
  it('uses whole numbers as they are and hashes anything else', () => {
    expect(seedFromText('42')).toBe(42);
    expect(seedFromText('4294967295')).toBe(4294967295);
    expect(seedFromText('4294967296')).not.toBe(4294967296);
    expect(seedFromText('river')).toBe(seedFromText('river'));
    expect(seedFromText('river')).not.toBe(seedFromText('lake'));
  });
});
