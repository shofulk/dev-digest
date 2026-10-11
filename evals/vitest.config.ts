import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

// CI raises this: an agent case through OpenRouter takes 2-6.5 min, past the local default.
const TIMEOUT_MS = Number(process.env.EVAL_TEST_TIMEOUT_MS ?? "240000");

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room.
    testTimeout: TIMEOUT_MS,
    hookTimeout: TIMEOUT_MS,
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    reporters: ["default", new TrendReporter()],
  },
});
