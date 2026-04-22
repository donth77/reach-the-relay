import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    // Source maps stripped from production by default — they're ~12 MB of
    // readable TS source that players never benefit from. Set SOURCEMAP=1
    // (e.g. `SOURCEMAP=1 npm run build`) to re-enable for prod debugging.
    sourcemap: process.env.SOURCEMAP === '1' || process.env.SOURCEMAP === 'true',
    rollupOptions: {
      output: {
        // Split Phaser into its own chunk. Phaser rarely changes; splitting
        // lets the browser cache it across app-code deploys and shrinks the
        // app chunk Vite warns about.
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
