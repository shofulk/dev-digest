import type { SkillType } from '@devdigest/shared';

const MIB = 1024 * 1024;

/** Import caps (spec criterion 17). Enforced before anything is inflated or stored. */
export const MAX_MARKDOWN_BYTES = 1 * MIB;
export const MAX_ZIP_BYTES = 5 * MIB;
export const MAX_UNCOMPRESSED_BYTES = 10 * MIB;
export const MAX_ZIP_ENTRIES = 200;

/**
 * Fastify's global body limit is 1 MiB; a 5 MiB zip is ~6.7 MiB once base64-encoded, so the
 * preview route lifts its own limit. Nothing else on the module needs more than the default.
 */
export const IMPORT_PREVIEW_BODY_LIMIT = 7 * MIB;

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;

/** Anything that could be run. Reported as `executable` and never read. */
export const EXECUTABLE_EXTENSIONS = [
  '.sh',
  '.bash',
  '.zsh',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.pl',
  '.ps1',
  '.bat',
  '.cmd',
] as const;
export const EXECUTABLE_BASENAMES = ['makefile'] as const;
/** `install*` is executable-by-convention unless it is plain markdown (`INSTALL.md`). */
export const EXECUTABLE_BASENAME_PREFIXES = ['install'] as const;

export const BINARY_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.class',
  '.jar',
  '.wasm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp3',
  '.mp4',
  '.mov',
] as const;

/** Any of these inside an archive refuses the whole archive (no recursion into archives). */
export const ARCHIVE_EXTENSIONS = [
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
] as const;

/** Core-file precedence at the archive root; the fallback is the shallowest `*.md`. */
export const CORE_FILE_PRECEDENCE = ['skill.md', 'readme.md'] as const;

/** Archive metadata written by macOS `zip`; never a candidate core file. */
export const JUNK_ROOT_DIR = '__macosx';
export const JUNK_BASENAME = '.ds_store';
export const JUNK_BASENAME_PREFIX = '._';

export const DEFAULT_IMPORT_TYPE: SkillType = 'custom';
export const MAX_DERIVED_NAME_LENGTH = 120;
export const MAX_DERIVED_DESCRIPTION_LENGTH = 500;

export const RESTORE_NOTE_PREFIX = 'Restored v';
export const INITIAL_SKILL_VERSION = 1;

/** Look-back of every skill stat (spec criterion F). */
export const STATS_WINDOW_DAYS = 30;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Rates are ratios in [0, 1] rounded to this many decimals (the client multiplies by 100). */
export const RATE_DECIMALS = 4;
