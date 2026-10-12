// RING 1 — application / cross-module helpers (`onion-architecture`). Port
// types only (`ProjectDocsSource` from `@devdigest/shared`, `Tokenizer`'s
// type); no `node:fs`, no `drizzle-orm`, no Fastify.
import type { ContextDocTrace, ProjectDocsSource } from '@devdigest/shared';
import type { Tokenizer } from '../../../adapters/tokenizer/index.js';

/** One path in the resolved attach order, tagged with where it came from. */
export interface DocOrderItem {
  path: string;
  /** `'agent'` for the agent's own list, else the skill's name. */
  origin: string;
}

/**
 * Resolution order (D7): agent docs first (origin `agent`), then each
 * included skill's docs in skill order (origin = skill name). A path keeps
 * only its first position.
 */
export function resolveDocOrder(
  agentDocs: string[],
  skills: { name: string; contextDocs: string[] }[],
): DocOrderItem[] {
  const seen = new Set<string>();
  const order: DocOrderItem[] = [];
  for (const path of agentDocs) {
    if (seen.has(path)) continue;
    seen.add(path);
    order.push({ path, origin: 'agent' });
  }
  for (const skill of skills) {
    for (const path of skill.contextDocs) {
      if (seen.has(path)) continue;
      seen.add(path);
      order.push({ path, origin: skill.name });
    }
  }
  return order;
}

/**
 * Drops whole items from the end of the resolved order until the token sum
 * fits `budgetTokens` (D7). `tokensOf` reads an item's token count. Greedy:
 * keeps the longest prefix whose running total still fits.
 */
export function applyBudget<T>(
  items: T[],
  budgetTokens: number,
  tokensOf: (item: T) => number = () => 0,
): T[] {
  const kept: T[] = [];
  let sum = 0;
  for (const item of items) {
    const tokens = tokensOf(item);
    if (sum + tokens > budgetTokens) break;
    kept.push(item);
    sum += tokens;
  }
  return kept;
}

/** One agent's resolved set of attached paths (direct + enabled-skill), for `countUsedBy`. */
export interface AgentDocUsage {
  agentId: string;
  paths: string[];
}

/** Count of agents/enabled-skills that attach a given path (D7). */
export function countUsedBy(paths: string[], usage: AgentDocUsage[]): number {
  const wanted = new Set(paths);
  return usage.filter((u) => u.paths.some((p) => wanted.has(p))).length;
}

export interface ResolveProjectContextInput {
  /** The repo's synced checkout root, or `null` (every path then `missing`). */
  checkoutRoot: string | null;
  agentDocs: string[];
  skills: { name: string; contextDocs: string[] }[];
  roots: string[];
  budgetTokens: number;
  maxDocBytes: number;
  source: ProjectDocsSource;
  tokenizer: Tokenizer;
}

export interface ResolveProjectContextResult {
  specs: { path: string; content: string }[];
  trace: ContextDocTrace[];
  specsRead: string[];
  /** Path, tokens and status only (NFR-7) — never document content. */
  logLines: string[];
}

/**
 * Resolves the documents a run should inject: order → read → budget → trace.
 * Never throws — an unexpected read error becomes `missing` plus a log line
 * (D7). `logLines` carry only path, tokens and status, never content (NFR-7).
 */
export async function resolveProjectContext(
  input: ResolveProjectContextInput,
): Promise<ResolveProjectContextResult> {
  const { checkoutRoot, agentDocs, skills, roots, budgetTokens, maxDocBytes, source, tokenizer } =
    input;
  const order = resolveDocOrder(agentDocs, skills);
  const trace: ContextDocTrace[] = [];
  const logLines: string[] = [];
  const read: { path: string; origin: string; content: string; tokens: number }[] = [];

  for (const { path, origin } of order) {
    if (checkoutRoot === null) {
      trace.push({ path, origin, tokens: null, status: 'missing' });
      logLines.push(`${path} missing`);
      continue;
    }
    let result;
    try {
      result = await source.read(checkoutRoot, path, { roots, maxBytes: maxDocBytes });
    } catch {
      result = { status: 'missing' as const };
    }
    if (result.status !== 'ok') {
      trace.push({ path, origin, tokens: null, status: result.status });
      logLines.push(`${path} ${result.status}`);
      continue;
    }
    const tokens = tokenizer.count(result.content);
    read.push({ path, origin, content: result.content, tokens });
  }

  const kept = applyBudget(read, budgetTokens, (item) => item.tokens);
  const keptPaths = new Set(kept.map((item) => item.path));
  for (const item of read) {
    const status = keptPaths.has(item.path) ? 'included' : 'budget';
    trace.push({ path: item.path, origin: item.origin, tokens: item.tokens, status });
    logLines.push(`${item.path} ${status} ${item.tokens}`);
  }

  return {
    specs: kept.map((item) => ({ path: item.path, content: item.content })),
    trace,
    specsRead: kept.map((item) => item.path),
    logLines,
  };
}
