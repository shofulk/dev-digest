/**
 * @devdigest/ci entry — the only file that touches process, node:fs or fetch.
 * Wires the real file system, a fetch-based GitHub client and OpenRouter into runCi.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { makeRedactor, runCi, type RunnerDeps } from './run.js';

function githubClient(env: NodeJS.ProcessEnv): RunnerDeps['github'] {
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  const repo = env.GITHUB_REPOSITORY ?? '';
  const call = async (path: string, accept: string, body?: unknown): Promise<Response> => {
    const res = await fetch(`${api}/repos/${repo}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN ?? ''}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return res;
  };
  const json = 'application/vnd.github+json';
  return {
    async getPullRequest(n) {
      const pr = (await (await call(`/pulls/${n}`, json)).json()) as {
        title?: string;
        body?: string | null;
        head?: { sha?: string };
      };
      return { title: pr.title ?? '', body: pr.body ?? '', headSha: pr.head?.sha ?? '' };
    },
    async getDiff(n) {
      return (await call(`/pulls/${n}`, 'application/vnd.github.v3.diff')).text();
    },
    async postReview(n, payload) {
      await call(`/pulls/${n}/reviews`, json, {
        body: payload.body,
        event: payload.event,
        ...(env.HEAD_SHA ? { commit_id: env.HEAD_SHA } : {}),
        ...(payload.comments
          ? { comments: payload.comments.map((c) => ({ ...c, side: 'RIGHT' })) }
          : {}),
      });
    },
    async postComment(n, body) {
      await call(`/issues/${n}/comments`, json, { body });
    },
  };
}

async function main(): Promise<void> {
  const env = process.env;
  const { exitCode } = await runCi({
    env: {
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      GITHUB_TOKEN: env.GITHUB_TOKEN,
      PR_NUMBER: env.PR_NUMBER,
      HEAD_SHA: env.HEAD_SHA,
    },
    devdigestDir: '.devdigest',
    resultPath: 'devdigest-result.json',
    fs: {
      listDir: (p) => {
        try {
          return fs.readdirSync(p);
        } catch {
          return [];
        }
      },
      readText: (p) => {
        try {
          return fs.readFileSync(p, 'utf8');
        } catch {
          return null;
        }
      },
      writeText: (p, t) => fs.writeFileSync(p, t),
    },
    github: githubClient(env),
    llmFor: (key) => new OpenRouterProvider(key),
    log: (line) => console.log(line),
    now: () => Date.now(),
  });
  process.exitCode = exitCode;
}

// Run only when executed directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    const redact = makeRedactor([process.env.OPENROUTER_API_KEY, process.env.GITHUB_TOKEN]);
    console.error(redact(e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  });
}
