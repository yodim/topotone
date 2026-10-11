/**
 * What paper builds once in setup: the set of papers for this world, a grain tile per
 * layer, and cloud sprites. Drawing works without it too (in unit tests, nothing is built
 * and the textures are skipped).
 */
import { hashSeed } from '../../core/rng';
import { makeGrainTile, type GrainTile } from '../shared/grain';
import { shade } from '../shared/palette';
import { makeClouds, type CloudSprite } from './clouds';
import { PAPERS, papersFor, type Papers } from './palette';

export interface Look {
  seed: number;
  papers: Papers;
  /** One grain per layer, far to near, then one for the sky and one for small cut pieces. */
  grain: (GrainTile | null)[];
  skyGrain: GrainTile | null;
  pieceGrain: GrainTile | null;
  clouds: CloudSprite[];
}

let current: Look = {
  seed: 0,
  papers: PAPERS[0] as Papers,
  grain: [],
  skyGrain: null,
  pieceGrain: null,
  clouds: [],
};

export function look(): Look {
  return current;
}

export function buildLook(seed: number, dpr: number): void {
  const papers = papersFor(seed);
  // Each sheet gets its own grain: nearer sheets a little coarser and more fibrous.
  const grain = papers.layers.map((color, i) =>
    makeGrainTile(hashSeed(seed, 'paper', 'grain', i), {
      size: 160 + 32 * i,
      dpr,
      speckle: 0.05 + 0.015 * i,
      fibers: 40 + 25 * i,
      fiberAlpha: 0.1 + 0.03 * i,
      fiberLength: 9 + 3 * i,
      blotches: 8,
      blotchAlpha: 0.04,
      light: shade(color, 0.6),
      dark: shade(color, -0.55),
    }),
  );
  const skyGrain = makeGrainTile(hashSeed(seed, 'paper', 'grain', 'sky'), {
    size: 256,
    dpr,
    speckle: 0.035,
    fibers: 50,
    fiberAlpha: 0.08,
    fiberLength: 16,
    blotches: 12,
    blotchAlpha: 0.03,
    light: [255, 255, 255],
    dark: [90, 80, 70],
  });
  const pieceGrain = makeGrainTile(hashSeed(seed, 'paper', 'grain', 'piece'), {
    size: 96,
    dpr,
    speckle: 0.07,
    fibers: 20,
    fiberAlpha: 0.12,
    fiberLength: 6,
    blotches: 4,
    blotchAlpha: 0.05,
  });
  current = {
    seed,
    papers,
    grain,
    skyGrain,
    pieceGrain,
    clouds: makeClouds(hashSeed(seed, 'paper', 'clouds'), dpr, papers, skyGrain),
  };
}
