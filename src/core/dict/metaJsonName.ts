// Shared predicate for the sidecar / meta JSON filename conventions.
//
// Two layouts (both used by the user-dict layouts and the StarDict
// import sidecar):
//   - `meta.json`              — the shared/folder convention.
//   - `<basename>.meta.json`   — the per-file sidecar convention.
//
// Extracted here so the import pipeline (TF5) and the discovery layer
// agree on what counts as a metadata sidecar. The discovery layer's
// own private copy is rewired onto this in M5 (TF5-FR1); for now this
// is the single canonical definition the new code imports.
export const isMetaJsonName = (name: string): boolean =>
  name === 'meta.json' || name.toLowerCase().endsWith('.meta.json');
