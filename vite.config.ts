import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works at any URL (e.g. GitHub Pages' /voxel-sandbox/).
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    // Keep the warning sensible; three.js alone is ~700 kB.
    chunkSizeWarningLimit: 1500,
  },
});
