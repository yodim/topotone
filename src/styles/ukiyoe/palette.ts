/**
 * The woodblock palette: a few inks, each printed from its own block. Prussian blue, indigo,
 * vermilion, ochre, pale green, ivory paper and a black keyline.
 */
import { hex, type Rgb } from '../shared/palette';

export const PAPER: Rgb = hex('#f1e6cf');
export const KEYLINE: Rgb = hex('#211c1a');
export const PRUSSIAN: Rgb = hex('#24557f');
export const INDIGO: Rgb = hex('#2e3d66');
export const VERMILION: Rgb = hex('#d0482c');
export const OCHRE: Rgb = hex('#c99a3f');
export const PALE_GREEN: Rgb = hex('#a9b97a');
export const PINE: Rgb = hex('#3d6849');
export const TRUNK: Rgb = hex('#5b3b29');
export const BLOSSOM: Rgb = hex('#f0b4bd');
export const SNOW: Rgb = hex('#fbf6ea');
export const ROCK: Rgb = hex('#8f8676');

/** Each layer's block: color at the top of its band and at the bottom (a gentle bokashi). */
export const LAYER_INKS: readonly { top: Rgb; bottom: Rgb }[] = [
  { top: hex('#35648f'), bottom: hex('#a3bccb') },
  { top: hex('#4a7768'), bottom: hex('#93ac8c') },
  { top: hex('#9fb272'), bottom: hex('#c3c38a') },
  { top: hex('#c4953c'), bottom: hex('#b07f2f') },
];

export const WATER: Rgb = hex('#2b5f8c');
export const WAVE: Rgb = hex('#9cc0d6');
