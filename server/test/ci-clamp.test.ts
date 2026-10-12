import { describe, it, expect } from 'vitest';
import type { CiAgentResult } from '@devdigest/shared/contracts/eval-ci';
import { clampAgentResult } from '../src/modules/ci/helpers.js';

const base: CiAgentResult = {
  agent_id: 'a1',
  agent_version: 3,
  verdict: 'passed',
  critical: 1,
  warning: 2,
  suggestion: 3,
  findings_count: 6,
  blockers: 1,
  cost_usd: 0.5,
  duration_ms: 1200,
  model: 'openai/gpt-4o',
  error_code: null,
};

describe('clampAgentResult', () => {
  it('AC-23: leaves in-range values untouched', () => {
    expect(clampAgentResult(base)).toEqual(base);
  });

  it('AC-23: clamps every count to 0-10,000 and floors it', () => {
    const over = clampAgentResult({
      ...base,
      agent_version: 99_999,
      critical: 10_001,
      warning: 1e9,
      suggestion: 2.9,
      findings_count: 10_000,
      blockers: 1.5,
    });
    expect(over).toMatchObject({
      agent_version: 10_000,
      critical: 10_000,
      warning: 10_000,
      suggestion: 2,
      findings_count: 10_000,
      blockers: 1,
    });
    const neg = clampAgentResult({ ...base, critical: -5, warning: -0.5, suggestion: -1, findings_count: -1, blockers: -9 });
    expect(neg).toMatchObject({ critical: 0, warning: 0, suggestion: 0, findings_count: 0, blockers: 0 });
  });

  it('AC-23: clamps cost to 0-100 USD and keeps null', () => {
    expect(clampAgentResult({ ...base, cost_usd: 100.01 }).cost_usd).toBe(100);
    expect(clampAgentResult({ ...base, cost_usd: -1 }).cost_usd).toBe(0);
    expect(clampAgentResult({ ...base, cost_usd: 100 }).cost_usd).toBe(100);
    expect(clampAgentResult({ ...base, cost_usd: null }).cost_usd).toBeNull();
  });

  it('AC-23: clamps duration to 0-86,400,000 ms and keeps null', () => {
    expect(clampAgentResult({ ...base, duration_ms: 86_400_001 }).duration_ms).toBe(86_400_000);
    expect(clampAgentResult({ ...base, duration_ms: -1 }).duration_ms).toBe(0);
    expect(clampAgentResult({ ...base, duration_ms: null }).duration_ms).toBeNull();
  });

  it('AC-23: cuts every text field to 500 characters and keeps null', () => {
    const long = 'x'.repeat(501);
    const out = clampAgentResult({ ...base, agent_id: long, model: long, error_code: long });
    expect(out.agent_id).toHaveLength(500);
    expect(out.model).toHaveLength(500);
    expect(out.error_code).toHaveLength(500);
    expect(clampAgentResult({ ...base, model: null }).model).toBeNull();
  });
});
