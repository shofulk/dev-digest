/**
 * D13 fixtures for the AC-34 opt-in eval. Four project-context documents, each
 * carrying one checkable rule; four diffs, each violating exactly one of
 * them. Every case injects ALL FOUR documents (`DOCS`), so citing the right
 * path in the finding is the discriminating signal, not "the only doc given".
 *
 * Outside `src/`/`test/` — see `score.ts`'s header comment.
 */

export interface EvalCase {
  name: string;
  diff: string;
  expect: { file: string; line: number; docPath: string };
}

export const DOCS: { path: string; content: string }[] = [
  {
    path: 'docs/architecture.md',
    content: '# Architecture\n\nmodule api/ does not import db/ directly.\n',
  },
  {
    path: 'specs/accounts.prd.md',
    content:
      '# Accounts\n\nNo endpoint may expose internal account IDs (`account_internal_id`).\n',
  },
  {
    path: 'docs/payments.md',
    content: '# Payments\n\nMoney amounts are integer cents; never floating-point.\n',
  },
  {
    path: 'specs/webhooks.spec.md',
    content: '# Webhooks\n\nEvery outbound charge request sends an `Idempotency-Key` header.\n',
  },
];

export const CASES: EvalCase[] = [
  {
    name: 'api-imports-db',
    diff: `diff --git a/api/users.ts b/api/users.ts
new file mode 100644
--- /dev/null
+++ b/api/users.ts
@@ -0,0 +1,2 @@
+import { db } from '../db/client';
+export function getUser() { return db; }`,
    expect: { file: 'api/users.ts', line: 1, docPath: 'docs/architecture.md' },
  },
  {
    name: 'exposes-account-id',
    diff: `diff --git a/api/routes/account.ts b/api/routes/account.ts
new file mode 100644
--- /dev/null
+++ b/api/routes/account.ts
@@ -0,0 +1,3 @@
+export function getAccount(req, res) {
+  res.json({ account_internal_id: req.account.internalId, balance: req.account.balance });
+}`,
    expect: { file: 'api/routes/account.ts', line: 2, docPath: 'specs/accounts.prd.md' },
  },
  {
    name: 'money-as-float',
    diff: `diff --git a/billing/charge.ts b/billing/charge.ts
new file mode 100644
--- /dev/null
+++ b/billing/charge.ts
@@ -0,0 +1,2 @@
+export function surcharge(amount: string) {
+  const total = parseFloat(amount) * 1.2;
+}`,
    expect: { file: 'billing/charge.ts', line: 2, docPath: 'docs/payments.md' },
  },
  {
    name: 'charge-without-idempotency',
    diff: `diff --git a/billing/webhook.ts b/billing/webhook.ts
new file mode 100644
--- /dev/null
+++ b/billing/webhook.ts
@@ -0,0 +1,3 @@
+export async function chargeCustomer(url: string, body: unknown) {
+  return fetch(url, { method: 'POST', body: JSON.stringify(body) });
+}`,
    expect: { file: 'billing/webhook.ts', line: 2, docPath: 'specs/webhooks.spec.md' },
  },
];
