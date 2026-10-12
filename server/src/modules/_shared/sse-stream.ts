import type { RunEvent } from '@devdigest/shared';
import type { RunBus } from '../../platform/sse.js';

/**
 * Bridge a `RunBus` run to the async iterator the SSE plugin drains.
 *
 * Every long-running feature (reviews, convention scans) publishes progress on
 * the same bus, so the queue/promise plumbing that turns a push-based emitter
 * into a pull-based generator lives here once instead of being re-inlined in
 * each module's `routes.ts`.
 *
 * Semantics, unchanged from the reviews route this was lifted from:
 *  - `subscribe` replays the buffered events first, so a late subscriber still
 *    sees the whole run;
 *  - `onDone` fires immediately for an already-completed run, which is what
 *    ends the stream instead of hanging it open;
 *  - the queue is drained BEFORE the done flag is honoured, so the last events
 *    published just before `complete()` are never lost;
 *  - both listeners are released in `finally`, whether the client disconnected
 *    or the run ended.
 *
 * Deliberately free of Fastify and Drizzle: it is plumbing over the bus, and
 * the caller does `reply.sse(runEventStream(bus, id))`.
 */
export async function* runEventStream(
  bus: RunBus,
  id: string,
): AsyncGenerator<{ id: string; event: string; data: string }> {
  const queue: RunEvent[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const unsubscribe = bus.subscribe(id, (e) => {
    queue.push(e);
    resolve?.();
  });
  const offDone = bus.onDone(id, () => {
    done = true;
    resolve?.();
  });

  try {
    while (true) {
      if (queue.length === 0) {
        if (done) break;
        await new Promise<void>((r) => (resolve = r));
        resolve = null;
        continue;
      }
      const e = queue.shift()!;
      yield {
        id: String(e.seq),
        event: e.kind,
        data: JSON.stringify(e),
      };
    }
  } finally {
    unsubscribe();
    offDone();
  }
}

/**
 * One SSE stream for several runs of a multi-run. Same semantics as
 * `runEventStream` for every id at once (replay first, drain before honouring
 * done, release every listener in `finally`). Events are framed with
 * `id: "<runId>:<seq>"`; the stream ends once every id has completed. `settledIds`
 * (already finished in the DB) count as completed up front, after their buffer is replayed.
 */
export async function* mergedRunEventStream(
  bus: RunBus,
  runIds: string[],
  settledIds: string[] = [],
): AsyncGenerator<{ id: string; event: string; data: string }> {
  const ids = [...new Set(runIds)];
  const queue: RunEvent[] = [];
  let resolve: (() => void) | null = null;
  // A Set, not a counter: an id can be both settled in the DB and signalled done by the bus.
  const done = new Set(settledIds.filter((id) => ids.includes(id)));

  const releases: (() => void)[] = [];
  for (const runId of ids) {
    releases.push(
      bus.subscribe(runId, (e) => {
        queue.push(e);
        resolve?.();
      }),
    );
    releases.push(
      bus.onDone(runId, () => {
        done.add(runId);
        resolve?.();
      }),
    );
  }

  try {
    while (true) {
      if (queue.length === 0) {
        if (done.size >= ids.length) break;
        await new Promise<void>((r) => (resolve = r));
        resolve = null;
        continue;
      }
      const e = queue.shift()!;
      yield {
        id: `${e.runId}:${e.seq}`,
        event: e.kind,
        data: JSON.stringify(e),
      };
    }
  } finally {
    for (const release of releases) release();
  }
}
