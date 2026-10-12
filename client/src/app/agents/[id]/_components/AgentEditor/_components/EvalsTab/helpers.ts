/** Cases whose last result is a pass, and whether any case has run at all. */
export function passingCounts(results: readonly string[]): { passing: number; total: number; anyRun: boolean } {
  return {
    passing: results.filter((r) => r === "pass").length,
    total: results.length,
    anyRun: results.some((r) => r !== "never_run"),
  };
}

/** `file:line` or `file:start-end`. */
export function locationOf(e: { file: string; start_line: number; end_line: number }): string {
  return e.start_line === e.end_line ? `${e.file}:${e.start_line}` : `${e.file}:${e.start_line}-${e.end_line}`;
}
