// Ring 3 — edge / composition root. Stdout carries only MCP JSON-RPC frames (C5); every
// diagnostic goes to stderr through this module, never through a bare `console.log` or
// `process.stdout.write` elsewhere in the package (enforced by eslint.config.js).

export const log = {
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(meta ? `[mcp-server] ${message} ${JSON.stringify(meta)}` : `[mcp-server] ${message}`);
  },
  info(message: string, meta?: Record<string, unknown>): void {
    console.error(meta ? `[mcp-server] ${message} ${JSON.stringify(meta)}` : `[mcp-server] ${message}`);
  },
};
