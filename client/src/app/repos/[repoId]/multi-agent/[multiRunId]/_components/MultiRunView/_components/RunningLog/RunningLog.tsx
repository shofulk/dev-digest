/* RunningLog — the live log of one running agent run, rendered by the shared LiveLogStream
   (same as the PR page, A-8). Holds no stream: the page opens one shared stream for all running
   columns (useMultiRunEvents, C14) and passes this run's events in. */
"use client";

import { LiveLogStream } from "@devdigest/ui";
import type { RunEvent } from "@devdigest/shared";
import { eventsToLog } from "@/components/run-trace-drawer/helpers";

const LOG_HEIGHT = 180;

export function RunningLog({ events, running }: { events: RunEvent[]; running: boolean }) {
  return <LiveLogStream log={eventsToLog(events)} running={running} height={LOG_HEIGHT} />;
}
