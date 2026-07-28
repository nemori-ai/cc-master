/**
 * ESM re-export of the CJS publish helper (tests + sync share one implementation).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { publishSkillsTree } = require('./publish-skills-tree.cjs');

export { publishSkillsTree };
