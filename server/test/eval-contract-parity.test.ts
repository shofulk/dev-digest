import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * The client's `vendor/shared` is a hand-kept mirror of the server's. The eval
 * contracts must stay byte-identical, so a drift fails here instead of at runtime.
 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('eval contract mirror parity', () => {
  for (const file of ['eval-ci.ts', 'knowledge.ts', 'observability.ts', 'review-api.ts']) {
    it(`${file}: server and client copies are identical`, () => {
      const server = read(`../src/vendor/shared/contracts/${file}`);
      const client = read(`../../client/src/vendor/shared/contracts/${file}`);
      expect(client).toBe(server);
    });
  }
});
