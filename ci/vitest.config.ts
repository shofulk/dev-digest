import { defineConfig } from 'vitest/config';
import path from 'node:path';

const here = __dirname;

export default defineConfig({
  resolve: {
    alias: [
      // Third-party packages used by the shared sources resolve only from ci/node_modules.
      { find: /^(zod|openai|yaml)(\/.*)?$/, replacement: path.join(here, 'node_modules/$1$2') },
      { find: '@devdigest/shared', replacement: path.resolve(here, '../server/src/vendor/shared') },
      { find: '@devdigest/reviewer-core', replacement: path.resolve(here, '../reviewer-core/src') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
