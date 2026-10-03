// Ring 3 — edge. Maps a use case's return value or thrown error into an MCP tool result.
// `isError` is always returned explicitly here — never left to the SDK's throw-to-isError
// conversion (R1) — so guard() is the single seam every tool result passes through, and the
// single place `RESPONSE_MAX_CHARS` is enforced as a last-resort net (C4, rev 4). rev 5:
// `guard` never rejects — even a throwing `toString`/`message` getter or a null-prototype
// throw resolves to a budgeted `isError` result — and every fallback path (including the
// final `.catch`) is routed through the same budget net. No user-facing text literal lives
// in this file any more; it all comes from tools/errors.ts.
import type { CallToolResult } from '@modelcontextprotocol/server';
import { truncate } from '../domain/findings.js';
import { DomainError, type KnownDomainError } from '../domain/errors.js';
import { budgetExceededText, toForwardText, unexpectedErrorText } from './errors.js';

export type ToolResult = CallToolResult;

/** The two size limits every `guard` call needs — `Config` satisfies this structurally. */
export interface GuardLimits {
  responseMaxChars: number;
  textFieldMax: number;
}

/** A successful result: the same JSON as both `structuredContent` and one text block. */
export function ok(obj: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], structuredContent: obj };
}

/** A forward-leading error result. */
export function fail(message: string): ToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function textOf(result: ToolResult): string {
  const block = result.content[0];
  return block && block.type === 'text' ? block.text : '';
}

/**
 * Describes a thrown value as a string, and never throws itself — an unprintable throw
 * (a null-prototype object, a `toString`/`message` getter that throws) must still let
 * `guard` resolve to a forward-leading `isError` result rather than reject (T13).
 */
function describeThrown(err: unknown): string {
  try {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return String(err);
  } catch {
    try {
      return Object.prototype.toString.call(err);
    } catch {
      return 'an unprintable error';
    }
  }
}

function mapError(toolName: string, err: unknown, limits: GuardLimits): ToolResult {
  if (err instanceof DomainError) {
    // The one cast to KnownDomainError: DOMAIN_ERROR_KINDS plus the mutual-assignability
    // assertion in src/domain/errors.ts make every concrete subclass's `kind` a member of
    // KnownDomainError['kind'], so this cast cannot smuggle in an unmapped kind without
    // failing `typecheck` first (S3). toForwardText's own default branch is the runtime net
    // for a `kind` that reaches here anyway (a cast escape hatch, T13).
    return fail(toForwardText(err as KnownDomainError, limits.textFieldMax));
  }
  return fail(unexpectedErrorText(toolName, truncate(describeThrown(err), limits.textFieldMax)));
}

/**
 * The last-resort budget net: an `ok` result whose serialized text still exceeds `maxChars`
 * after every domain-level trim becomes an explicit error rather than silently blowing the
 * budget; a `fail` text is bounded to `maxChars` too (R14).
 */
function enforceBudget(toolName: string, result: ToolResult, maxChars: number): ToolResult {
  const text = textOf(result);
  if (text.length <= maxChars) return result;
  const replacement = result.isError ? text : budgetExceededText(toolName);
  return fail(replacement.slice(0, maxChars));
}

/**
 * Wraps a tool handler: a thrown `DomainError` becomes forward-leading text (via
 * `tools/errors.ts`); anything else — including a non-`Error` throw — becomes a generic
 * error naming the tool. The whole chain is wrapped so `guard` always resolves and never
 * rejects, and every result (success or error) is capped at `maxChars` before it leaves —
 * including the final-catch fallback, so even a throw inside `mapError` itself (e.g.
 * `toForwardText` throwing on a malformed `DomainError`) still returns a budgeted result.
 */
export function guard(toolName: string, limits: GuardLimits, handler: () => Promise<ToolResult>): Promise<ToolResult> {
  return Promise.resolve()
    .then(() => handler())
    .catch((err: unknown) => mapError(toolName, err, limits))
    .then((result) => enforceBudget(toolName, result, limits.responseMaxChars))
    .catch((err: unknown) =>
      enforceBudget(toolName, fail(unexpectedErrorText(toolName, truncate(describeThrown(err), limits.textFieldMax))), limits.responseMaxChars),
    );
}
