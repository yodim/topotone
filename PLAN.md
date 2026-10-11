# Topotone build plan

## The idea

You open the page and a quiet landscape is already drifting from right to left, generated from a random seed. Drop a song on it, or turn on the microphone, and the land starts answering: the melody lifts the mountains, each beat plants a tree, the bass opens a river, a silence leaves a still lake under the mist. At any moment you can switch the style and the very same world is redrawn as an ink painting, a layered paper cutout or a ukiyo-e woodblock print. When the song ends, you can export the whole thing as one long panorama.

It is a small, playful project meant to be read, forked and extended. The code should be as pleasant to explore as the result is to watch.

## What v1 does

- **Fallback, always on.** With no song and no mic, an infinite seeded landscape scrolls by. It starts instantly, needs no permission prompt, and `?seed=` reproduces it exactly. The synthetic source produces music-like features, so the fallback world looks as varied as a real song.
- **Song file.** Drag and drop or pick a file (mp3, ogg, wav, m4a, whatever the browser decodes). The whole track is analyzed first in a worker, so the world is known in advance and what you hear is what passes the playhead, in the middle of the screen. When the song ends, the world eases back into fallback mode instead of stopping.
- **Microphone.** Live. The playhead sits at the right edge and new land is drawn as it is heard.
- **Styles.** Ink painting, layered paper cutout, ukiyo-e woodblock, plus a debug wireframe for development. Switching is live with a short crossfade.
- **Panorama export.** The whole song (file mode) or the session so far (mic and fallback) as one long PNG.

## The musical mapping (starting point)

This table is where the project gets its personality. All constants live in `src/world/mapping.ts`, commented, and can be tuned live with `?tune`. The table shows mapping version 1 (Phase 3).

| Heard                                                   | Smoothing          | Becomes                                                |
| ------------------------------------------------------- | ------------------ | ------------------------------------------------------ |
| Pitch or brightness, relative to the last 30 s of music | 1 s and 3 s        | Height of the middle and far mountain ranges           |
| Loudness (RMS)                                          | about 0.6 s        | Height and ruggedness of the foreground hills          |
| Onsets in the high band (hi-hats, plucks)               | none               | Grass tufts and small trees                            |
| Onsets in the low and mid bands (kicks, strong notes)   | none               | Large trees and rocks, size from onset strength        |
| Sustained low-band energy (bass, drones)                | about 1 s          | A river appears, its width follows the bass            |
| Long silence (more than about 2 s)                      | n/a                | A flat plain or a still lake, mist rises               |
| Long-term energy                                        | about 10 s         | Sky mood: calm and clear to dramatic and clouded       |
| Overall brightness of the track                         | whole song or 30 s | Palette temperature hint (styles may use or ignore it) |
| Crescendo, a sudden big peak in loudness                | n/a                | A tall lone peak, or a flock of birds taking off       |
| A drop: a crescendo after a build-up                    | n/a                | A taller peak, birds, and a lift in the hills          |

Far layers (distant ranges) follow the slow, heavily smoothed features. Near layers follow the fast ones. Seeded noise always adds the fine detail on top.

## Key types

The contracts live in code: `src/audio/features.ts`, `src/world/scene.ts` and `src/styles/types.ts`. Those files are the reference. The sketches below summarize them. They may still be refined in Phase 1, and any change is recorded in the change log at the end of this section.

