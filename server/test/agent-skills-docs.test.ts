import { describe, it, expect } from 'vitest';
import { selectIncludedSkillDocs, selectIncludedSkills, type AgentSkillRow } from '../src/modules/_shared/agent-skills.js';

/**
 * T-gap-1 (after, L10) — direct hermetic unit test for `selectIncludedSkillDocs`
 * (D7: server/INSIGHTS.md and .harness/runs/project-context/04-test-writer-L3.md's
 * open issue — T1 could not cover this directly since the function did not exist
 * yet at L3; it landed in L6). No DB, no network: pure gate/order logic over rows.
 */

function row(over: Partial<AgentSkillRow> & { id: string }): AgentSkillRow {
  return {
    name: over.id,
    version: 1,
    body: `body of ${over.id}`,
    order: 0,
    linkEnabled: true,
    skillEnabled: true,
    contextDocs: [],
    ...over,
  };
}

describe('selectIncludedSkillDocs', () => {
  it('excludes a link-disabled skill and a globally-disabled skill', () => {
    const rows: AgentSkillRow[] = [
      row({ id: 'both', order: 0, contextDocs: ['docs/both.md'] }),
      row({ id: 'link-off', order: 1, linkEnabled: false, contextDocs: ['docs/link-off.md'] }),
      row({ id: 'global-off', order: 2, skillEnabled: false, contextDocs: ['docs/global-off.md'] }),
      row({ id: 'both-off', order: 3, linkEnabled: false, skillEnabled: false, contextDocs: ['docs/both-off.md'] }),
    ];

    const out = selectIncludedSkillDocs(rows);

    expect(out).toEqual([{ name: 'both', contextDocs: ['docs/both.md'] }]);
  });

  it('keeps the same (order, name) ordering as selectIncludedSkills, over the same gated input', () => {
    const rows: AgentSkillRow[] = [
      row({ id: 'c', name: 'Zeta', order: 0, contextDocs: ['specs/zeta.md'] }),
      row({ id: 'a', name: 'Beta', order: 1, contextDocs: ['specs/beta.md'] }),
      row({ id: 'b', name: 'Alpha', order: 1, contextDocs: ['specs/alpha.md'] }),
      row({ id: 'd', name: 'Omega', order: 2, linkEnabled: false, contextDocs: ['specs/omega.md'] }),
    ];

    const skills = selectIncludedSkills(rows);
    const docs = selectIncludedSkillDocs(rows);

    // Same gate, same order, same skill names in the same positions — the two
    // functions must never disagree on which rows survive or in what sequence.
    expect(docs.map((d) => d.name)).toEqual(skills.map((s) => s.name));
    expect(docs.map((d) => d.name)).toEqual(['Zeta', 'Alpha', 'Beta']);
  });

  it('returns each included skill\'s own contextDocs array, unchanged', () => {
    const rows: AgentSkillRow[] = [
      row({ id: 'x', name: 'X', order: 0, contextDocs: ['docs/x1.md', 'specs/x2.md'] }),
    ];

    expect(selectIncludedSkillDocs(rows)).toEqual([{ name: 'X', contextDocs: ['docs/x1.md', 'specs/x2.md'] }]);
  });

  it('returns [] when nothing is linked or nothing passes the gates', () => {
    expect(selectIncludedSkillDocs([])).toEqual([]);
    expect(selectIncludedSkillDocs([row({ id: 'off', linkEnabled: false, contextDocs: ['docs/off.md'] })])).toEqual([]);
  });
});
