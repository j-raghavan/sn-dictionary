// Node ESM hooks that let a build-time .mjs script import the project's
// TypeScript source directly — no compile step, no new dependency. It
// reuses the exact transform jest already runs (@babel/core + the RN
// preset, both in devDependencies), so a script and a test see the
// same module behaviour.
//
// Two hooks:
//   resolve — appends `.ts` to extensionless relative imports (the
//             src/ tree imports siblings without an extension).
//   load    — transpiles .ts through babel with the RN preset, keeping
//             ES module syntax (disableImportExportTransform) so the
//             native ESM loader still sees named exports.
//
// Used via:  node --import ./scripts/registerTsLoader.mjs <script>.mjs
//
// This is the build-side analogue of runIntegrationTests.mjs spawning
// jest: build scripts reach into the TS source through the project's
// own transform rather than duplicating logic in JS.

import {stat, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import babel from '@babel/core';

export async function resolve(specifier, context, next) {
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.[cm]?[jt]s$/.test(specifier)
  ) {
    try {
      const tsURL = new URL(specifier + '.ts', context.parentURL);
      await stat(fileURLToPath(tsURL));
      return next(specifier + '.ts', context);
    } catch {
      // Not a .ts sibling — fall through to default resolution.
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.ts')) {
    const src = await readFile(fileURLToPath(url), 'utf8');
    const out = await babel.transformAsync(src, {
      filename: fileURLToPath(url),
      presets: [
        ['module:@react-native/babel-preset', {disableImportExportTransform: true}],
      ],
      sourceMaps: 'inline',
    });
    return {format: 'module', source: out.code, shortCircuit: true};
  }
  return next(url, context);
}
