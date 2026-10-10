import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/, so the build and its preview need that base.
// The dev server stays at the root.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/topotone/' : '/',
  build: {
    target: 'es2022',
  },
}));
