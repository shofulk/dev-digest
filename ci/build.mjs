// Bundles ci/src/index.ts into exactly one file, ci/dist/index.js (ESM, node22).
// Fails above 5,242,880 bytes (NFR-2) or when dist/ holds any other file.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const out = path.join(dist, 'index.js');
const MAX_BYTES = 5242880;

// Third-party packages resolve only from ci/node_modules, whichever file imports them.
const ciModules = {
  name: 'ci-node-modules',
  setup(b) {
    b.onResolve({ filter: /^(zod|openai|yaml)(\/|$)/ }, async (args) => {
      if (args.pluginData === 'ci') return null;
      return b.resolve(args.path, { kind: args.kind, resolveDir: here, pluginData: 'ci' });
    });
  },
};

fs.rmSync(dist, { recursive: true, force: true });

await build({
  entryPoints: [path.join(here, 'src/index.ts')],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  splitting: false,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  plugins: [ciModules],
  logLevel: 'warning',
});

const files = fs.readdirSync(dist);
if (files.length !== 1 || files[0] !== 'index.js') {
  console.error(`dist/ must hold only index.js, found: ${files.join(', ')}`);
  process.exit(1);
}
const size = fs.statSync(out).size;
if (size > MAX_BYTES) {
  console.error(`dist/index.js is ${size} bytes, over the ${MAX_BYTES} limit`);
  process.exit(1);
}
console.log(`dist/index.js ${size} bytes`);
