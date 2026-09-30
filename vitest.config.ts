import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['src/**/*.test.ts', 'client/src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'examples/**'],
    coverage: {
      include: [
        'src/shared/**/*.ts',
        'src/main/server/**/*.ts',
        'src/main/migrate.ts',
        'src/renderer/src/store/**/*.ts',
        'client/src/**/*.ts'
      ],
      exclude: ['**/*.test.ts', 'client/src/testing.ts', 'client/src/rn.native.ts', 'client/src/react-native.d.ts'],
      // Enforced in CI (npm run test:coverage).
      thresholds: { lines: 80, statements: 80, functions: 75, branches: 70 }
    }
  }
})
