// Ring 3 — edge. Parse (nothing to parse) → one use case → budget → map to an MCP result.
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { listAgents as listAgentsUseCase } from '../app/use-cases.js';
import type { Config } from '../config.js';
import type { DevDigestApi } from '../domain/ports.js';
import { budgetAgents } from './budget.js';
import { guard, ok } from './result.js';

export const LIST_AGENTS_DESCRIPTION =
  'List DevDigest reviewer agents (id, name, description, model, enabled). Call first to pick the agent for run_agent_on_pr or get_findings.';

export function registerListAgents(server: McpServer, api: DevDigestApi, config: Config): void {
  server.registerTool(
    'list_agents',
    {
      description: LIST_AGENTS_DESCRIPTION,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      guard('list_agents', config, async () => {
        const raw = await listAgentsUseCase(api, { textMax: config.textFieldMax });
        const { value, hint } = budgetAgents(raw, config.responseMaxChars);
        return ok(hint ? { ...value, hint } : value);
      }),
  );
}
