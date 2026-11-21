import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' so the build works from any GitHub Pages sub-path (user.github.io/repo/)
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
