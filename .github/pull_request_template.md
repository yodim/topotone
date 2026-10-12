## What changed

<!-- In a few plain sentences: what, and why. -->

## How it looks

<!-- For anything visible: screenshots with the landscape on its own, a song and the mic, at laptop and phone widths. -->

## Checks

- [ ] `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` pass
- [ ] `npm run test:e2e` passes, for changes to rendering, styles or the interface
- [ ] The world stays deterministic: no `Math.random()`, `Date.now()` or `performance.now()` in `src/world/` or `src/styles/`
- [ ] No new runtime dependency, no audio files and no binary textures
- [ ] A new style is in the screenshot test, and `docs/screenshots/` is refreshed