```ts
// src/audio/features.ts

/** One analysis frame. Values are normalized to 0..1 unless noted. */
export interface FeatureFrame {
  t: number; // seconds from source start
  rms: number; // loudness
  low: number; // band energy below about 250 Hz
  mid: number; // about 250 Hz to 2 kHz
  high: number; // above about 2 kHz
  centroid: number; // brightness, on a log-frequency scale
  flux: number; // spectral change, raw onset strength
  onset: number; // strongest onset across the spectrum, 0 when none
  onsetLow: number; // onset in the low band (kicks, bass notes), 0 when none
  onsetMid: number; // onset in the mid band (strong notes, snares), 0 when none
  onsetHigh: number; // onset in the high band (hi-hats, plucks), 0 when none
  pitch: number | null; // log-frequency 0..1, null when unvoiced or unsure
  pitchConfidence: number;
}

export interface FeatureSource {
  readonly kind: 'synthetic' | 'file' | 'mic';
  /** Seconds between frames, so smoothing can be expressed in seconds for any source. */
  readonly hopSeconds: number;
  /** Current source time in seconds. File and mic use the AudioContext clock. */
  now(): number;
  /** Frames with t in [from, to). */
  frames(from: number, to: number): FeatureFrame[];
  /** Seconds available ahead of now(): Infinity for synthetic, rest of track for file, 0 for mic. */
  lookahead(): number;
}
```

```ts
// src/world/scene.ts

export const CHUNK_SECONDS = 4;
export const RIDGE_SAMPLES = 128; // a ridge holds RIDGE_SAMPLES + 1 heights

export type LayerRole = 'far-range' | 'mid-range' | 'hills' | 'ground';

/** Ordered far to near. depth 0 is the horizon, 1 is the foreground. */
export const LAYERS: readonly { role: LayerRole; depth: number }[] = [
  { role: 'far-range', depth: 0.1 },
  { role: 'mid-range', depth: 0.35 },
  { role: 'hills', depth: 0.65 },
  { role: 'ground', depth: 1 },
];

export interface WorldObject {
  kind: 'tree' | 'rock' | 'grass' | 'bird' | 'lone-peak';
  t: number; // music time it belongs to, in seconds
  size: number; // 0..1
  variant: number; // 0..1, each style decides what it means (species, shape)
  seed: number; // per-object seed for deterministic detail
}

export interface WaterSpan {
  t0: number;
  t1: number;
  width: number; // 0..1
  calm: number; // 0 rough, 1 mirror-still
}

export interface SkyState {
  mood: number; // 0 calm, 1 dramatic
  brightness: number; // 0 dusk, 1 bright day
  cloudiness: number;
  mist: number;
  warmth: number; // palette temperature hint
}

/** One layer of the world over one stretch of music time. Generated once, then frozen. */
export interface LayerChunk {
  role: LayerRole;
  depth: number;
  index: number; // covers music time [index * CHUNK_SECONDS, (index + 1) * CHUNK_SECONDS)
  seed: number; // derived from world seed, role and index
  ridge: Float32Array; // RIDGE_SAMPLES + 1 heights 0..1, chunk start to chunk end, both included
  objects: WorldObject[];
  water: WaterSpan[];
}
```

```ts
// src/styles/types.ts
// Every ctx handed to a style is already scaled by the device pixel ratio: styles draw in CSS pixels.

export interface Style {
  id: string; // folder name, used in ?style=
  name: string;
  description: string;
  author: string;
  /** Once, when the style is selected: build textures and palettes. */
  setup?(env: StyleEnv): void | Promise<void>;
  /** Every frame. Keep it cheap. */
  drawSky(ctx: CanvasRenderingContext2D, sky: SkyState, view: View): void;
  /** Once per layer chunk. The engine caches the result and clips it to the chunk bounds. */
  drawLayerChunk(ctx: CanvasRenderingContext2D, chunk: LayerChunk, env: ChunkEnv): void;
  /** Optional, every frame, after each layer: haze or mist between depths. */
  drawAtmosphere?(ctx: CanvasRenderingContext2D, depth: number, sky: SkyState, view: View): void;
  /** Optional, every frame, on top of everything: grain, drifting mist, shimmer. */
  drawOverlay?(ctx: CanvasRenderingContext2D, view: View): void;
}

export interface StyleEnv {
  seed: number; // world seed
  dpr: number; // capped at 2
}

export interface View {
  width: number; // viewport in CSS pixels
  height: number;
  dpr: number;
  now: number; // music time at the playhead
  clock: number; // animation time from the engine, for drifting effects
}

export interface ChunkEnv {
  rng: Rng; // seeded for this chunk: the only randomness allowed
  sky: SkyState; // at chunk start, for palette decisions
  neighbors: { prev: LayerChunk; next: LayerChunk }; // always provided, regenerated on demand
  width: number; // chunk canvas size in CSS pixels, including bleed
  height: number;
  bleed: number; // extra pixels on each side, clipped away by the engine
  scale: number; // size multiplier, 1 for a 1080 px tall view
  pxPerSecond: number; // this layer's speed in CSS pixels per second of music
  toX(t: number): number; // music time to chunk-local x
  toY(h: number): number; // ridge height 0..1 to y for this layer
}
```

