#!/usr/bin/env node
'use strict';
// PARITY: rule-orchestrator-context-ccm-owned
// PARITY: rule-orchestrator-context-cached-only
// PARITY: rule-orchestrator-context-bounded-redacted
// PARITY: rule-orchestrator-context-dedup
// PARITY: rule-orchestrator-context-fail-open
// PARITY: rule-orchestrator-context-shadow-only
const fs = require('fs');
const path = require('path');
const candidates = [
  path.resolve(__dirname, '../../../_shared/orchestrator-context-core.js'),
  path.resolve(__dirname, '../_shared/orchestrator-context-core.js'),
];
const core = candidates.find((candidate) => fs.existsSync(candidate));
if (core) require(core);
