import { describe, it, expect } from "vitest";
import { ApiError } from "./api";
import { shouldToastQueryError } from "./query-errors";

describe("shouldToastQueryError", () => {
  it.each([
    ["an ApiError 500", new ApiError("boom", 500)],
    ["a network failure (ApiError status 0)", new ApiError("offline", 0)],
    ["a plain Error", new Error("network down")],
  ])("AC-96: toasts %s", (_name, err) => {
    expect(shouldToastQueryError(err, undefined)).toBe(true);
  });

  it("AC-96: does not toast an ApiError 404", () => {
    expect(shouldToastQueryError(new ApiError("missing", 404), undefined)).toBe(false);
  });

  it.each([
    ["an ApiError 500", new ApiError("boom", 500)],
    ["status 0", new ApiError("offline", 0)],
    ["a plain Error", new Error("x")],
    ["an ApiError 404", new ApiError("missing", 404)],
  ])("AC-96/AC-99: meta.silentError suppresses the toast for %s", (_name, err) => {
    expect(shouldToastQueryError(err, { silentError: true })).toBe(false);
  });

  it("AC-96: meta without silentError still toasts a 500", () => {
    expect(shouldToastQueryError(new ApiError("boom", 500), { other: 1 })).toBe(true);
  });
});