### Contract change log

Phase 0:

- `FeatureFrame` gains `onsetLow`, `onsetMid` and `onsetHigh`, because the mapping treats high-band onsets (grass) differently from low and mid ones (large trees, rocks). `onset` stays as the strongest onset overall.
- `FeatureSource` gains `hopSeconds`, so smoothing constants can be written in seconds for every source.
- `RIDGE_SAMPLES` added. A ridge holds `RIDGE_SAMPLES + 1` heights and its last one sits exactly at the next chunk's start, computed from the same function, so edge values match.
- `ChunkEnv.neighbors` is always complete. Chunks are deterministic, so the engine regenerates a missing neighbor on demand.
- `ChunkEnv.scale` added, so the panorama export at another height matches the live view.
- `StyleEnv` and `View` defined. `View.clock` gives styles an animation time without reading the clock.
- Styles draw in CSS pixels: the engine scales every context by the device pixel ratio first.
- Lint also bans `Date.now()`, `performance.now()` and `new Date()` inside `src/world/` and `src/styles/`.

Phase 2:

- Style rule: per-object detail comes from `createRng(object.seed)`, never from `env.rng`. Under live input a chunk is redrawn as objects arrive, and a shared sequence would change the objects already drawn. The contract shapes did not change: near layers under live input are rebuilt and redrawn until their features exist, instead of using partial chunks.

Phase 4:

- `ChunkEnv.pxPerSecond` added: the layer's speed in CSS pixels per second of music. Styles used to work it out from two `toX` calls.
- Style rule, made explicit: anything that continues across a chunk edge (a cut or brushed outline, a wave, a grain pattern) is a function of music time, through the noise helpers in `styles/shared/`, with a seed that does not change from chunk to chunk. `env.rng` is for texture that stays inside the chunk, drawn in a fixed order so a redrawn chunk matches the cached one.

## Phases

Each phase ends with all checks green, boxes ticked here, a commit, and a short summary. One phase per session.

### Phase 0: Foundation

- [x] Vite + TypeScript (strict) project, ESLint, Prettier, Vitest
- [x] ESLint rule banning `Math.random` everywhere except `src/core/rng.ts`
- [x] Folder skeleton (see the layout in the README), with the contract types from this plan as stubs
- [x] Full-screen canvas, resize handling, device pixel ratio capped at 2, `requestAnimationFrame` loop with a placeholder drawing
- [x] GitHub Actions: CI on pull requests (lint, typecheck, test, build); deploy to GitHub Pages on `main`, with the Vite `base` set for the repo path
- [x] `LICENSE` (MIT), `.gitignore`, `.editorconfig`, a short README stub
- [x] Playwright as a dev dependency with one smoke test that loads the page and saves a screenshot. If the environment cannot install the browsers, skip it and say so.

**Done when:** CI is green, `npm run dev` shows the canvas, and the Pages workflow is ready (the maintainer enables Pages with "GitHub Actions" as the source).

### Phase 1: A world without sound

The fallback comes first on purpose. It proves the whole pipeline (features, world, rendering) before any audio exists. Audio sources later just replace the feature source.

