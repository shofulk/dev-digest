import { describe, expect, it } from 'vitest';
import { DomainError, type DomainErrorKind } from '../src/domain/errors.js';
import { guard, ok, type GuardLimits } from '../src/tools/result.js';

const LIMITS: GuardLimits = { responseMaxChars: 20_000, textFieldMax: 500 };

// A test-local DomainError subclass whose `kind` is cast to a value outside
// DomainErrorKind — the runtime-only escape hatch T14's typecheck controls cannot reach,
// because `as DomainErrorKind` bypasses the compile-time check on purpose.
class UnmappedError extends DomainError {
  readonly kind = 'totally_unmapped' as unknown as DomainErrorKind;
  constructor() {
    super('unmapped domain error');
  }
}

// A DomainError whose `kind` is cast to a real, mapped value ('repo_not_found') but is
// missing the fields toForwardText's switch branch reads (`known`) — so toForwardText
// itself throws while mapError is building the result (rev 5, T13 final-catch path).
class MalformedRepoNotFound extends DomainError {
  readonly kind = 'repo_not_found' as const;
  constructor() {
    super('malformed repo_not_found');
  }
}

describe('guard', () => {
  it('resolves (never rejects) an unmapped DomainError kind to isError with non-empty text', async () => {
    const result = await guard('some_tool', LIMITS, () => {
      throw new UnmappedError();
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
  });

  it('a plain Error becomes isError naming the tool', async () => {
    const result = await guard('some_tool', LIMITS, () => {
      throw new Error('boom');
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('some_tool');
  });

  it('a thrown non-Error value becomes isError', async () => {
    const result = await guard('some_tool', LIMITS, () => Promise.reject('stringy failure'));
    expect(result.isError).toBe(true);
  });

  it('an ok result whose text exceeds maxChars becomes isError with the budget-exceeded text', async () => {
    const big = { data: 'x'.repeat(1000) };
    const result = await guard('some_tool', { responseMaxChars: 100, textFieldMax: 500 }, () => Promise.resolve(ok(big)));
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(100);
    expect(text).toMatch(/budget/i);
  });

  it('a fail text over maxChars is truncated to maxChars', async () => {
    const result = await guard('some_tool', { responseMaxChars: 50, textFieldMax: 500 }, () => {
      throw new Error('x'.repeat(500));
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(50);
  });

  it('a throw of a null-prototype object resolves to isError naming the tool', async () => {
    const result = await guard('some_tool', LIMITS, () => {
      throw Object.create(null);
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('some_tool');
  });

  it('a thrown object whose toString throws resolves to isError naming the tool', async () => {
    const evil = {
      toString() {
        throw new Error('toString exploded');
      },
    };
    const result = await guard('some_tool', LIMITS, () => {
      throw evil;
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('some_tool');
  });

  it('an Error whose message is 100,000 chars resolves isError, clipped and budgeted', async () => {
    const result = await guard('some_tool', LIMITS, () => {
      throw new Error('x'.repeat(100_000));
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain('x'.repeat(501));
    expect(text.length).toBeLessThanOrEqual(LIMITS.responseMaxChars);
  });

  it('a throw inside mapError itself (toForwardText throwing) still resolves via the final catch, budgeted', async () => {
    const result = await guard('some_tool', LIMITS, () => {
      throw new MalformedRepoNotFound();
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(LIMITS.responseMaxChars);
  });
});
