// RING 3 — composition wiring. The ONLY file in `_shared/intent/` allowed to
// import `type Container`, `_shared/feature-models.ts` and the
// `_shared/repository/intent.repo.ts` VALUES (precedent: `reviews/service.ts`
// does the same for its own deps) — `derive.ts` itself never does, so it
// stays free of a `no-circular` dependency-cruiser warning against
// `container.ts` (A4).
import type { Container } from '../../../platform/container.js';
import { CHEAP_CHOICES, defaultFeatureModel, resolveUsableFeatureModel } from '../feature-models.js';
import * as intentRepo from '../repository/intent.repo.js';
import { IntentDeriver, type IntentDeriverDeps } from './derive.js';

function buildDeps(container: Container): IntentDeriverDeps {
  return {
    github: () => container.github(),
    resolveLlm: async (workspaceId) => {
      const choice = await resolveUsableFeatureModel(container, workspaceId, 'review_intent', [
        defaultFeatureModel('review_intent'),
        ...CHEAP_CHOICES,
      ]);
      const llm = await container.llm(choice.provider);
      return { choice, llm };
    },
    tokenizer: container.tokenizer,
    getPullWithRepo: (workspaceId, prId) => intentRepo.getPullWithRepo(container.db, workspaceId, prId),
    getPrFiles: (prId) => intentRepo.getPrFilesForIntent(container.db, prId),
    getIntentRow: (prId) => intentRepo.getIntentRow(container.db, prId),
    upsertIntentRow: (prId, values) => intentRepo.upsertIntentRow(container.db, prId, values),
  };
}

/** One `IntentDeriver` per `Container` (A5) — `IntentService` and
 *  `ReviewService` both call this and get back the SAME instance, so a
 *  manual derive and a review-start derive for the same PR share one
 *  in-flight map instead of racing two separate LLM calls. */
const deriversByContainer = new WeakMap<Container, IntentDeriver>();

export function intentDeriverFor(container: Container): IntentDeriver {
  let deriver = deriversByContainer.get(container);
  if (!deriver) {
    deriver = new IntentDeriver(buildDeps(container));
    deriversByContainer.set(container, deriver);
  }
  return deriver;
}
