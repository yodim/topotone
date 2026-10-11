# Style template

A small working style to start from. To make your own:

1. Copy this folder to `src/styles/<id>/`. The folder name is the style id.
2. Set `id` in `index.ts` to the same name. The registry finds the style by itself.
3. Open the page with `?style=<id>` and change one part at a time.

What to keep in mind, in short (the comments in `index.ts` say more):

- Draw in CSS pixels and multiply sizes by `env.scale`.
- `drawSky`, `drawAtmosphere` and `drawOverlay` run every frame: keep them cheap. Build textures once in `setup`.
- `drawLayerChunk` runs once per chunk and is cached. Draw past the chunk edges; the engine clips.
- Randomness: `env.rng` for texture inside a chunk, `createRng(object.seed)` for each object. Never `Math.random()`.
- Anything that continues across a chunk edge (an outline, a wave, a grain pattern) must be a function of music time, not of the chunk's rng.

Helpers in `../shared/`: ridge sampling and water runs (`ridge.ts`), edge roughening (`edges.ts`), Catmull-Rom curves (`spline.ts`), variable-width strokes (`stroke.ts`), paper grain (`grain.ts`), colors (`palette.ts`) and shadows (`canvas.ts`).

Each style is inspired by a technique (woodcut, watercolor, risograph...), never a copy of a specific artwork.