- [x] `rng.ts`: small fast seeded PRNG (sfc32 or mulberry32), `hashSeed(...values)` to derive seeds, helpers (`range`, `int`, `pick`, `chance`, `gaussian`). Tests for determinism.
- [x] `noise.ts`: seeded 1D and 2D noise with fbm. Tests.
- [x] `SyntheticSource`: music-like feature frames from seeded noise. Phrase-shaped loudness swells, wandering brightness, quasi-regular onsets (a tempo between 70 and 130 bpm with slight swing), occasional quiet passages and bass-heavy sections.
- [x] `scene.ts` types, `mapping.ts` v0 following the table above, `generator.ts` producing `LayerChunk`s on demand per (layer, index), `store.ts` with eviction
- [x] `camera.ts`: music time to screen x per layer, `x = playheadX + (t - now) * pxPerSecond * parallax(depth)`
- [x] `engine.ts`: per-layer chunk canvases with bleed and clipping, compositing with parallax, sky, atmosphere and overlay hooks
- [x] `debug` style: ridge polylines, markers for trees and rocks, blue bars for water, vertical ticks for onsets, sky values as text
- [x] Feature meters overlay (bars for rms, bands, centroid, onset flashes), toggled with `D`
- [x] URL params: `seed`, `style`, `speed`

**Done when:**

- The world scrolls from right to left forever, smoothly, with no visible seams at chunk edges
- Reloading with the same `?seed=` gives an identical world (test: hash of the generated chunk data for the first 60 seconds is stable)
- 60 fps holds, and memory stays flat over a 10 minute run

Notes from building it:

- Smoothing is a plain mean over a window centred on the time asked for, never a running average. That keeps every value a function of time, so chunks can be built in any order and edges match exactly (a test checks this).
- Water comes in fixed cells of 0.5 s of absolute time. Contiguous cells make one river or lake, and styles may blend widths across neighbors.
- Each layer is cached as one strip canvas holding its visible chunks side by side. The strip is composited with a single drawImage at a fractional offset, which scrolls smoothly and leaves no hairline seams between chunks.
- World generation and the synthetic source use only arithmetic (no `Math.sin`, `Math.exp`, `Math.log`), so the world comes out identical in every browser. `rng.gaussian` is a sum of four uniforms for the same reason.
- `registry.ts` already exists in a minimal form, because `?style=` needs it. Phase 4 finishes it with the template.
- `tests/e2e/longrun.spec.ts` runs about eight minutes of music at `?speed=20` and checks that caches and the JS heap stay flat. The 60 fps part is checked by eye with the `D` meters on real hardware.

### Phase 2: Listening

- [x] `fft.ts`: radix-2 FFT and a Hann window. Tests against known signals.
- [x] `extractor.ts`: a pure function over Float32Array frames (frame 2048, hop 512 at the context sample rate). RMS, three band energies, spectral centroid on a log scale, spectral flux with adaptive onset threshold (local median plus a margin), optional pitch (YIN or autocorrelation) with confidence.
- [x] Normalization: file mode normalizes with whole-track statistics; mic mode with running percentiles. A quiet acoustic recording and a loud electronic track should both use the full range.
- [x] `FileSource`: `decodeAudioData`, offline analysis in `analysis.worker.ts` with a progress indicator, playback through `AudioBufferSourceNode`, clock from `AudioContext.currentTime`, pause and resume
- [x] `MicSource`: `getUserMedia` with `echoCancellation`, `noiseSuppression` and `autoGainControl` turned off (they mangle music), time-domain data fed to the same extractor, never connected to the speakers
- [x] Source manager: switching between synthetic, file and mic, blending features over about 2 seconds so the land never jumps. End of song hands over to the synthetic source, continuing from the last state.
- [x] Test fixtures generated by code in `tests/fixtures/`: a sine sweep from 100 Hz to 2 kHz, a 120 bpm click track, a bass drone with a silent gap, and a mixed piece. A script writes them as WAV files (gitignored) for listening in the browser.

