import { createRuntimeSupplyChain } from '../../src/runtime-supply-chain.js';

const [home, transactionId, delayText = '0'] = process.argv.slice(2);
if (!home || !transactionId) {
  process.stderr.write('usage: runtime-activate-worker <home> <transaction> [delay-ms]\n');
  process.exitCode = 2;
} else {
  const delayMs = Number(delayText) || 0;
  try {
    const runtime = createRuntimeSupplyChain({
      env: { CC_MASTER_HOME: home },
      fault(point) {
        if (point === 'after_prepare' && delayMs > 0) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
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
