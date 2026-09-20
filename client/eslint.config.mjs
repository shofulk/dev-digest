// ESLint flat config — @devdigest/web.
//
// Severity encodes STATE, not opinion (the convention server/.dependency-cruiser.cjs
// already uses): `error` = clean today, `warn` = known violations, each named in an
// OUTSTANDING comment on the rule. A rule is promoted to `error` in the commit that
// clears its last violation; a rising warning count is the regression signal.
//
// Baseline at introduction (2026-09-20): 0 errors, 13 warnings.
//
// `src/vendor/**` is NOT linted: it mirrors server/src/vendor/shared and @devdigest/ui,
// and AGENTS.md forbids editing it here, so findings there could never be acted on.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['.next/**', 'next-env.d.ts', 'src/vendor/**', 'coverage/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      '@next/next': nextPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,

      // Unused vars: keep the `_`-prefixed escape hatch the codebase already uses
      // (e.g. `prId: _prId` in hooks/reviews.ts). Clean today → error.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // OUTSTANDING (7): lib/theme.tsx:19 · lib/repo-context.tsx:31 ·
      // lib/hooks/reviews.ts:175 · components/mermaid-diagram/MermaidDiagram.tsx:30 ·
      // pulls/[number]/_components/ReviewRunAccordion:57 · …/FindingsPanel:42 ·
      // agents/[id]/…/ConfigTab:30.
      // Each is a setState called synchronously in an effect body — the cascading-render
      // pattern react.dev calls "you might not need an effect". Fixing them is plan item
      // 10/13 territory, not a drive-by.
      'react-hooks/set-state-in-effect': 'warn',

      // OUTSTANDING (1): pulls/_components/FindingsCell/…/FindingsPopover.tsx:77 —
      // ref read during render. Tied to the fixed-position popover measuring logic
      // documented in client/INSIGHTS.md; touch it with that entry open.
      'react-hooks/refs': 'warn',

      // OUTSTANDING (3, one line): pulls/[number]/_components/FindingsTab:22 —
      // `UseMutationResult<any, any, string, any>`. The real type is the cancel-run
      // mutation; replace when that hook gets an exported result type.
      '@typescript-eslint/no-explicit-any': 'warn',

      // OUTSTANDING (1): onboarding/_components/AddRepoView:81 — raw <a> to an
      // internal route; should be next/link.
      '@next/next/no-html-link-for-pages': 'warn',

      // react-hooks/exhaustive-deps ships as `warn` from the plugin.
      // OUTSTANDING (1): pulls/[number]/page.tsx:86 — useMemo missing `runs`.
    },
  },
  {
    // Test files: vitest globals are on (vitest.config.ts sets globals: true).
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, vi: 'readonly' },
    },
  },
);
