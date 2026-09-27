// Ring 3 — edge. Stub (out of scope, AC12): registered with its final input schema, always
// fails with a "do not retry" text and makes zero API calls. rev 5: routed through `guard`
// like every other tool, so the same budget net applies to it too.
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { Config } from '../config.js';
import { notImplementedText } from './errors.js';
import { fail, guard } from './result.js';

export const GET_BLAST_RADIUS_DESCRIPTION =
  'Not implemented yet: will report which code a pull request’s changes can affect. Always returns an error today — do not call or retry it.';

const inputSchema = z.object({
  repo: z.string().min(1).describe('Repository as owner/name, or a unique bare name.'),
  pr: z.number().int().positive().describe('The GitHub pull request number.'),
});

export function registerGetBlastRadius(server: McpServer, config: Config): void {
  server.registerTool(
    'get_blast_radius',
    {
      description: GET_BLAST_RADIUS_DESCRIPTION,
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => guard('get_blast_radius', config, () => Promise.resolve(fail(notImplementedText('get_blast_radius')))),
  );
}
