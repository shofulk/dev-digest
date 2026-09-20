import type { Skill, SkillVersionEntry } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

/** Ring 1 — pure mappers from persisted rows to the public DTOs. */

/** Map a persisted skill row to the `Skill` DTO; `tokens` is the exact count of `body`. */
export function toSkillDto(row: SkillRow, tokens?: number | null): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    created_at: row.createdAt.toISOString(),
    ...(tokens !== undefined ? { tokens } : {}),
  };
}

/**
 * Version history, newest first. `skill_versions` only holds bodies that were REPLACED, and
 * each snapshot of v(n) carries the note supplied for the edit that produced v(n+1) — so an
 * entry's own note and date come from the snapshot one step older (its predecessor), and the
 * current version's from the newest snapshot. v1 has no note; it became current at creation.
 * The current version's entry is synthesised from the skill itself.
 */
export function toVersionEntries(
  skill: SkillRow,
  snapshots: SkillVersionRow[],
): SkillVersionEntry[] {
  const becameCurrent = (predecessor: SkillVersionRow | undefined) =>
    (predecessor?.createdAt ?? skill.createdAt).toISOString();
  return [
    {
      version: skill.version,
      note: snapshots[0]?.note ?? null,
      created_at: becameCurrent(snapshots[0]),
      is_current: true,
    },
    ...snapshots.map((s, i) => ({
      version: s.version,
      note: snapshots[i + 1]?.note ?? null,
      created_at: becameCurrent(snapshots[i + 1]),
      is_current: false,
    })),
  ];
}
