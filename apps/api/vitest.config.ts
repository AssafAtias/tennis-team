import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // tsconfig.test.json emits compiled .test.js next to the .ts sources under
    // dist-test/ — without this, vitest's default glob picks up both.
    exclude: [...configDefaults.exclude, '**/dist-test/**'],
    globalSetup: ['./test/setup/global.ts'],
    // Every test FILE shares one Postgres database; running files in parallel
    // would deadlock/interleave against the same rows.
    fileParallelism: false,
    // Explicit even though it's the default: `isolate` re-evaluates each test
    // module per file, giving every file its own module-scope pool/`root` in
    // harness.ts and its own `afterAll`. If this were set to false, the first
    // file's `afterAll` would destroy the pool the other nine files still need.
    isolate: true,
    testTimeout: 20_000,
  },
})
