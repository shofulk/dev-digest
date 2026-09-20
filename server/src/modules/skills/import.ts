import { unzipSync } from 'fflate';
import type { SkillImportPreview, SkillType } from '@devdigest/shared';
import {
  ARCHIVE_EXTENSIONS,
  BINARY_EXTENSIONS,
  CORE_FILE_PRECEDENCE,
  DEFAULT_IMPORT_TYPE,
  EXECUTABLE_BASENAMES,
  EXECUTABLE_BASENAME_PREFIXES,
  EXECUTABLE_EXTENSIONS,
  JUNK_BASENAME,
  JUNK_BASENAME_PREFIX,
  JUNK_ROOT_DIR,
  MARKDOWN_EXTENSIONS,
  MAX_DERIVED_DESCRIPTION_LENGTH,
  MAX_DERIVED_NAME_LENGTH,
  MAX_MARKDOWN_BYTES,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
} from './constants.js';

/**
 * Ring 1 — PURE. Bytes + filename in, a preview or a typed refusal out. No fs, no
 * child_process, no network: an archive is inflated in memory, only markdown entries are
 * ever decoded, and everything else is named and dropped (spec criteria 13-19).
 */

export type ImportErrorCode =
  | 'unsupported-type'
  | 'empty'
  | 'too-large'
  | 'too-many-entries'
  | 'uncompressed-too-large'
  | 'nested-archive'
  | 'path-traversal'
  | 'invalid-archive'
  | 'invalid-text'
  | 'no-markdown';

export interface ImportError {
  code: ImportErrorCode;
  /** Human-readable; safe to show in the UI verbatim. */
  message: string;
}

export type ImportResult =
  | { ok: true; preview: SkillImportPreview }
  | { ok: false; error: ImportError };

type Ignored = SkillImportPreview['ignored'][number];

/** Thrown inside the unzip filter to abort the whole archive; never escapes this module. */
class Refusal extends Error {
  constructor(readonly error: ImportError) {
    super(error.message);
  }
}

const refuse = (code: ImportErrorCode, message: string): ImportResult => ({
  ok: false,
  error: { code, message },
});

const mib = (bytes: number) => `${bytes / (1024 * 1024)} MiB`;

const lower = (s: string) => s.toLowerCase();
const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : lower(name.slice(dot));
};
const hasExtension = (name: string, list: readonly string[]) => list.includes(extensionOf(name));
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const stem = (filename: string) => {
  const base = baseName(filename.replace(/\\/g, '/'));
  const ext = extensionOf(base);
  return ext ? base.slice(0, -ext.length) : base;
};

export function parseSkillImport(bytes: Uint8Array, filename: string): ImportResult {
  if (bytes.byteLength === 0) return refuse('empty', 'The file is empty.');
  const name = baseName(filename.replace(/\\/g, '/'));

  if (hasExtension(name, MARKDOWN_EXTENSIONS)) {
    if (bytes.byteLength > MAX_MARKDOWN_BYTES) {
      return refuse('too-large', `Markdown files are limited to ${mib(MAX_MARKDOWN_BYTES)}.`);
    }
    const text = decodeText(bytes);
    if (text === null) {
      return refuse('invalid-text', `${name} is not a valid UTF-8 text file.`);
    }
    if (text.trim() === '') return refuse('empty', 'The file is empty.');
    return { ok: true, preview: buildPreview(text, stem(name), []) };
  }

  if (extensionOf(name) === '.zip') return parseArchive(bytes, stem(name));

  return refuse('unsupported-type', 'Only .md, .markdown and .zip files can be imported.');
}

