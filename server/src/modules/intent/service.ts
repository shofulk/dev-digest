// RING 1 — application service. Orchestrates the intent read/derive use case
// through the shared deriver (`intentDeriverFor(container)`), resolved ONCE
// in the constructor — no `container`/`db` field kept, no persistence-layer
// import (A2/A3): every read and write goes through the deriver's `read` /
// `derive` methods (C1).
import type { Container } from '../../platform/container.js';
import type { PrIntentRecord } from '@devdigest/shared';
import { intentDeriverFor } from '../_shared/intent/deps.js';
import type { IntentDeriver, Logger } from '../_shared/intent/derive.js';
import type { IntentDerivationStats } from '../_shared/intent/helpers.js';

export class IntentService {
  private deriver: IntentDeriver;

  constructor(container: Container) {
    this.deriver = intentDeriverFor(container);
  }

  /** `null` when never derived; 404 when the PR isn't in the workspace. Makes
   *  NO LLM call — a pure read. */
  getForPr(workspaceId: string, prId: string): Promise<PrIntentRecord | null> {
    return this.deriver.read(workspaceId, prId);
  }

  /**
   * On-demand derive (`POST /pulls/:id/intent/derive`, D2/D7). `routeLog` is
   * the request logger, passed in as an argument (never captured from the
   * route) — this method owns ALL route-path logging (stats + per-source
   * warnings), so `intent/routes.ts` itself logs nothing (A7).
   */
  async derive(
    workspaceId: string,
    prId: string,
    routeLog: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void },
  ): Promise<{ record: PrIntentRecord; stats: IntentDerivationStats }> {
    const lineLog: Logger = { info: (msg) => routeLog.info(msg) };
    const { record, stats } = await this.deriver.derive(workspaceId, prId, lineLog);
    routeLog.info({ intent: stats, prId }, 'intent: derived');
    for (const s of stats.sources) {
      if (s.status !== 'used') routeLog.warn({ kind: s.kind, ref: s.ref, reason: s.reason }, 'intent: source unavailable');
    }
    return { record, stats };
  }
}
