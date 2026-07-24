#!/usr/bin/env node

import { internalFailure, main } from './skill-knowledge/cli.mjs';

const argv = process.argv.slice(2);

try {
  process.exitCode = main(argv);
} catch (error) {
  const failure = internalFailure(argv, error);
  const rendered = failure.json
    ? JSON.stringify(failure.body, null, 2)
    : failure.body.diagnostics
        .map((item) => `${item.severity.toUpperCase()} ${item.code}: ${item.message}`)
        .join('\n');
  process.stdout.write(`${rendered}\n`);
  process.exitCode = failure.exitCode;
}
