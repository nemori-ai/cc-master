import { writeFileSync } from 'node:fs';
import { createDefaultRuntimeBackend } from '../../src/runtime-supply-chain.js';

const [tempPath, finalPath, barrierPath, readyPath] = process.argv.slice(2);
if (!tempPath || !finalPath || !barrierPath || !readyPath) process.exit(2);

writeFileSync(readyPath, 'ready');
while (true) {
  try {
    const { statSync } = await import('node:fs');
    statSync(barrierPath);
    break;
  } catch {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}

try {
  createDefaultRuntimeBackend().publishUniqueFile(tempPath, finalPath);
  process.exit(0);
} catch (error) {
  const failure = error as Error & { code?: string };
  process.stderr.write(`${failure.code || 'ERROR'}: ${failure.message}\n`);
  process.exit(failure.code === 'RUNTIME_REPLACE' ? 3 : 1);
}
