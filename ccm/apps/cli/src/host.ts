// host.ts — compatibility re-export for the harness adapter registry.
//
// New code should import from `./harnesses/registry.js` and use harness terminology. This file keeps
// older in-flight imports working while the refactor migrates handler surfaces.

export {
  harnessSessionId,
  resolveHarnessAdapter,
  resolveHarnessId as resolveHarnessHost,
} from './harnesses/registry.js';
export type {
  Env,
  HarnessAdapter,
  HarnessSelection,
  UsageSignalSource,
} from './harnesses/types.js';
