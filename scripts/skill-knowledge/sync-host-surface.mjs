/**
 * ESM re-export of the CJS whole-host sync orchestration.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assertHostDistPathIntegrity,
  assertSafeStamp,
  projectAndPublishHostSurface,
} = require('./sync-host-surface.cjs');

export {
  assertHostDistPathIntegrity,
  assertSafeStamp,
  projectAndPublishHostSurface,
};