function parseArchive(bytes: Uint8Array, fallbackName: string): ImportResult {
  if (bytes.byteLength > MAX_ZIP_BYTES) {
    return refuse('too-large', `Archives are limited to ${mib(MAX_ZIP_BYTES)}.`);
  }

  const ignored: Ignored[] = [];
  const candidates: string[] = [];
  let entries = 0;
  let declaredBytes = 0;

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      // Runs on the central directory, before any entry is inflated.
      filter(info) {
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES) {
          throw new Refusal({
            code: 'too-many-entries',
            message: `The archive has more than ${MAX_ZIP_ENTRIES} entries.`,
          });
        }
        const path = normalizePath(info.name);
        declaredBytes += info.originalSize;
        if (declaredBytes > MAX_UNCOMPRESSED_BYTES) {
          throw new Refusal({
            code: 'uncompressed-too-large',
            message: `The archive expands to more than ${mib(MAX_UNCOMPRESSED_BYTES)}.`,
          });
        }
        if (path.endsWith('/')) return false;

        const kind = classify(path);
        if (kind === 'archive') {
          throw new Refusal({
            code: 'nested-archive',
            message: `The archive contains another archive (${path}); nested archives are not accepted.`,
          });
        }
        if (kind !== 'markdown') {
          ignored.push({ path, reason: kind });
          return false;
        }
        if (info.originalSize > MAX_MARKDOWN_BYTES) {
          throw new Refusal({
            code: 'too-large',
            message: `${path} is larger than ${mib(MAX_MARKDOWN_BYTES)}.`,
          });
        }
        candidates.push(path);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, error: err.error };
    return refuse('invalid-archive', 'The file is not a readable .zip archive.');
  }

  const texts = new Map<string, string>();
  for (const path of candidates) {
    const raw = files[path] ?? files[path.replace(/\//g, '\\')];
    const text = raw ? decodeText(raw) : null;
    if (text === null) ignored.push({ path, reason: 'binary' });
    else if (text.trim() === '') ignored.push({ path, reason: 'not-markdown' });
    else texts.set(path, text);
  }

  const core = pickCore([...texts.keys()]);
  if (core === undefined) {
    return refuse('no-markdown', 'The archive contains no markdown file to use as the skill.');
  }
  for (const path of texts.keys()) {
    // Markdown that lost the core-file contest: named, never read into the body.
    if (path !== core) ignored.push({ path, reason: 'not-markdown' });
  }
  return { ok: true, preview: buildPreview(texts.get(core)!, fallbackName, ignored) };
}

/** Paths are attacker-controlled: refuse absolute paths and any `..` segment (zip-slip). */
function normalizePath(raw: string): string {
  const path = raw.replace(/\\/g, '/');
  const escapes =
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').includes('..');
  if (escapes) {
    throw new Refusal({
      code: 'path-traversal',
      message: `The archive contains an unsafe path (${raw}) and was rejected.`,
    });
  }
  return path;
}

type EntryKind = 'markdown' | 'archive' | Ignored['reason'];

function classify(path: string): EntryKind {
  const base = lower(baseName(path));
  const isMarkdown = hasExtension(base, MARKDOWN_EXTENSIONS);

  if (
    lower(path).startsWith(`${JUNK_ROOT_DIR}/`) ||
    base === JUNK_BASENAME ||
    base.startsWith(JUNK_BASENAME_PREFIX)
  ) {
    return 'not-markdown';
  }
  if (hasExtension(base, ARCHIVE_EXTENSIONS)) return 'archive';
  if (
    hasExtension(base, EXECUTABLE_EXTENSIONS) ||
    EXECUTABLE_BASENAMES.some((b) => base === b) ||
    (!isMarkdown && EXECUTABLE_BASENAME_PREFIXES.some((p) => base.startsWith(p)))
  ) {
    return 'executable';
  }
  if (isMarkdown) return 'markdown';
  if (hasExtension(base, BINARY_EXTENSIONS)) return 'binary';
  return 'not-markdown';
}

/** SKILL.md at the root, else README.md at the root, else shallowest then alphabetical. */
function pickCore(paths: string[]): string | undefined {
  for (const wanted of CORE_FILE_PRECEDENCE) {
    const hit = paths.find((p) => !p.includes('/') && lower(p) === wanted);
    if (hit !== undefined) return hit;
  }
  const depth = (p: string) => p.split('/').length;
  return [...paths].sort((a, b) => depth(a) - depth(b) || (lower(a) < lower(b) ? -1 : 1))[0];
}

/** Strict UTF-8; NUL bytes mean binary content wearing a text extension. */
function decodeText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

function buildPreview(text: string, fallbackName: string, ignored: Ignored[]): SkillImportPreview {
  const { fields, body } = splitFrontMatter(text);
  const heading = firstHeading(body);
  const type = SKILL_TYPES.has(fields.type as SkillType)
    ? (fields.type as SkillType)
    : DEFAULT_IMPORT_TYPE;

  return {
    name: clip(fields.name || heading?.title || fallbackName, MAX_DERIVED_NAME_LENGTH),
    description: clip(
      fields.description || firstParagraph(body, heading?.line ?? -1),
      MAX_DERIVED_DESCRIPTION_LENGTH,
    ),
    type,
    // Front matter is consumed for name/description/type above; keeping it in the body
    // would render as an artifact in the preview and ship to the model as prompt bytes.
    body: body.replace(/^\n+/, ''),
    source: 'imported_file',
    truncated: false,
    ignored,
  };
}

const SKILL_TYPES = new Set<string>(['rubric', 'convention', 'security', 'custom']);

const clip = (s: string, max: number) => {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1).trimEnd()}…` : oneLine;
};

/**
 * Top-level `key: value` scalars only. No YAML dependency, no anchors, no nesting; a
 * folded/literal block (`>`, `|`) is joined so `description: >-` files still derive.
 */
function splitFrontMatter(text: string): { fields: Record<string, string>; body: string } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return { fields: {}, body: lines.join('\n') };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { fields: {}, body: lines.join('\n') };

  const fields: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    let value = m[2]!.trim();
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < end && /^\s+\S|^\s*$/.test(lines[i + 1]!)) block.push(lines[++i]!.trim());
      value = block.filter(Boolean).join(value.startsWith('|') ? '\n' : ' ');
    }
    fields[key] = unquote(value);
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

function unquote(v: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(v);
  return quoted ? quoted[2]! : v;
}

function firstHeading(body: string): { title: string; line: number } | undefined {
  const lines = body.split('\n');
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) fenced = !fenced;
    if (fenced) continue;
    const m = /^#\s+(.+?)\s*$/.exec(lines[i]!);
    if (m) return { title: m[1]!.replace(/\s+#+$/, ''), line: i };
  }
  return undefined;
}

/** First run of prose lines after the heading (or from the top when there is none). */
function firstParagraph(body: string, headingLine: number): string {
  const lines = body.split('\n').slice(headingLine + 1);
  const para: string[] = [];
  let fenced = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      if (para.length > 0) break;
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (line === '' || line.startsWith('#')) {
      if (para.length > 0) break;
      continue;
    }
    para.push(line);
  }
  return para.join(' ');
}
