import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./integration-tests/obsidian-runtime.ts', import.meta.url)),
    },
  },
  test: {
    include: ['integration-tests/**/*.test.ts'],
    environment: 'node',
  },
})
