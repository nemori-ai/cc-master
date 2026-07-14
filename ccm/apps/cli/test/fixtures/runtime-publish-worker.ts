import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createDefaultRuntimeBackend } from '../../src/runtime-supply-chain.js';

interface WorkerControl {
  descendantPidPath?: string;
  suppressReady?: boolean;
}

const [tempPath, finalPath, barrierPath, readyPath, controlText = '{}'] = process.argv.slice(2);
if (!tempPath || !finalPath || !barrierPath || !readyPath) process.exit(2);
const control = JSON.parse(controlText) as WorkerControl;

if (control.descendantPidPath) {
  const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
    stdio: 'ignore',
  });
  await new Promise<void>((resolve, reject) => {
    descendant.once('error', reject);
    descendant.once('spawn', resolve);
  });
  if (!descendant.pid) process.exit(3);
  writeFileSync(control.descendantPidPath, String(descendant.pid));
  process.once('SIGTERM', () => {
    if (descendant.exitCode !== null || descendant.signalCode !== null) process.exit(0);
    descendant.once('close', () => process.exit(0));
  });
}

if (!control.suppressReady) writeFileSync(readyPath, 'ready');
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
