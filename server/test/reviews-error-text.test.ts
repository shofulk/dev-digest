import { describe, expect, it } from 'vitest';
import { errorText } from '../src/modules/reviews/helpers.js';

describe('errorText (D18)', () => {
  it('D18: an Error yields its message', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
  });

  it('D18: a string is returned as is', () => {
    expect(errorText('plain failure')).toBe('plain failure');
  });

  it('D18: a non-Error object yields its string form, never undefined', () => {
    expect(errorText({ code: 1 })).toBe('[object Object]');
    expect(errorText(undefined)).toBe('undefined');
    expect(errorText(null)).toBe('null');
  });
});
