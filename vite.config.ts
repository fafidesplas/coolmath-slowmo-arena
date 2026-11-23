import { defineConfig } from 'vite';

export default defineConfig({
  base: '/coolmath-slowmo-arena/',
  build: { chunkSizeWarningLimit: 1000 },
});
