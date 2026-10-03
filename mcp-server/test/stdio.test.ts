// Local subprocess smoke test (T11): with stdin closed immediately, the server must exit 0
// and write 0 bytes to stdout. Uses an unreachable API URL so no real network call happens
// even if something tried — startup itself makes no API call.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '../src/index.ts');
const tsxBin = path.resolve(here, '../node_modules/.bin/tsx');

describe('stdio smoke', () => {
  it('exits 0 and writes 0 bytes to stdout when stdin closes immediately', async () => {
    const result = await new Promise<{ code: number | null; stdoutLength: number }>((resolve, reject) => {
      const child = spawn(tsxBin, [entry], {
        env: { ...process.env, DEVDIGEST_API_URL: 'http://127.0.0.1:9' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdoutLength = 0;
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutLength += chunk.length;
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('stdio smoke test timed out after 10s'));
      }, 10_000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, stdoutLength });
      });
      child.on('error', reject);
      child.stdin.end();
    });

    expect(result.code).toBe(0);
    expect(result.stdoutLength).toBe(0);
  }, 15_000);
});
