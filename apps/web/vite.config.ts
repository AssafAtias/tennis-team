import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Dev only: in production the API serves this bundle from the same origin.
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // tsconfig.json emits compiled .test.js next to the .ts/.tsx sources under
    // dist-test/ — without this, vitest's default glob picks up both copies.
    exclude: [...configDefaults.exclude, '**/dist-test/**'],
  },
})
