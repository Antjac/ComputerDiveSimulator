import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // three.js (~580 kB) lives in its own chunk, loaded only when the 3D view is opened.
  build: { chunkSizeWarningLimit: 700 },
});
