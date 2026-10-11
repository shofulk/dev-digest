/** Selecting exactly this many runs enables Compare. */
export const COMPARE_COUNT = 2;

/** `ApiError.code` of a rejected start -> message key under the `eval` namespace. */
export const START_ERROR_KEYS = {
  no_cases: "suite.errors.noCases",
  provider_not_configured: "suite.errors.providerNotConfigured",
  run_in_flight: "suite.errors.runInFlight",
} as const;

export const START_ERROR_FALLBACK_KEY = "suite.errors.generic";
