import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'release/**',
      'coverage/**',
      'client/dist/**',
      'examples/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart']
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'demo/**/*.ts', 'e2e/**/*.ts', '*.config.{ts,mjs}'],
    languageOptions: { globals: globals.node }
  },
  {
    // The SDK wraps console on purpose; the demo simulator is a CLI.
    files: ['client/src/**/*.ts', 'demo/**/*.ts'],
    rules: { 'no-console': 'off' }
  },
  {
    files: ['**/*.test.ts', 'client/src/testing.ts'],
    rules: { '@typescript-eslint/no-unused-expressions': 'off' }
  },
  prettier
)
