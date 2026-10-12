// RING 1 — pure application constants. No DB, no container, no Fastify
// (`onion-architecture`). Imports nothing but literals.

/** Hard cap on documents listed/scanned for one repo (NFR-6). */
export const MAX_CONTEXT_DOCS = 1000;
