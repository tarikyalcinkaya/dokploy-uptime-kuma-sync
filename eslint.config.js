import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const testFiles = ['src/**/*.test.ts', 'src/**/*.itest.ts', 'src/testing/**/*.ts']

export default tseslint.config(
  { ignores: ['**', '!src/', '!src/**'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-console': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        ...['it', 'test', 'describe', 'suite'].map((object) => ({
          object,
          property: 'only',
          message: 'Focused tests are not allowed.',
        })),
      ],
    },
  },
  {
    files: testFiles,
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['describe', 'it', 'test', 'suite'] },
          ],
        },
      ],
    },
  },
  prettier,
)
