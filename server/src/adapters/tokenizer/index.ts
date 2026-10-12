/**
 * tokenizer adapter — token counter for the repo-map budget search (T3).
 *
 * The repo-map renderer (pipeline/repo-map.ts) binary-searches the largest set
 * of symbols that fits a token budget; that loop calls `count()` ≤ ~13 times.
 *
 * Default impl: js-tiktoken `cl100k_base` (pure-JS, no natives). The encoder is
 * lazy-initialised (loading the BPE ranks is the heavy part) and any failure
 * falls back to the `ceil(chars / 4)` heuristic — the renderer must never throw.
 *
 * Scope: in-process, ONLY under modules/repo-intel. Swappable in tests via a
 * mock counter (ContainerOverrides.tokenizer).
 */
import { getEncoding, type Tiktoken } from 'js-tiktoken';

export interface Tokenizer {
  count(text: string): number;
}

/** Heuristic fallback used before/instead of a real encoder. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class TiktokenTokenizer implements Tokenizer {
  private enc?: Tiktoken;
  private broken = false;

  count(text: string): number {
    if (this.broken) return approxTokens(text);
    try {
      this.enc ??= getEncoding('cl100k_base');
      // Untrusted text (a project-context doc, a PR body, …) may contain a
      // literal special-token string such as `<|endoftext|>`. js-tiktoken's
      // default `encode` throws on those by design (it assumes the caller
      // controls the input); passing `'all'` as `allowedSpecial` tells it to
      // map each such string to the ONE special token it represents, not to
      // count it as the ~7 plain-text tokens it costs otherwise. Only an
      // actual encoder-load failure (the catch below) should fall back to
      // the heuristic and stay broken for the process, never a single doc.
      return this.enc.encode(text, 'all').length;
    } catch {
      // BPE load failed once — don't retry per call; stick to the heuristic.
      this.broken = true;
      return approxTokens(text);
    }
  }
}
