# Topotone

Topotone turns sound into landscape. A song, a microphone or a seeded random source drives a procedural world that scrolls from right to left. Melody raises mountains, beats plant trees, bass carves rivers. The same world can be drawn in several art styles.

It is early days. With no sound, the world is driven by a seeded synthetic source that behaves like music. Drop a song, or turn on the microphone, and the world follows it. It can be drawn as a paper cutout, an ink painting or a ukiyo-e woodblock print. Reference screenshots of each are in [docs/screenshots](docs/screenshots). See [PLAN.md](PLAN.md) for where it is heading.

## Trying it

Every action has a button along the bottom of the page, so it all works by touch on a phone. On a computer each button also has a key. The buttons dim when nothing moves, and in fullscreen they hide with the cursor until the next touch or key.

- **Song** (`O`) plays a song from your device. You can also drop one anywhere on the page. It is analyzed first, then played. **Pause** (`Space`) shows up while a song is loaded.
- **Mic** (`M`) listens to the microphone. New land grows at the right as it is heard. Press it again to hand back to the landscape's own music.
- **Style** (`1`, `2`, `3`) switches between the paper cutout, ink and ukiyo-e styles, with a short crossfade. The button steps through them and shows the one on screen.
- **New world** (`S`) picks a new seed. A song or the mic keeps playing; only the land and the landscape's own music change.
- **Export** (`E`) saves a panorama as a PNG: the whole song, the mic session so far, or the last stretch of the landscape. Every layer is laid out at the same speed, so the image reads from left to right like the music. A caption strip with the title, seed, style and date is optional.
- In the top left corner, **Fullscreen** (`F`) and **About** (`A`): what Topotone is, the keys, privacy and credits. `Escape` closes a panel.
- `D` shows the feature meters, the playhead and the frame rate.

With reduced motion turned on in the system settings, the landscape's own music runs at half speed, fades are slower and the mist drifts less. Songs and the mic keep real time.

The address holds the rest:

- `?seed=river` picks a world. Any text or number works, and the same seed always gives the same world. Without one, a random seed is chosen and written into the address bar. New world writes its seed there too.
- `?style=paper` picks a style, and `?style=debug` shows the wireframe used for development.
- `?speed=4` runs the music faster (from 0.05 to 50).
- `?tune` opens the tuning panel: one slider per mapping value. Changes rebuild the land and are kept in your browser; `Copy JSON` gives the values you changed, and `T` hides the panel.

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
                          normalize.ts, analysis.ts, analysis.worker.ts, stream.ts,
                          mic.worklet.ts
    sources/              synthetic.ts, file.ts, mic.ts, manager.ts
  world/                  scene.ts (contract), mapping.ts, signal.ts, generator.ts, store.ts
  render/                 engine.ts, strip.ts, camera.ts, export.ts
  styles/                 types.ts (contract), registry.ts, shared/, _template/, debug/,
                          paper/, ink/, ukiyoe/
tests/                    unit tests, e2e/ smoke test, fixtures/ (code-generated signals)
docs/screenshots/
```

Files that are still stubs name the phase they arrive in. To make a style of your own, start from `src/styles/_template/`.

## Running it locally

You need Node 22 or newer.

```
npm install
npm run dev        # local dev server
npm run build      # production build for GitHub Pages
npm run preview    # serve the build
npm run test       # unit tests
npm run test:e2e   # browser tests (run `npx playwright install chromium` once first)
                   # UPDATE_SCREENSHOTS=1 npm run test:e2e -- screenshots refreshes docs/screenshots
npm run lint       # eslint and prettier check
npm run typecheck  # tsc
npm run fixtures   # write the test signals as WAV files to tests/fixtures/out/
```

## License

MIT, see [LICENSE](LICENSE).
