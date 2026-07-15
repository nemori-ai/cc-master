import { createRequire, syncBuiltinESMExports } from 'node:module';

Object.defineProperty(globalThis, 'fetch', {
  configurable: false,
  writable: false,
  value: async () => {
    throw new Error('CLOSED_EFFECT_SANDBOX: fetch denied');
  },
});

const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite');
sqlite.DatabaseSync = class ForbiddenDatabaseSync {
  constructor() {
    throw new Error('CLOSED_EFFECT_SANDBOX: SQLite credential read denied');
  }
};
syncBuiltinESMExports();
