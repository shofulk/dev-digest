// RING 3 — composition wiring. The only brief file allowed to import `type
// Container` and build a concrete `BriefRepository`/`BriefService` from it
// (precedent: `_shared/intent/deps.ts`). `service.ts`/`facts.ts`/`prompt.ts`/
// `grounding.ts` never see `Container` (`onion-architecture`).
import type { Severity } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { CHEAP_CHOICES, resolveUsableFeatureModel } from '../_shared/feature-models.js';
import { intentDeriverFor } from '../_shared/intent/deps.js';
import { BriefRepository } from './repository.js';
import type { BriefReview, BriefServiceDeps } from './service.js';

/** Builds `BriefServiceDeps` from the container (D6/D11). `readBlast` is
 *  injected by `routes.ts`, which owns the one `BlastService` instance
 *  (EDGE exemption — `../blast/service.js` is only ever imported there). */
export function buildBriefServiceDeps(
  container: Container,
  readBlast: BriefServiceDeps['readBlast'],
): BriefServiceDeps {
  const repo = new BriefRepository(container.db);

  return {
    getPull: (workspaceId, prId) => repo.getPull(workspaceId, prId),
    getPrFiles: (prId) => repo.getPrFiles(prId),
    getBrief: (prId) => repo.getBrief(prId),
    saveBrief: (brief) => repo.saveBrief(brief),
    readIntent: (workspaceId, prId) => intentDeriverFor(container).read(workspaceId, prId),
    readBlast,
    listReviews: async (prId) => {
      const rows = await container.reviewRepo.reviewsForPull(prId);
      return rows.map(
        ({ review, findings }): BriefReview => ({
          kind: review.kind as 'summary' | 'review',
          agentId: review.agentId,
          createdAt: review.createdAt,
          findings: findings.map((f) => ({
            title: f.title,
            // `FindingRow.severity` is `text` at the DB column (`src/db/schema/reviews.ts`),
            // so Drizzle infers `string` — same cast precedent as
            // `modules/reviews/helpers.ts`'s `row.severity as Finding['severity']`.
            severity: f.severity as Severity,
            file: f.file,
            startLine: f.startLine,
            endLine: f.endLine,
            rationale: f.rationale,
            suggestion: f.suggestion,
            dismissedAt: f.dismissedAt,
          })),
        }),
      );
    },
    listEnabledAgentDocs: async (workspaceId) => {
      const agents = await container.agentsRepo.listEnabled(workspaceId);
      const skillSets = await container.agentSkills.resolveAgentSkillSets(agents.map((a) => a.id));
      return agents.map((agent) => ({
        contextDocs: agent.contextDocs ?? [],
        skills: skillSets.get(agent.id)?.docSources ?? [],
      }));
    },
    projectDocs: container.projectDocs,
    docRoots: container.config.projectContext.roots,
    maxDocBytes: container.config.projectContext.maxDocBytes,
    tokenizer: container.tokenizer,
    resolveLlm: async (workspaceId) => {
      const choice = await resolveUsableFeatureModel(container, workspaceId, 'risk_brief', CHEAP_CHOICES);
      const llm = await container.llm(choice.provider);
      return { choice, llm };
    },
    bus: container.runBus,
  };
}
