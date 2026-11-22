import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' so the build works from any GitHub Pages sub-path (user.github.io/repo/)
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  // 30 s a test: the build machine has two slow cores, and the printed-grid tests keep both busy, so a test that takes
  // one second alone can take several there (the default of 5 s failed a deploy that way)
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
