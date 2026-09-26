/* diff-viewer — unified-diff viewer with optional inline GitHub comments and
   findings. Public surface: the DiffViewer component + the DiffCommentApi /
   DiffFindingApi contracts, plus the pure Smart-order grouping helper. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export type { DiffFindingApi } from "./findings";
export { orderBySmartDiff, type SmartDiffFileGroup } from "./helpers";