**Done when:**

- Tests pass: the sweep gives a rising centroid; clicks give onsets every 0.5 s within 20 ms; silence gives an RMS close to 0
- Dropping a song plays it and the world follows it in sync
- The mic works in Chrome, Firefox and Safari
- Denying mic permission returns gracefully to the fallback with a short, friendly message

Phase 2 was split in two pull requests: 2a for songs, 2b for the mic. Both are done. Testing the mic in Firefox and Safari is left to the maintainer (the browser tests only drive Chromium's fake mic).

Notes from 2a:

- Frames are centred on their time: frame k covers 1024 samples on each side of sample k * 512.
- Energies are normalized in decibels between the 10th and 95th percentile of the track's non-silent frames, with a span of at least 18 dB so a steady sound is not blown up. Bands stay comparable: a band more than 15 dB below the loudest can never reach 1. Brightness and pitch stay absolute on one log-frequency scale (40 Hz to 16 kHz), so a dark track still reads as dark.
- Flux is the mean rise of the log spectrum per bin, against the maximum of the neighboring bins over the two previous frames (the SuperFlux idea). Without that, a steady 55 Hz drone wobbles enough to fire onsets. A rise of 0.75 per bin is always enough for full strength, which keeps steady sounds quiet.
- Onsets: a local peak above the local median plus a margin, reported one frame late, which puts clicks within 8 ms of their true time. Band onsets snap onto the full-spectrum onset, so one hit never marks two frames.
- Pitch: YIN through an FFT autocorrelation, on audio box-filtered down to about 11 kHz, from 80 Hz to 1 kHz, on every second frame. A four minute track analyzes in under 3 s.
- Live input (2b): an AudioWorklet hands every sample to the page in 512-sample blocks, through a gain of exactly 0 so the mic never reaches the speakers. The streaming analyzer uses the same extractor and onset rules, with statistics over the last 30 s and a trailing onset median. A frame comes out once nothing can change it, about 116 ms after it is heard.
- Live world: while the mic runs, every window in the mapping looks back only, so land never changes once its features exist. Hills and ground are revealed in 0.25 s steps up to the live time. Far and middle layers are frozen when they come into view; a chunk built next to an already frozen one eases from its edge over 2 s, so neighbors frozen at different moments still join smoothly. The playhead slides to 92% of the width.
- Switching sources: the world is frozen per timeline. Starting a song cuts the timeline at the current moment, the world is rebuilt, and the old land fades out over 0.5 s. The song's end and the hand-back to the synthetic source are on the timeline from the start, so nothing changes again when the song ends. Features blend over 2 s after each cut.

### Phase 3: Making it feel musical

This phase is about listening, not features. The maintainer tests with real songs of different genres locally (never committed).

- [x] Tuning panel (hand-written, no dependency) to tweak the mapping constants live and copy them out as JSON. It opens with `?tune` on any build, not only in development, so the maintainer can tune on the live site.
- [x] Far and near layer behavior as described in "Design notes" below, including mic mode
- [x] Events: crescendo gives a lone peak or birds taking off; long silence gives a lake and rising mist; a drop after a build-up gives something noticeable
- [x] Macro and micro balance: music sets the shape, noise the texture. Avoid the oscilloscope look.

**Done when:**

- The sweep fixture visibly climbs, the click track reads as rhythm in the trees, the drone opens a river, the silent gap gives a calm lake
- A quiet intro feels calm and a loud chorus feels dramatic
- The maintainer signs off after trying it with their own songs

Phase 3 runs in two steps. 3a (done): mapping version 1, the tuning panel, the drop event and one automated test per "done when" line above (`tests/musical.test.ts`). 3b: rounds of tuning from the maintainer's notes on real songs, until sign-off.

Notes from 3a:

- The mountains follow brightness and pitch relative to the music around them: the tone over the last 1 s (middle range) or 3 s (far range), against the mean and spread of 1 s tone means over a 30 s window. Before this, with absolute brightness, a real song moved the far range by about 1% of its height while noise moved it by 30%. The context statistics are sampled on a fixed half-second grid and interpolated, so the result stays a function of time and chunk edges stay exact.
- That makes the mountains show the contour of the melody: a brighter chorus lifts them, and if it goes on they settle back to the song's average within about 15 s. With a song file the analysis sees a little ahead, so the land dips slightly just before a change.
- The absolute brightness only tints the sky (warmth): a dark song and a bright song get the same mountain shapes.
- Noise on the far and middle ranges is down from about ±0.3 to ±0.12, so the music sets the shape.
- Hills follow loudness over 0.6 s instead of 0.2 s, and loudness also scales their ruggedness: quiet passages are low and smooth, loud ones tall and rough.
- Ridges bend smoothly into their limits (`softClamp01`) instead of being cut, so tall peaks stay rounded.
- Mist uses the same 2.5 s window as the silence detector, so a gap of a few seconds now raises it.

### Phase 4: Three styles

Order: paper cutout first (simplest, validates the `Style` interface), then ink, then ukiyo-e. Each style is inspired by a technique, never a copy of a specific artwork.

- [x] Finalize the `Style` interface, `_template`, and `registry.ts` with `import.meta.glob`
- [x] Live style switching with a crossfade of about 0.5 s
- [x] `styles/shared/`: procedural paper grain, noise-based edge roughening, Catmull-Rom smoothing for ridges, variable-width strokes along a path, palette helpers

**Paper cutout**

- [x] Each layer is a sheet of colored paper: flat fill under the ridge, edges slightly roughened, a soft drop shadow cast onto the layer behind
- [x] Paper fiber texture over each sheet, slightly different per layer
- [x] Far layers lighter and cooler, near layers deeper and warmer
- [x] Trees as simple cut shapes picked by `variant` (triangle conifers, round trees on sticks), a few with thin cut-line details
- [x] Water as a separate paler sheet with one or two cut wave strips
- [x] Sky as a flat gradient sheet, a paper sun, rounded cutout clouds

**Ink painting**

- [x] Warm off-white rice paper background with faint fibers
- [x] Mountains as ink washes that fade downward into the paper, outlined with variable-width brush strokes, with short texture strokes on the slopes (denser where the terrain is rugged)
- [x] Distance shown by tone only: far ranges pale grey, near ones dark
- [x] Mist bands between layers through `drawAtmosphere`, drifting slowly
- [x] Trees as tapered trunk strokes with dotted or dabbed foliage, pines with layered needle strokes
- [x] Water left mostly as empty paper with a few thin horizontal lines
- [x] Birds as tiny brush marks
- [x] Optional red seal stamp in a corner with the project initials (no invented characters)

**Ukiyo-e woodblock**

- [x] Flat opaque color areas with a dark keyline of steady width, colors misregistered by 1 to 2 px for a printed feel
- [x] Bokashi gradients at the top of the sky and along the horizon
- [x] Limited palette: Prussian blue, indigo, vermilion, ochre, pale green, ivory paper, black keyline
- [x] Mountains with stylized parallel striations, snowcaps above a height threshold
- [x] Clouds as long horizontal bands with rounded ends
- [x] Water with scalloped wave patterns and small foam curls
- [x] Pines with stacked flat canopies; in bright moods, some blossoming trees as pink dot clusters
- [x] Faint wood grain in large flat areas

**Done when:** each style looks intentional on the three reference seeds (screenshots saved in `docs/screenshots/`), holds 60 fps, switches instantly, and stays deterministic.

Phase 4 ran in three pull requests: 4a for the shared helpers, the template, live switching and paper (now the default style); 4b for ink; 4c for ukiyo-e, the reference screenshots and the ticks here. All three are done. The 60 fps line was only measured in headless software rendering, where ukiyo-e and ink hold 60 fps and paper runs a little below; a check on a real mid-range laptop is left to the maintainer.

Notes from 4a:

- Keys `1`, `2` and `3` pick paper, ink and ukiyo-e. The choice goes into the address (`?style=`). Debug is only reachable with `?style=debug`. Styles are set up the first time they are used, and the others are warmed up while the page is idle.
- A style change reuses the fade from Phase 2: the old style's whole frame (sky included) is drawn aside and fades out over the new one. While old land is on screen, new chunks are drawn under a small budget per frame (10 chunks or 6 ms), and the old land stays fully on top until the new land is complete, so the switch never stalls a frame. The same budget applies when a song starts.
- `stats().chunkMs` gives the average time to build and draw a chunk.
- Paper: each layer is a sheet cut along the ridge, with an edge that wobbles as a function of music time, a soft shadow cast upwards onto the sheet behind, and a grain tile per layer anchored to music time. The far and middle ranges get a second, lower sheet of foothills, and the ground a darker verge at the bottom, so the picture has seven sheets instead of four. Water is a paler sheet that tucks in behind the verge. Clouds are ready-made sprites that sink behind the mountains when the sky clears, rather than fading. A world picks one of three paper sets (meadow, autumn, teal) from its seed. The sky sheet is cached and only redrawn when its colors move by a visible step.

Notes from 4b:

- Ink: the sky is the paper itself (rice paper fibers, a grey wash at the top in dramatic passages, a pale vermilion sun at dusk). Each range is a wash drawn in thin columns, all sharing one gradient that is stretched per column; the fade is measured from a smoothed ridge so jagged crests do not streak it. The outline is a variable-width stroke whose pressure and dry breaks follow music time. Texture strokes point downhill and are denser where the ridge is steep or broken; moss dots sit on crests of the middle ranges. Both come from `env.rng` in a fixed count and lie wholly inside their chunk. Water is bare paper laid over the land, with a few broken lines. Pines are a bent trunk with flat plates of needle strokes; leafy trees are dabs in two tones; bare trees end in dots. Mist is a soft band at the foot of each range plus wisps that drift with the animation clock. The seal in the corner carries the project initials, TT.
- `styles/shared/canvas.ts` gained `ViewCache`, a view-sized canvas repainted only when its key changes. Paper and ink both keep their sky in one.

Notes from 4c:

- Ukiyo-e: every color block is printed 1.5 px right and 1 px down from its keyline, which has the same width everywhere. Each range is a flat block with a gentle bokashi from the top of its band to the bottom, and faint wood grain from a tile built in setup. The distant ranges carry broken striations that follow a smoothed ridge, and snow above a fixed height line (0.66 for the far range, 0.86 for the middle one) with a jagged lower edge. The snow line depends on the ridge alone. A first version lowered it around lone peaks, and under the mic that left a snow patch cut off at a chunk edge.
- The sky has a Prussian blue bokashi at the top, a band along the horizon (pale blue by day, ochre to vermilion when warm or at dusk) and a vermilion sun at dusk. Clouds are long bands with rounded ends in three height lanes, so they never overlap; like paper's, they slide down behind the far range when the sky clears.
- Water is a Prussian blue block with rows of scallops (flatter when calm) and foam curls on the crest of rough water.
- Pines have stacked flat canopies with a lighter top. Round trees blossom as pink dot clusters in bright moods, but only when the tree sits clear of its chunk's edges: blossoming depends on the sky at the chunk start, and a tree drawn by two chunks must look the same in both.
- `tests/e2e/screenshots.spec.ts` shoots every style on the three reference seeds (`river`, `ember` and `willow`, one for each paper set) about 24 seconds in. `UPDATE_SCREENSHOTS=1 npm run test:e2e -- screenshots` writes them to `docs/screenshots/`.
