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

This table is where the project gets its personality. All constants live in `src/world/mapping.ts`, commented, and will be tuned in Phase 3.

| Heard                                                         | Smoothing          | Becomes                                                |
| ------------------------------------------------------------- | ------------------ | ------------------------------------------------------ |
| Pitch or brightness (spectral centroid, pitch when confident) | about 0.5 s        | Height of the main mountain range                      |
| Loudness (RMS)                                                | about 0.2 s        | Height and ruggedness of the foreground hills          |
| Onsets in the high band (hi-hats, plucks)                     | none               | Grass tufts and small trees                            |
| Onsets in the low and mid bands (kicks, strong notes)         | none               | Large trees and rocks, size from onset strength        |
| Sustained low-band energy (bass, drones)                      | about 1 s          | A river appears, its width follows the bass            |
| Long silence (more than about 2 s)                            | n/a                | A flat plain or a still lake, mist rises               |
| Long-term energy                                              | about 10 s         | Sky mood: calm and clear to dramatic and clouded       |
| Overall brightness of the track                               | whole song or 30 s | Palette temperature hint (styles may use or ignore it) |
| Crescendo, a sudden big peak in loudness                      | n/a                | A tall lone peak, or a flock of birds taking off       |

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

Known risk for Phase 2: mic mode wants the near layers built in short slices (about 0.25 s), while chunks are 4 s and frozen. The contract may need partial chunks then.

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

- [ ] `rng.ts`: small fast seeded PRNG (sfc32 or mulberry32), `hashSeed(...values)` to derive seeds, helpers (`range`, `int`, `pick`, `chance`, `gaussian`). Tests for determinism.
- [ ] `noise.ts`: seeded 1D and 2D noise with fbm. Tests.
- [ ] `SyntheticSource`: music-like feature frames from seeded noise. Phrase-shaped loudness swells, wandering brightness, quasi-regular onsets (a tempo between 70 and 130 bpm with slight swing), occasional quiet passages and bass-heavy sections.
- [ ] `scene.ts` types, `mapping.ts` v0 following the table above, `generator.ts` producing `LayerChunk`s on demand per (layer, index), `store.ts` with eviction
- [ ] `camera.ts`: music time to screen x per layer, `x = playheadX + (t - now) * pxPerSecond * parallax(depth)`
- [ ] `engine.ts`: per-layer chunk canvases with bleed and clipping, compositing with parallax, sky, atmosphere and overlay hooks
- [ ] `debug` style: ridge polylines, markers for trees and rocks, blue bars for water, vertical ticks for onsets, sky values as text
- [ ] Feature meters overlay (bars for rms, bands, centroid, onset flashes), toggled with `D`
- [ ] URL params: `seed`, `style`, `speed`

**Done when:**

- The world scrolls from right to left forever, smoothly, with no visible seams at chunk edges
- Reloading with the same `?seed=` gives an identical world (test: hash of the generated chunk data for the first 60 seconds is stable)
- 60 fps holds, and memory stays flat over a 10 minute run

### Phase 2: Listening

- [ ] `fft.ts`: radix-2 FFT and a Hann window. Tests against known signals.
- [ ] `extractor.ts`: a pure function over Float32Array frames (frame 2048, hop 512 at the context sample rate). RMS, three band energies, spectral centroid on a log scale, spectral flux with adaptive onset threshold (local median plus a margin), optional pitch (YIN or autocorrelation) with confidence.
- [ ] Normalization: file mode normalizes with whole-track statistics; mic mode with running percentiles. A quiet acoustic recording and a loud electronic track should both use the full range.
- [ ] `FileSource`: `decodeAudioData`, offline analysis in `analysis.worker.ts` with a progress indicator, playback through `AudioBufferSourceNode`, clock from `AudioContext.currentTime`, pause and resume
- [ ] `MicSource`: `getUserMedia` with `echoCancellation`, `noiseSuppression` and `autoGainControl` turned off (they mangle music), time-domain data fed to the same extractor, never connected to the speakers
- [ ] Source manager: switching between synthetic, file and mic, blending features over about 2 seconds so the land never jumps. End of song hands over to the synthetic source, continuing from the last state.
- [ ] Test fixtures generated by code in `tests/fixtures/`: a sine sweep from 100 Hz to 2 kHz, a 120 bpm click track, a bass drone with a silent gap, and a mixed piece. A script writes them as WAV files (gitignored) for listening in the browser.

