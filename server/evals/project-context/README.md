# Project Context eval (AC-34)

Opt-in, costs real API calls. Never runs in CI, never part of `test`,
`typecheck` or `lint`.

Checks that an agent, given the four fixture Project Context documents in
`cases.ts`, reports a finding on the right file/line **and names the right
document path** for each of four violations (an `api/` → `db/` import, an
exposed internal account id, money handled as a float, and a charge request
missing its idempotency key).

## Run

```
DEVDIGEST_EVAL=1 EVAL_MODEL=<model> pnpm --dir server eval:project-context
```

`EVAL_MODEL` is required (e.g. `openai/gpt-4.1`, `anthropic/claude-sonnet-4`,
or any OpenRouter-routable id). The key is read via `LocalSecretsProvider`
(`OPENROUTER_API_KEY`, from Settings or `~/.devdigest/secrets.json`).

Exit codes: `0` passed or skipped, `1` a case failed (or the provider could
not be built), `2` `DEVDIGEST_EVAL=1` but `EVAL_MODEL` is missing.

Cost: one model call per case (4 calls per run). Pick a cheap model for a
quick sanity check; the real acceptance bar (AC-34) is any model that
reliably names the violated document.
