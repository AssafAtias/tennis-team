import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // tsconfig.test.json emits compiled .test.js next to the .ts sources under
    // dist-test/ — without this, vitest's default glob picks up both.
    exclude: [...configDefaults.exclude, '**/dist-test/**'],
  },
})
