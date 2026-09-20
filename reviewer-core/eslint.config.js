// ESLint flat config — @devdigest/reviewer-core (the pure review engine).
//
// Severity encodes STATE: `error` = clean today, `warn` = known violations named in
// an OUTSTANDING comment. Baseline at introduction (2026-09-20): 0 problems.
//
// The purity guarantee this package lives by (no fastify/drizzle/fs/SDK imports) is
// enforced by server/.dependency-cruiser.cjs, not here — see the onion-architecture skill.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
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
