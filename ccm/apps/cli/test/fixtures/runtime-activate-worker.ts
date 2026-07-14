import { existsSync, writeFileSync } from 'node:fs';
import { createRuntimeSupplyChain } from '../../src/runtime-supply-chain.js';

interface WorkerControl {
  startupDelayMs?: number;
  readyFile?: string;
  releaseFile?: string;
  barrierTimeoutMs?: number;
  failAfterReady?: boolean;
}

function wait(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function controlledFailure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

const [home, transactionId, controlText = '{}'] = process.argv.slice(2);
if (!home || !transactionId) {
  process.stderr.write('usage: runtime-activate-worker <home> <transaction> [control-json]\n');
  process.exitCode = 2;
} else {
  try {
    const control = JSON.parse(controlText) as WorkerControl;
    wait(control.startupDelayMs || 0);
    const runtime = createRuntimeSupplyChain({
      env: { CC_MASTER_HOME: home },
      fault(point) {
        if (point !== 'after_prepare') return;
        if (control.readyFile) writeFileSync(control.readyFile, 'ready\n');
        if (control.failAfterReady) {
          throw controlledFailure(
            'RUNTIME_TEST_BARRIER_FAILURE',
            'synthetic activation worker failure after ready',
          );
        }
        if (!control.releaseFile) return;
        const deadline = Date.now() + (control.barrierTimeoutMs || 10_000);
        while (!existsSync(control.releaseFile)) {
          if (Date.now() >= deadline) {
            throw controlledFailure(
              'RUNTIME_TEST_BARRIER_TIMEOUT',
              `timed out waiting for release file: ${control.releaseFile}`,
            );
          }
          wait(5);
        }
      },
    });
    const result = runtime.activate(transactionId);
    process.stdout.write(`${JSON.stringify({ ok: true, sequence: result.sequence })}\n`);
  } catch (error) {
    const failure = error as Error & { code?: string };
    process.stderr.write(`${failure.code || 'ERROR'}: ${failure.message}\n`);
    process.exitCode = failure.code === 'RUNTIME_LOCKED' ? 4 : 1;
  }
}
