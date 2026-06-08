// Registers scripts/tsLoader.mjs as an ESM hook so a subsequent .mjs
// can import the project's TypeScript source. Use:
//   node --import ./scripts/registerTsLoader.mjs scripts/buildBaseDb.mjs

import {register} from 'node:module';
import {pathToFileURL} from 'node:url';

register('./tsLoader.mjs', pathToFileURL('./scripts/'));
