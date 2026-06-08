// Sidecar (meta.json) validation + slug naming for StarDict imports
// (TF5-FR2). A sidecar names the dictionary and declares its language
// so the importer can stamp rows, name the per-dict DB file, and audit
// the import. Validation is total — parseSidecar NEVER throws; an
// invalid sidecar yields {ok:false, reason} the importer surfaces.

import type {DefinitionFormat} from '../../lookup';
import {DEFINITION_FORMATS} from './schema';

export type Sidecar = {
  name: string;
  language: string;
  // Optional explicit render format; when present it overrides the
  // .ifo-derived format at import time. Dropped if not a known format.
  format?: DefinitionFormat;
  license?: string;
  version?: string;
  description?: string;
};

export type SidecarResult =
  | {ok: true; sidecar: Sidecar}
  | {ok: false; reason: string};

// ISO-639-1 (two-letter) OR the BCP-47 'und' (undetermined) tag. 'und'
// is the discovery default when a dict ships no meta.json — a valid
// language value (its thesaurus tab short-circuits to empty), so the
// strict parser accepts it rather than rejecting a minimum-input dict.
const ISO_639_1_OR_UND = /^([a-z]{2}|und)$/;

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

// Validate a parsed-JSON value into a Sidecar. REQUIRED: name (trimmed
// non-empty) and language (ISO-639-1, lowercased). format is kept only
// if it is a known DefinitionFormat (otherwise dropped, not rejected).
// Optional string fields pass through when present.
export const parseSidecar = (raw: unknown): SidecarResult => {
  if (typeof raw !== 'object' || raw === null) {
    return {ok: false, reason: 'sidecar is not a JSON object'};
  }
  const obj = raw as Record<string, unknown>;

  const name = (asString(obj.name) ?? '').trim();
  if (name === '') {
    return {ok: false, reason: 'sidecar missing required "name"'};
  }

  const language = (asString(obj.language) ?? '').trim().toLowerCase();
  if (!ISO_639_1_OR_UND.test(language)) {
    return {
      ok: false,
      reason: `sidecar "language" must be an ISO-639-1 code or "und", got "${
        asString(obj.language) ?? ''
      }"`,
    };
  }

  const sidecar: Sidecar = {name, language};

  const rawFormat = asString(obj.format);
  if (
    rawFormat !== undefined &&
    (DEFINITION_FORMATS as readonly string[]).includes(rawFormat)
  ) {
    sidecar.format = rawFormat as DefinitionFormat;
  }

  const license = asString(obj.license);
  if (license !== undefined) {
    sidecar.license = license;
  }
  const version = asString(obj.version);
  if (version !== undefined) {
    sidecar.version = version;
  }
  const description = asString(obj.description);
  if (description !== undefined) {
    sidecar.description = description;
  }

  return {ok: true, sidecar};
};

// --- CSV column config (M16) ---------------------------------------
// A meta.json may carry a `csv` block declaring the column layout of a
// sideloaded CSV (mirrors the v1.x 70e9d9f semantics):
//   "csv": {"headwordCol": 0, "definitionCol": 1, "phoneticCol": 2,
//           "hasHeader": false}
// Each field is OPTIONAL with a per-key fallback to the parser default
// (headword=0, definition=1, no phonetic, hasHeader=false) — so a block
// that sets only `phoneticCol` leaves the others at their defaults.

export type CsvColumnConfig = {
  headwordCol?: number;
  definitionCol?: number;
  phoneticCol?: number;
  hasHeader?: boolean;
};

// Accept a non-negative integer for a column index, else undefined (the
// downstream default applies). Rejects floats / negatives / non-numbers.
const pickNonNegInt = (
  obj: Record<string, unknown>,
  key: string,
): number | undefined => {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    return undefined;
  }
  return v;
};

// Parse a `csv` config block. NEVER throws; a non-object / absent block
// yields {} (all defaults). Unknown keys are ignored.
export const parseCsvConfig = (raw: unknown): CsvColumnConfig => {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const cfg: CsvColumnConfig = {};
  const hw = pickNonNegInt(obj, 'headwordCol');
  if (hw !== undefined) {
    cfg.headwordCol = hw;
  }
  const def = pickNonNegInt(obj, 'definitionCol');
  if (def !== undefined) {
    cfg.definitionCol = def;
  }
  const phon = pickNonNegInt(obj, 'phoneticCol');
  if (phon !== undefined) {
    cfg.phoneticCol = phon;
  }
  if (typeof obj.hasHeader === 'boolean') {
    cfg.hasHeader = obj.hasHeader;
  }
  return cfg;
};

const SLUG_MAX = 48;

// Fold a display name into a filesystem-safe slug: lowercase, collapse
// runs of non-[a-z0-9] into single hyphens, trim leading/trailing
// hyphens, and cap at 48 chars. May return '' (e.g. an all-symbol
// name) — slugDbFilename falls back to a language-based name then.
export const slugForName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');

// The per-dict DB filename: `<slug>.<lang>.db`, or `dict-<lang>.<lang>.db`
// when the name slugs to empty.
export const slugDbFilename = (name: string, lang: string): string => {
  const slug = slugForName(name) || `dict-${lang}`;
  return `${slug}.${lang}.db`;
};
