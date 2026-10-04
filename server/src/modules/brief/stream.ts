// RING 1 — pure plumbing over `RunBus`/`_shared/sse-stream.ts`. No Fastify,
// no drizzle (`onion-architecture`).
import type { RunEvent } from '@devdigest/shared';
import type { RunBus } from '../../platform/sse.js';
import { runEventStream } from '../_shared/sse-stream.js';

/**
 * D3: `runEventStream` yields `{ id, event: e.kind, data: JSON.stringify(e) }`
 * where `e` is the whole `RunEvent` (bus-level `info`/`result`/`error`). The
 * brief wire format is one level down — the SSE `event:` name is the job's
 * own `BriefJobEvent.type` (`phase`/`done`/`failed`), and `data:` is that
 * event alone, never the bus envelope around it (so a client never sees the
 * `RunBus` publish `msg`, only the typed payload — AC-70).
 */
export async function* briefEventStream(
  bus: RunBus,
  jobId: string,
): AsyncGenerator<{ id: string; event: string; data: string }> {
  for await (const frame of runEventStream(bus, jobId)) {
    const envelope = JSON.parse(frame.data) as RunEvent;
    yield { id: frame.id, event: String((envelope.data as { type: string }).type), data: JSON.stringify(envelope.data) };
  }
}
