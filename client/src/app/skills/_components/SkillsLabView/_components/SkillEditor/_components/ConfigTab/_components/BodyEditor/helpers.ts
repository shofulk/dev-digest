/** Number of lines in `text`; an empty body still has one line. */
export function countLines(text: string): number {
  return text.split("\n").length;
}

/** Gutter content for `count` lines: "1\n2\n…\ncount". */
export function gutterText(count: number): string {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => i + 1).join("\n");
}
