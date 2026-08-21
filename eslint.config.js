import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-test/**', '**/node_modules/**', '**/playwright-report/**'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/consistent-type-imports': 'error' } },
)
