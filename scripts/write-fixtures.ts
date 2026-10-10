/**
 * Writes the test signals as WAV files into tests/fixtures/out/ (gitignored), so they can
 * be dropped on the page and listened to. Run with `npm run fixtures`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clickTrack,
  droneWithGap,
  encodeWav,
  mixedPiece,
  sineSweep,
} from '../tests/fixtures/signals.ts';

const out = join(import.meta.dirname, '..', 'tests', 'fixtures', 'out');
mkdirSync(out, { recursive: true });

const signals = {
  'sweep-100-2000.wav': sineSweep(),
  'clicks-120bpm.wav': clickTrack(),
  'drone-with-gap.wav': droneWithGap(),
  'mixed-piece.wav': mixedPiece(),
};

for (const [name, signal] of Object.entries(signals)) {
  writeFileSync(join(out, name), encodeWav(signal));
  console.log(`wrote ${join('tests', 'fixtures', 'out', name)}`);
}
