/**
 * Paper colors. A world picks one set of papers from its seed, as if choosing a pack of
 * colored sheets before cutting. Far sheets are lighter and cooler, near ones deeper and
 * warmer.
 */
import { hash01 } from '../../core/rng';
import { hex, type Rgb } from '../shared/palette';

export interface Papers {
  name: string;
  /** Sheet colors, far range to ground. */
  layers: readonly [Rgb, Rgb, Rgb, Rgb];
  conifer: Rgb;
  round: readonly Rgb[];
  poplar: Rgb;
  trunk: Rgb;
  grass: Rgb;
  rock: Rgb;
  water: Rgb;
  wave: Rgb;
  bird: Rgb;
  snow: Rgb;
  cloud: Rgb;
  sky: { dayTop: Rgb; dayHorizon: Rgb; duskTop: Rgb; duskHorizon: Rgb };
  sun: { day: Rgb; dusk: Rgb };
}

const h = hex;

export const PAPERS: readonly Papers[] = [
  {
    name: 'meadow',
    layers: [h('#c9d6d2'), h('#9fbda6'), h('#6f9b69'), h('#4b7140')],
    conifer: h('#2e5233'),
    round: [h('#7fa647'), h('#c9a63c'), h('#5d8c3f')],
    poplar: h('#3c693b'),
    trunk: h('#6b4b33'),
    grass: h('#62903e'),
    rock: h('#8b8474'),
    water: h('#a9d3d7'),
    wave: h('#e6f4f2'),
    bird: h('#34403b'),
    snow: h('#fbf8f1'),
    cloud: h('#fbf8f1'),
    sky: {
      dayTop: h('#9ccbe0'),
      dayHorizon: h('#f1ead6'),
      duskTop: h('#5f6f99'),
      duskHorizon: h('#f2c29a'),
    },
    sun: { day: h('#f5cf6b'), dusk: h('#ee8a53') },
  },
  {
    name: 'autumn',
    layers: [h('#d7ccd1'), h('#bba3a5'), h('#b9794b'), h('#7e4a2d')],
    conifer: h('#3f3a29'),
    round: [h('#d9822b'), h('#e3b23c'), h('#b5452f')],
    poplar: h('#8f5c2b'),
    trunk: h('#4d3424'),
    grass: h('#a3783a'),
    rock: h('#7d7068'),
    water: h('#b4d0d6'),
    wave: h('#ebf2f1'),
    bird: h('#3a2f2c'),
    snow: h('#fbf7f0'),
    cloud: h('#fcf7ef'),
    sky: {
      dayTop: h('#b6cfdd'),
      dayHorizon: h('#f6e3c6'),
      duskTop: h('#6b5d86'),
      duskHorizon: h('#f2a97f'),
    },
    sun: { day: h('#f4c35e'), dusk: h('#e8663f') },
  },
  {
    name: 'teal',
    layers: [h('#c4d7dc'), h('#8cb6bd'), h('#4f8c8e'), h('#2e5e63')],
    conifer: h('#1d3e44'),
    round: [h('#e2b046'), h('#8cb46a'), h('#d9693f')],
    poplar: h('#2c5a50'),
    trunk: h('#4b3b30'),
    grass: h('#6f9a6a'),
    rock: h('#7e8a8a'),
    water: h('#a7d4cd'),
    wave: h('#eaf7f3'),
    bird: h('#1f3236'),
    snow: h('#fbfaf5'),
    cloud: h('#fbf8f0'),
    sky: {
      dayTop: h('#e6dcc4'),
      dayHorizon: h('#f8f0df'),
      duskTop: h('#b6948a'),
      duskHorizon: h('#f3c79e'),
    },
    sun: { day: h('#e4573a'), dusk: h('#c43f2c') },
  },
];

export function papersFor(seed: number): Papers {
  const i = Math.floor(hash01(seed, 'paper', 'papers') * PAPERS.length);
  return PAPERS[i] ?? (PAPERS[0] as Papers);
}

/** A stormy grey that dramatic skies lean towards. */
export const STORM: Rgb = h('#5d6672');
/** Shadow cast by a piece of paper onto what is behind it. */
export function shadow(alpha = 0.34): string {
  return `rgba(28, 32, 38, ${alpha})`;
}
