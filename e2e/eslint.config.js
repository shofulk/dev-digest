// ESLint flat config — @devdigest/e2e (agent-browser flows).
//
// Severity encodes STATE: `error` = clean today, `warn` = known violations named in
// an OUTSTANDING comment. Baseline at introduction (2026-09-20): 0 problems.
//
// The flows themselves are data (specs/*.flow.json); only the runner and its helpers
// are linted. `no-console` stays off: the runner's output IS its report.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['test-results/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
);
