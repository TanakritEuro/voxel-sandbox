import { defineConfig } from 'vitest/config';

// `npm run bench`: the headless benchmark runs as a single Vitest file, so it shares the
// TypeScript setup with the tests. Console output goes straight to the terminal.
export default defineConfig({
  test: {
    include: ['bench/bench.ts'],
    testTimeout: 600_000,
    disableConsoleIntercept: true,
  },
});
