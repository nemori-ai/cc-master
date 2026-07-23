/**
 * ESM re-export of the CJS whole-host publish helper.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { publishHostTree, assertSafeHostId } = require('./publish-host-tree.cjs');

export { publishHostTree, assertSafeHostId };
