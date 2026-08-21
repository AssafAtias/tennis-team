import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/setup/global.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
