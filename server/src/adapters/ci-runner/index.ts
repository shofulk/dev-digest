// RING 2 — infrastructure adapter. The only place in the server that reads the built CI
// runner (`ci/dist/index.js`) from disk (`node:fs`). Real implementation of the
// `RunnerBundleSource` port (@devdigest/shared); constructed in `platform/container.ts`.
import { promises as fs } from 'node:fs';
import type { RunnerBundleSource } from '@devdigest/shared';

export class FsRunnerBundleSource implements RunnerBundleSource {
  constructor(private readonly path: string) {}

  /** The runner file, or null when it has not been built yet (ENOENT). */
  async read(): Promise<{ contents: string; sizeBytes: number } | null> {
    try {
      const contents = await fs.readFile(this.path, 'utf-8');
      return { contents, sizeBytes: Buffer.byteLength(contents, 'utf-8') };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
}
