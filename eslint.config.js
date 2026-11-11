import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-desktop/**', 'node_modules/**', 'windows/build/**', 'windows/.stage/**', 'windows/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['src/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  { files: ['**/*.{js,cjs,mjs}'], languageOptions: { globals: globals.node } },
  { files: ['windows/preload.cjs', 'windows/tests/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['windows/**/*.cjs', 'windows/tests/acceptance.mjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
