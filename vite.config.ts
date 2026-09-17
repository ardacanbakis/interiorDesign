import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Where the app will be served from.
 *
 * GitHub Pages serves a project site from a subdirectory — `/interiorDesign/`
 * — so every asset URL has to be prefixed or the deployed page loads a blank
 * screen and a handful of 404s. Taken from the environment rather than
 * hardcoded, so `npm run dev` and any other host stay at the root.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
