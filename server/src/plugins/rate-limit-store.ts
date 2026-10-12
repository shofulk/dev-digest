import type { FastifyRateLimitStore, FastifyRateLimitStoreCtor } from '@fastify/rate-limit';

/**
 * Rate-limit store (ring 3, edge: lives in `plugins/` because it imports the `@fastify/rate-limit` types).
 *
 * `@fastify/rate-limit` gives every route that sets `config.rateLimit` its own
 * store (`store.child(...)`), and `groupId` only suffixes the key — so routes with
 * the same `groupId` still count separately. This store hands every route with the
 * same `groupId` the SAME counter, so they share one budget. Routes without a
 * `groupId` get a private counter, exactly as the default store does.
 */

/** Same bound as the library's default `LocalStore` (an LRU of 5000 keys). */
const MAX_KEYS = 5000;

interface Hit {
  current: number;
  ttl: number;
  startedAt: number;
}

class Counter implements FastifyRateLimitStore {
  private readonly hits = new Map<string, Hit>();

  constructor(private readonly groups: Map<string, Counter>) {}

  incr(
    key: string,
    callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
    timeWindow: number,
  ): void {
    const now = Date.now();
    let hit = this.hits.get(key);
    if (!hit || hit.startedAt + timeWindow <= now) {
      hit = { current: 1, ttl: timeWindow, startedAt: now };
    } else {
      hit.current += 1;
      hit.ttl = timeWindow - (now - hit.startedAt);
    }
    // delete + set keeps Map insertion order = recency, so the first key is the LRU one.
    this.hits.delete(key);
    this.hits.set(key, hit);
    if (this.hits.size > MAX_KEYS) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    callback(null, { current: hit.current, ttl: hit.ttl });
  }

  child(routeOptions: { groupId?: string } & object): FastifyRateLimitStore {
    const { groupId } = routeOptions as { groupId?: string };
    if (!groupId) return new Counter(this.groups);
    let shared = this.groups.get(groupId);
    if (!shared) {
      shared = new Counter(this.groups);
      this.groups.set(groupId, shared);
    }
    return shared;
  }
}

/** A store class bound to one app: its groups are never shared with another app instance. */
export function createGroupedRateLimitStore(): FastifyRateLimitStoreCtor {
  const groups = new Map<string, Counter>();
  return class extends Counter {
    constructor() {
      super(groups);
    }
  };
}
