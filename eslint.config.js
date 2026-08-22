import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-test/**', '**/node_modules/**', '**/playwright-report/**'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/consistent-type-imports': 'error', 'no-console': 'error' } },
  {
    // Only the two well-established hooks rules, not the newer React-Compiler-oriented
    // ruleset in `recommended` (purity/immutability/etc.) — those need real compiler
    // context to avoid false positives on a plain scaffold.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)
