import { describe, it, expect } from "vitest";
import { bytesToBase64, canConfirm, readFileAsBase64 } from "./helpers";

const reference = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

describe("bytesToBase64", () => {
  it("encodes the empty input as the empty string", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });

  it("matches the reference encoding for every padding length", () => {
    for (const text of ["a", "ab", "abc", "abcd", "# Skill\n\nhello"]) {
      const bytes = new TextEncoder().encode(text);
      expect(bytesToBase64(bytes)).toBe(reference(bytes));
    }
  });

  it("keeps non-ASCII and high bytes intact", () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 200, 255, 0x50, 0x4b, 0x03, 0x04]);
    expect(bytesToBase64(bytes)).toBe(reference(bytes));
  });

  it("encodes multi-MB input across chunk boundaries without overflowing the stack", () => {
    const bytes = new Uint8Array(5 * 1024 * 1024 + 1);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    expect(bytesToBase64(bytes)).toBe(reference(bytes));
  });
});

describe("readFileAsBase64", () => {
  it("reads a file's bytes as base64", async () => {
    const file = new File(["# Hello\n"], "SKILL.md", { type: "text/markdown" });
    expect(await readFileAsBase64(file)).toBe(Buffer.from("# Hello\n").toString("base64"));
  });
});

describe("canConfirm", () => {
  it("needs a non-blank name and a non-blank body", () => {
    expect(canConfirm("x", "body")).toBe(true);
    expect(canConfirm("  ", "body")).toBe(false);
    expect(canConfirm("x", " \n")).toBe(false);
  });
});