**Done when:**

- Tests pass: the sweep gives a rising centroid; clicks give onsets every 0.5 s within 20 ms; silence gives an RMS close to 0
- Dropping a song plays it and the world follows it in sync
- The mic works in Chrome, Firefox and Safari
- Denying mic permission returns gracefully to the fallback with a short, friendly message

### Phase 3: Making it feel musical

This phase is about listening, not features. The maintainer tests with real songs of different genres locally (never committed).

- [ ] Dev-only tuning panel (hand-written, no dependency) to tweak the mapping constants live and copy them out as JSON
- [ ] Far and near layer behavior as described in "Design notes" below, including mic mode
- [ ] Events: crescendo gives a lone peak or birds taking off; long silence gives a lake and rising mist; a drop after a build-up gives something noticeable
- [ ] Macro and micro balance: music sets the shape, noise the texture. Avoid the oscilloscope look.

**Done when:**

- The sweep fixture visibly climbs, the click track reads as rhythm in the trees, the drone opens a river, the silent gap gives a calm lake
- A quiet intro feels calm and a loud chorus feels dramatic
- The maintainer signs off after trying it with their own songs

### Phase 4: Three styles

Order: paper cutout first (simplest, validates the `Style` interface), then ink, then ukiyo-e. Each style is inspired by a technique, never a copy of a specific artwork.

- [ ] Finalize the `Style` interface, `_template`, and `registry.ts` with `import.meta.glob`
- [ ] Live style switching with a crossfade of about 0.5 s
- [ ] `styles/shared/`: procedural paper grain, noise-based edge roughening, Catmull-Rom smoothing for ridges, variable-width strokes along a path, palette helpers

**Paper cutout**

- [ ] Each layer is a sheet of colored paper: flat fill under the ridge, edges slightly roughened, a soft drop shadow cast onto the layer behind
- [ ] Paper fiber texture over each sheet, slightly different per layer
- [ ] Far layers lighter and cooler, near layers deeper and warmer
- [ ] Trees as simple cut shapes picked by `variant` (triangle conifers, round trees on sticks), a few with thin cut-line details
- [ ] Water as a separate paler sheet with one or two cut wave strips
- [ ] Sky as a flat gradient sheet, a paper sun, rounded cutout clouds

**Ink painting**

- [ ] Warm off-white rice paper background with faint fibers
- [ ] Mountains as ink washes that fade downward into the paper, outlined with variable-width brush strokes, with short texture strokes on the slopes (denser where the terrain is rugged)
- [ ] Distance shown by tone only: far ranges pale grey, near ones dark
- [ ] Mist bands between layers through `drawAtmosphere`, drifting slowly
- [ ] Trees as tapered trunk strokes with dotted or dabbed foliage, pines with layered needle strokes
- [ ] Water left mostly as empty paper with a few thin horizontal lines
- [ ] Birds as tiny brush marks
- [ ] Optional red seal stamp in a corner with the project initials (no invented characters)

**Ukiyo-e woodblock**

- [ ] Flat opaque color areas with a dark keyline of steady width, colors misregistered by 1 to 2 px for a printed feel
- [ ] Bokashi gradients at the top of the sky and along the horizon
- [ ] Limited palette: Prussian blue, indigo, vermilion, ochre, pale green, ivory paper, black keyline
- [ ] Mountains with stylized parallel striations, snowcaps above a height threshold
- [ ] Clouds as long horizontal bands with rounded ends
- [ ] Water with scalloped wave patterns and small foam curls
- [ ] Pines with stacked flat canopies; in bright moods, some blossoming trees as pink dot clusters
- [ ] Faint wood grain in large flat areas

**Done when:** each style looks intentional on the three reference seeds (screenshots saved in `docs/screenshots/`), holds 60 fps, switches instantly, and stays deterministic.

### Phase 5: Panorama export

- [ ] Rebuild every chunk from the stored feature history (whole song in file mode, session so far in mic and fallback modes) and render it into one long image at a chosen height (1080 px by default)
- [ ] Respect canvas limits: keep the width at or under 16384 px (safe for Safari) by adjusting pixels per second, and tell the user when the image was compressed horizontally
- [ ] Optional caption strip: song name (editable), seed, style, date
- [ ] Download as PNG with `toBlob`, with a progress indicator and no frozen UI

