// vite.online.config.mts
import { defineConfig } from 'vite';

/** The web page players open to join an online session. */
export default defineConfig({
  root: 'online-client',
  base: './',
  build: { outDir: '../dist-online', emptyOutDir: true },
});
