import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // @lihok/project-controls is consumed through its public entry point only.
      // Deep imports into package internals would freeze implementation details
      // into app code and defeat the anti-fork boundary.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@lihok/project-controls/*'],
              message:
                'Import from "@lihok/project-controls" (its public API). Deep imports into package internals are not allowed.',
            },
          ],
        },
      ],
    },
  },
  {
    // Test files may additionally use the test-only fixture entry point.
    files: ['**/*.{test,spec}.{ts,tsx}', '**/__fixtures__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@lihok/project-controls/src/*', '@lihok/project-controls/dist/*'],
              message:
                'Deep imports into @lihok/project-controls internals are not allowed; use the public entry point or "@lihok/project-controls/testing".',
            },
          ],
        },
      ],
    },
  },
])
