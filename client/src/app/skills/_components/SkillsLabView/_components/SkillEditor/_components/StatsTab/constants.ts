/** Categorical slots the donut can colour; a further category folds into "Other". */
export const MAX_DONUT_SLOTS = 8;

/** Donut geometry (px). */
export const DONUT_SIZE = 168;
export const DONUT_STROKE = 26;

/** Neutral fill for the folded "Other" segment. */
export const OTHER_COLOR = "var(--text-muted)";

/** Wrapper class the categorical slot variables below are scoped to. */
export const SERIES_SCOPE = "skill-stats-series";

/**
 * Categorical chart colours (the validated dataviz palette, fixed order, never cycled). The app
 * themes through `[data-theme]` on <html>, dark being the default, so the slots are stepped
 * per theme here rather than reusing the semantic status tokens (--ok/--warn/--crit), which are
 * reserved for state.
 */
export const SERIES_CSS = `
.${SERIES_SCOPE} {
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500;
  --series-5: #d55181; --series-6: #008300; --series-7: #9085e9; --series-8: #e66767;
}
[data-theme="light"] .${SERIES_SCOPE} {
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; --series-4: #eda100;
  --series-5: #e87ba4; --series-6: #008300; --series-7: #4a3aa7; --series-8: #e34948;
}
`;
