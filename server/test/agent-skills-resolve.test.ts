import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '@devdigest/reviewer-core';
import {
  formatSkillBlock,
  selectIncludedSkills,
  skillsForPrompt,
  type AgentSkillRow,
} from '../src/modules/_shared/agent-skills.js';

/**
 * Skill resolution (spec D/E, criteria 25-27): the two-gate rule, the
 * (order, name) ordering and the `### <name>` prefix are pure over rows — no DB.
 */

function row(over: Partial<AgentSkillRow> & { id: string }): AgentSkillRow {
  return {
    name: over.id,
    version: 1,
    body: `body of ${over.id}`,
    order: 0,
    linkEnabled: true,
    skillEnabled: true,
    ...over,
  };
}

describe('selectIncludedSkills', () => {
  it('orders by link order first, then by name', () => {
    const out = selectIncludedSkills([
      row({ id: 'c', name: 'Zeta', order: 0 }),
      row({ id: 'a', name: 'Beta', order: 1 }),
      row({ id: 'b', name: 'Alpha', order: 1 }),
      row({ id: 'd', name: 'Omega', order: 2 }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('applies both gates: link.enabled AND skill.enabled', () => {
    const out = selectIncludedSkills([
      row({ id: 'both', order: 0 }),
      row({ id: 'link-off', order: 1, linkEnabled: false }),
      row({ id: 'global-off', order: 2, skillEnabled: false }),
      row({ id: 'both-off', order: 3, linkEnabled: false, skillEnabled: false }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['both']);
  });

  it('returns only id, name, version and body', () => {
    const [s] = selectIncludedSkills([row({ id: 'x', name: 'X', version: 4, body: 'B', order: 9 })]);
    expect(s).toEqual({ id: 'x', name: 'X', version: 4, body: 'B' });
  });

  it('does not mutate its input', () => {
    const rows = [row({ id: 'b', order: 1 }), row({ id: 'a', order: 0 })];
    selectIncludedSkills(rows);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('returns [] when nothing is linked or nothing passes the gates', () => {
    expect(selectIncludedSkills([])).toEqual([]);
    expect(selectIncludedSkills([row({ id: 'off', linkEnabled: false })])).toEqual([]);
  });
});

describe('formatSkillBlock', () => {
  it('prefixes the body with ### <name> and a blank line', () => {
    expect(formatSkillBlock({ name: 'no-over-mocking', body: 'Prefer real collaborators.' })).toBe(
      '### no-over-mocking\n\nPrefer real collaborators.',
    );
  });
});

describe('skillsForPrompt + assemblePrompt', () => {
  const BASE = {
    system: 'You are a reviewer.',
    diff: '@@ -1 +1 @@\n+stripeKey',
    task: "Review PR #482 'rate limit'",
  } as const;

  it('zero skills: prompt and assembly are byte-identical to a skill-less run', () => {
    const skills = skillsForPrompt([]);
    expect(skills).toBeUndefined();

    const withHelper = assemblePrompt({ ...BASE, ...(skills ? { skills } : {}) });
    const baseline = assemblePrompt({ ...BASE });
    expect(withHelper).toEqual(baseline);
    expect(withHelper.messages[1]!.content).not.toContain('## Skills / rules');
    expect(withHelper.assembly.skills).toBeNull();
  });

  it('with skills: the section holds each prefixed block in order and the assembly records it', () => {
    const skills = skillsForPrompt([
      { id: '1', name: 'First', version: 1, body: 'one' },
      { id: '2', name: 'Second', version: 3, body: 'two' },
    ]);
    const { messages, assembly } = assemblePrompt({ ...BASE, ...(skills ? { skills } : {}) });
    const block = '### First\n\none\n\n### Second\n\ntwo';
    expect(messages[1]!.content).toContain(`## Skills / rules\n${block}`);
    expect(assembly.skills).toBe(block);
  });
});
