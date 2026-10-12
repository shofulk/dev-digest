# `@devdigest/ci` — the CI runner

The runner that DevDigest's "Export to CI" copies into a repository as
`.devdigest/runner/index.js`. A shared GitHub Actions workflow runs it on each pull
request: it reads the exported agent manifests in `.devdigest/agents/*.yaml`, reviews the
diff once per agent through OpenRouter, posts the review, and writes
`devdigest-result.json` for the studio to pull back.

## Build

The runner is built, not committed:

```bash
pnpm --dir ci install
pnpm --dir ci build      # writes exactly one file: ci/dist/index.js
```

`build.mjs` bundles `src/index.ts` with esbuild (ESM, `platform: node`, `target: node22`).
It fails when `dist/` holds any file other than `index.js`, or when `index.js` is larger
than 5,242,880 bytes. The server reads `ci/dist/index.js` on each preview and export; if
it is missing it answers `500 config_error` telling you to run the build above.

## Environment contract

| Variable | Meaning |
|----------|---------|
| `OPENROUTER_API_KEY` | model key, a repository secret. Empty gives every agent `missing_api_key`. |
| `GITHUB_TOKEN` | token to read the pull request and diff and to post reviews |
| `PR_NUMBER` | pull request number |
| `HEAD_SHA` | head commit SHA |

## Result and error codes

The runner always writes `devdigest-result.json` (`CiResultArtifact`): one result per
manifest with verdict (`blocked`, `passed`, `no_findings`, `failed`), findings per
severity, blockers, cost, duration, model and `error_code`. Error codes: `invalid_manifest`,
`missing_api_key`, `diff_fetch_failed`, `model_timeout`, `model_error`.

## Verdicts

Per agent, from the findings that passed the `reviewer-core` grounding gate and the
agent's `ci_fail_on`: `blocked` when at least one finding counts as a blocker, `passed`
when there are findings but no blocker, `no_findings` when there are none, `failed` when
the agent could not run (it carries an error code). Codes: `invalid_manifest` (the
manifest fails `AgentManifest`), `diff_fetch_failed` (the PR or its diff could not be
fetched), `missing_api_key` (empty `OPENROUTER_API_KEY`), `model_error` (the model call
threw), `model_timeout` (no answer within 120 s).

Skill bodies are read from `.devdigest/skills/<entry>.md` for each `skills` entry of the
manifest (an entry is the exact file name without `.md`). Memory lines
come from `.devdigest/memory.jsonl`; invalid lines are ignored.

## Exit rule

The process exits `1` when any result is `blocked` or `failed`, or when there are no manifests (`results: []`, no manifests → 1), else `0`. A failed post
to GitHub is logged and changes neither the verdict nor the exit code.

## Manual check (NFR-2)

After `pnpm --dir ci build`: `wc -c ci/dist/index.js` is at most 5242880, and
`node ci/dist/index.js` runs without any `npm install` beside it.
