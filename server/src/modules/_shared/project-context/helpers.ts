// RING 1 — pure application helpers. No DB, no container, no Fastify
// (`onion-architecture`). Imports only `@devdigest/shared` types.
import type { ContextDocType } from '@devdigest/shared';

/**
 * Syntax-only check on a document path (D6): relative, no leading `/` or drive
 * letter, no backslash, no NUL, no `..` segment, ends with `.md`
 * (case-insensitive), at most 512 characters. A save additionally requires
 * `projectDocs.matchesRoots` — that is the caller's job, not this function's.
 */
export function checkDocPathSyntax(path: string): boolean {
  if (path.length === 0 || path.length > 512) return false;
  if (path.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  if (path.includes('\\')) return false;
  if (path.includes('\0')) return false;
  if (path.split('/').includes('..')) return false;
  if (!/\.md$/i.test(path)) return false;
  return true;
}

/**
 * The search-root bucket a document belongs to: the first path segment equal
 * to `specs`, `docs` or `insights`, else `'docs'` (D6).
 */
export function docTypeFor(path: string): ContextDocType {
  for (const segment of path.split('/')) {
    if (segment === 'specs' || segment === 'docs' || segment === 'insights') return segment;
  }
  return 'docs';
}
