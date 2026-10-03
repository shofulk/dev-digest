// Ring 0 — domain. Every failure that leaves the adapter or a use case. Data only: the
// user-facing, forward-leading text is built at the edge (src/tools/errors.ts), which is
// the only place that knows tool names. `kind` makes the union exhaustively switchable.
//
// rev 4: `DomainErrorKind` is a closed literal union (not `string`), so a subclass with a
// `kind` outside this list fails `typecheck` — real exhaustiveness, not a convention.

/** Every `kind` value a DomainError subclass may declare. */
export const DOMAIN_ERROR_KINDS = [
  'api_unreachable',
  'rate_limited',
  'api_failure',
  'repo_not_found',
  'repo_ambiguous',
  'pr_not_imported',
  'agent_not_found',
  'agent_ambiguous',
  'agent_disabled',
  'no_run',
  'run_not_found',
  'run_not_started',
  'review_missing',
] as const;

export type DomainErrorKind = (typeof DOMAIN_ERROR_KINDS)[number];

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;
}

// ---- Infrastructure (thrown by the API adapter) ----

export class ApiUnreachable extends DomainError {
  readonly kind = 'api_unreachable' as const;
  constructor(readonly url: string) {
    super(`DevDigest API not reachable at ${url}`);
  }
}

export class RateLimited extends DomainError {
  readonly kind = 'rate_limited' as const;
  constructor(readonly url: string) {
    super(`DevDigest API rate limit hit at ${url}`);
  }
}

export class ApiFailure extends DomainError {
  readonly kind = 'api_failure' as const;
  constructor(
    readonly status: number,
    readonly url: string,
    readonly detail: string,
  ) {
    super(`DevDigest API ${status} at ${url}: ${detail}`);
  }
}

// ---- Use cases (thrown by src/app) ----

export class RepoNotFound extends DomainError {
  readonly kind = 'repo_not_found' as const;
  constructor(
    readonly query: string,
    readonly known: string[],
  ) {
    super(`Repository "${query}" not found`);
  }
}

export class RepoAmbiguous extends DomainError {
  readonly kind = 'repo_ambiguous' as const;
  constructor(
    readonly query: string,
    readonly matches: string[],
  ) {
    super(`Repository "${query}" is ambiguous`);
  }
}

export class PrNotImported extends DomainError {
  readonly kind = 'pr_not_imported' as const;
  constructor(
    readonly repo: string,
    readonly pr: number,
  ) {
    super(`PR #${pr} of ${repo} is not in DevDigest`);
  }
}

export class AgentNotFound extends DomainError {
  readonly kind = 'agent_not_found' as const;
  constructor(readonly query: string) {
    super(`Agent "${query}" not found`);
  }
}

export class AgentAmbiguous extends DomainError {
  readonly kind = 'agent_ambiguous' as const;
  constructor(
    readonly query: string,
    readonly ids: string[],
  ) {
    super(`Agent name "${query}" is ambiguous`);
  }
}

export class AgentDisabled extends DomainError {
  readonly kind = 'agent_disabled' as const;
  constructor(readonly name: string) {
    super(`Agent "${name}" is disabled`);
  }
}

export class NoRun extends DomainError {
  readonly kind = 'no_run' as const;
  constructor(
    readonly repo: string,
    readonly pr: number,
    readonly agent: string | null,
  ) {
    super(`No review run on ${repo}#${pr}${agent ? ` for agent "${agent}"` : ''}`);
  }
}

export class RunNotFound extends DomainError {
  readonly kind = 'run_not_found' as const;
  constructor(
    readonly runId: string,
    readonly repo: string,
    readonly pr: number,
  ) {
    super(`Run ${runId} not found on ${repo}#${pr}`);
  }
}

export class RunNotStarted extends DomainError {
  readonly kind = 'run_not_started' as const;
  constructor() {
    super('DevDigest accepted the review request but started no run');
  }
}

export class ReviewMissing extends DomainError {
  readonly kind = 'review_missing' as const;
  constructor(readonly runId: string) {
    super(`Run ${runId} finished but its review is gone`);
  }
}

export type KnownDomainError =
  | ApiUnreachable
  | RateLimited
  | ApiFailure
  | RepoNotFound
  | RepoAmbiguous
  | PrNotImported
  | AgentNotFound
  | AgentAmbiguous
  | AgentDisabled
  | NoRun
  | RunNotFound
  | RunNotStarted
  | ReviewMissing;

// A kind added to DOMAIN_ERROR_KINDS without a matching class in KnownDomainError (or the
// reverse) fails here (T14). Plain mutual `extends` checks over unions do not catch this: a
// union member with no counterpart on the other side just contributes `never` to a
// distributed conditional, which is absorbed away and hides the mismatch. Wrapping both
// sides in an invariant function-type position (the standard exact-type-equality trick)
// avoids that distribution, so an added or removed kind on either side actually changes the
// compared type and breaks the `true` assignment below.
type IsExactly<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertMutuallyAssignable<A, B> = IsExactly<A, B> extends true ? true : never;
const _domainErrorKindsMatchKnownDomainError: AssertMutuallyAssignable<
  DomainErrorKind,
  KnownDomainError['kind']
> = true;
void _domainErrorKindsMatchKnownDomainError;

/** Transport-level failures a polling loop may ride out. */
export function isTransient(err: unknown): boolean {
  return err instanceof ApiUnreachable || err instanceof RateLimited || err instanceof ApiFailure;
}
