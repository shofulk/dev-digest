// Ring 3 — edge / composition root. The only file allowed to read `process.env` (C1).
// Every value has a default so the server boots with zero configuration, per the repo
// convention that the app boots with no keys/settings until the user provides them.

export interface Config {
  /** Base URL of the DevDigest HTTP API, no trailing slash. */
  readonly apiBaseUrl: string;
  /** How long run_agent_on_pr waits for a run to finish before returning "running" (C6). */
  readonly runWaitMs: number;
  /** Poll interval while waiting for a run (C6). */
  readonly pollMs: number;
  /** Per-HTTP-request timeout (C6). */
  readonly requestTimeoutMs: number;
  /** Hard cap on a tool response's serialized text length (C4). */
  readonly responseMaxChars: number;
  /** Truncation length for free-text fields such as rationale/suggestion (C4). */
  readonly textFieldMax: number;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    apiBaseUrl: stripTrailingSlash(env.DEVDIGEST_API_URL ?? 'http://localhost:3001'),
    runWaitMs: 100_000,
    pollMs: 3_000,
    requestTimeoutMs: 30_000,
    responseMaxChars: 20_000,
    textFieldMax: 500,
  };
}
