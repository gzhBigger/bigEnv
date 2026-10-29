import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./src/renderer', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: true,
  },
  build: {
    outDir: fileURLToPath(new URL('./out/renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome130',
  },
});
