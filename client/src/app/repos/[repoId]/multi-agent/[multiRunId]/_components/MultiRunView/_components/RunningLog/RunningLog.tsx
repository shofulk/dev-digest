/* RunningLog — the live log of one running agent run: the run's SSE stream through
   useRunEvents, rendered by the shared LiveLogStream (same as the PR page, A-8). Mounted
   only while the run is `running`, so the stream opens and closes with the status. */
"use client";

import { LiveLogStream } from "@devdigest/ui";
import { useRunEvents } from "@/lib/hooks/reviews";
import { eventsToLog } from "@/components/run-trace-drawer/helpers";

const LOG_HEIGHT = 180;

export function RunningLog({ runId }: { runId: string }) {
  const { events, running } = useRunEvents([runId]);
  return <LiveLogStream log={eventsToLog(events)} running={running} height={LOG_HEIGHT} />;
}
