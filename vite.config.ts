import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
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
