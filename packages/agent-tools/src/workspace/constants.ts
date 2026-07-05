export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const DEFAULT_COMMAND_OUTPUT_BYTES = 64 * 1024;
export const DEFAULT_MAX_SEARCH_RESULTS = 200;
export const DEFAULT_READ_BYTES = 512 * 1024;

export const SKIPPED_SEARCH_DIRS = new Set([
  ".git",
  "dist",
  "node_modules",
  "target",
  "vendor"
]);