**Done when:** a 4 minute song exports in under about 10 seconds, and a short fixture exported as a panorama matches the live view for the same stretch (pixel comparison test).

### Phase 6: Interface and polish

- [ ] Minimal control bar that fades out when idle: Song, Mic, Style, Seed (shuffle), Export, Fullscreen, About
- [ ] Drag and drop anywhere on the page
- [ ] Keyboard: `Space` play or pause, `1` to `3` styles, `S` new seed, `D` debug, `F` fullscreen, `E` export
- [ ] Tap to start on mobile for audio, with the fallback already running behind
- [ ] `prefers-reduced-motion`: slower scroll, no flashing crossfades
- [ ] Short friendly errors: unsupported file, decode failure, mic denied
- [ ] About panel: what it is, privacy (audio never leaves the device), repo link, credits

**Done when:** it works and feels good on a phone and a laptop, and someone who has never seen it understands what to do within a few seconds.

### Phase 7: Open source release

- [ ] README: one-line pitch, animated GIF and screenshots of the three styles, live demo link, the pipeline diagram, the mapping table, how to run it locally
- [ ] `CONTRIBUTING.md` with two walkthroughs: "Add a style" (from `_template` to a working style) and "Tune the mapping"
- [ ] `CODE_OF_CONDUCT.md`, issue templates (bug, new style proposal, mapping idea), pull request template
- [ ] Social preview image generated from the app itself
- [ ] A handful of "good first issue" tickets: watercolor style, pixel art style, night sky with stars, weather, seasons, MIDI input

## Design notes and known traps

- **Where "now" is.** File mode: the whole track is analyzed up front, the playhead sits in the middle of the screen, and the content at the playhead is what you hear. Mic mode: the playhead sits at the right edge, so the land is drawn as it is heard. Fallback: playhead in the middle, synthetic features have infinite lookahead.
- **Far layers need the future.** With parallax, the right edge of a far layer shows music time well ahead of the playhead. File and synthetic sources can answer. In mic mode, far layers are generated from the latest slow, smoothed features when they first come into view, then frozen. They change slowly by nature, so this reads as natural.
- **Mic mode near layers.** Built in short slices (about 0.25 s) that are finalized as audio arrives, so the foreground grows in real time without regenerating visible content.
- **Chunks are frozen.** Once a chunk is generated it never changes. Regenerating visible content causes popping.
- **Chunk edges.** Objects near an edge overhang into the neighbor. Each chunk canvas has a bleed margin and draws its own objects plus overhanging objects from its neighbors, then the engine clips it to its exact bounds. Strokes along a ridge start and end inside the bleed, never exactly at the edge, or semi-transparent washes will show seams.
- **Clock.** Sync visuals to `AudioContext.currentTime`, not to `requestAnimationFrame` timestamps, or the world drifts away from the music.
- **Autoplay.** `AudioContext` needs a user gesture. The fallback needs no audio at all, so it can start immediately.
- **Microphone.** Never connect the mic to the speakers (feedback). Turn off echo cancellation, noise suppression and auto gain, they distort music.
- **Normalization.** Different recordings have very different levels. Without normalization, quiet songs produce flat land and loud ones produce spikes.
- **Offline analysis.** A 4 minute track is about 20,000 FFT frames. Run it in a worker and show progress.
- **Canvas limits.** Browsers cap canvas size (Safari is the strictest). Keep panoramas at or under 16384 px wide.
- **Pixel ratio.** Cap at 2. Chunk canvases are sized in device pixels.
- **Memory.** Evict chunk canvases off-screen. Keep only feature frames (small) as history for export.
- **Safari.** Prefer regular canvas elements over `OffscreenCanvas` for the chunk cache, for older Safari versions.
- **GitHub Pages.** Set Vite `base` to the repository path.

## After v1

- **Idle mode sings.** In fallback mode, the landscape plays itself: peaks become notes in a pentatonic scale, trees become soft percussion, rivers a low drone. The loop closes.
- Record a short video with sound (`canvas.captureStream` with `MediaRecorder`)
- Poster export: the panorama cut into rows and stacked, at print sizes
- Mapping presets (calm, dramatic, literal) and shareable mapping JSON
- More styles: watercolor (probably WebGL), pixel art, risograph, blueprint
- Seasons and day and night following the structure of the song
- MIDI input as a source

## Open decisions

- Name: "Topotone" is a placeholder
- License: MIT proposed
- Hosting: GitHub Pages proposed
