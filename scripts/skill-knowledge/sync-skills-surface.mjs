import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertSafeStamp, projectAndPublishSkillsSurface } = require('./sync-skills-surface.cjs');

export { assertSafeStamp, projectAndPublishSkillsSurface };
