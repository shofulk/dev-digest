// Ring 3 — edge. Registers the five tools on an McpServer, in the fixed order AC2 requires.
import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';
import type { DevDigestApi } from '../domain/ports.js';
import { registerGetBlastRadius } from './get-blast-radius.js';
import { registerGetConventions } from './get-conventions.js';
import { registerGetFindings } from './get-findings.js';
import { registerListAgents } from './list-agents.js';
import { registerRunAgentOnPr } from './run-agent-on-pr.js';

export interface ToolClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export function registerTools(server: McpServer, api: DevDigestApi, config: Config, clock?: ToolClock): void {
  registerListAgents(server, api, config);
  registerRunAgentOnPr(server, api, config, clock);
  registerGetFindings(server, api, config);
  registerGetConventions(server, api, config);
  registerGetBlastRadius(server, api, config);
}
