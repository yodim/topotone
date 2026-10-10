# Topotone

Topotone turns sound into landscape. A song, a microphone or a seeded random source drives a procedural world that scrolls from right to left. Melody raises mountains, beats plant trees, bass carves rivers. The same world can be drawn in several art styles.

It is early days. With no sound, the world is driven by a seeded synthetic source that behaves like music. Drop a song and the world follows it. Everything is drawn in a debug wireframe style for now, and the microphone comes next. See [PLAN.md](PLAN.md) for where it is heading.

## Trying it

- `?seed=river` picks a world. Any text or number works, and the same seed always gives the same world. Without one, a random seed is chosen and written into the address bar.
- `?speed=4` runs the music faster (from 0.05 to 50).
- `?style=debug` picks a style. Debug is the only one so far.
- Drop a song anywhere on the page, or press `O` to pick one. It is analyzed first, then played. `Space` pauses and resumes.
- Press `D` to show the feature meters and the frame rate.

Your audio never leaves your device. There are no network calls, analytics or uploads.

## How it fits together

```
audio source ──► feature frames ──► mapping ──► generator ──► layer chunks ──► engine ──► style
(file, mic,      (pure data,        (music to   (seeded,       (pure data,      (camera,    (draws
 synthetic)       values 0..1)       intents)    deterministic)  no colors)       caching)    pixels)
```

The contracts between the parts live in `src/audio/features.ts`, `src/world/scene.ts` and `src/styles/types.ts`.

## Layout

```
src/
  main.ts                 bootstrap
  app/                    UI, app state, URL params, keyboard, drag and drop
  core/                   rng.ts (the only randomness), noise.ts, math.ts
  audio/                  features.ts (contract), cache.ts, fft.ts, extractor.ts,
                          normalize.ts, analysis.ts, analysis.worker.ts
    sources/              synthetic.ts, file.ts, mic.ts, manager.ts
  world/                  scene.ts (contract), mapping.ts, signal.ts, generator.ts, store.ts
  render/                 engine.ts, strip.ts, camera.ts, export.ts
  styles/                 types.ts (contract), registry.ts, shared/, _template/, debug/,
                          paper/, ink/, ukiyoe/
tests/                    unit tests, e2e/ smoke test, fixtures/ (code-generated signals)
docs/screenshots/
```

Files that are still stubs name the phase they arrive in.

## Running it locally

You need Node 22 or newer.

```
npm install
npm run dev        # local dev server
npm run build      # production build for GitHub Pages
npm run preview    # serve the build
npm run test       # unit tests
npm run test:e2e   # browser smoke test (run `npx playwright install chromium` once first)
npm run lint       # eslint and prettier check
npm run typecheck  # tsc
npm run fixtures   # write the test signals as WAV files to tests/fixtures/out/
```

## License

MIT, see [LICENSE](LICENSE).
