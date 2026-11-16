import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The production build is ONE self-contained file (play/index.html) so it can be
// opened by double-clicking it (file://) - no server and no npm needed.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { outDir: 'play', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 4000 },
  server: { port: 5173 },
});
