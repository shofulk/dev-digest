#!/usr/bin/env node
// Ring 3 — composition root. The ONLY file that constructs the concrete HTTP adapter
// (C1). No API call happens at startup — the server only starts listening on stdio.
// Nothing but MCP frames goes to stdout (C5); every diagnostic goes to stderr via
// src/log.ts.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createHttpApi } from './adapters/http-api.js';
import { loadConfig } from './config.js';
import { log } from './log.js';
import { createServer } from './server.js';

function main(): void {
  const config = loadConfig();
  const api = createHttpApi({ baseUrl: config.apiBaseUrl, timeoutMs: config.requestTimeoutMs });

  serveStdio(() => createServer({ api, config }), {
    onerror: (error) => log.error('transport error', { message: error.message }),
  });
}

try {
  main();
} catch (error) {
  log.error('failed to start', { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
