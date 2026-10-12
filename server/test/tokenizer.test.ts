import { describe, it, expect } from 'vitest';
import { TiktokenTokenizer, approxTokens } from '../src/adapters/tokenizer/index.js';

/**
 * F16 (fix round 3) — untrusted text containing a literal special-token
 * string (e.g. `<|endoftext|>`) must count exactly, not flip the shared
 * tokenizer instance to the `approxTokens` heuristic for every later call.
 */
describe('TiktokenTokenizer', () => {
  it('counts text containing a special-token string exactly, without breaking', () => {
    const tokenizer = new TiktokenTokenizer();
    const withSpecialToken = 'before <|endoftext|> after';

    const count = tokenizer.count(withSpecialToken);

    // A real encode count for this short string is well under the heuristic
    // ceil(length/4), which would be used only if the call fell back.
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(approxTokens(withSpecialToken));
  });

  it('keeps giving exact counts for later, ordinary text after a special-token doc', () => {
    const tokenizer = new TiktokenTokenizer();
    tokenizer.count('before <|endoftext|> after');

    const normalText = 'the quick brown fox jumps over the lazy dog';
    const count = tokenizer.count(normalText);

    // Not the heuristic value — proves `broken` was never set.
    expect(count).not.toBe(approxTokens(normalText));
    expect(count).toBeGreaterThan(0);
  });
});
