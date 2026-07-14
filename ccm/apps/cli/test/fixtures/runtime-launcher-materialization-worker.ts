import { existsSync, writeFileSync } from 'node:fs';
import {
  createDefaultRuntimeBackend,
  createRuntimeSupplyChain,
  type RuntimeLauncherMaterializationPoint,
} from '../../src/runtime-supply-chain.js';

const [home, outputPath, readyPath, barrierPath, faultPoint] = process.argv.slice(2);
if (!home || !outputPath) {
  process.stderr.write(
    'usage: runtime-launcher-materialization-worker <home> <output> [ready] [barrier] [fault-point]\n',
  );
  process.exitCode = 2;
} else {
  const nativePoint =
    faultPoint === 'before_bootstrap_self_cleanup_native'
      ? 'before_bootstrap_self_cleanup'
      : faultPoint === 'before_bootstrap_recovery_native'
        ? 'before_bootstrap_recovery'
        : faultPoint === 'before_temp_cleanup'
          ? 'before_temp_cleanup'
          : faultPoint === 'before_helper_publish_native'
            ? 'before_helper_publish'
            : faultPoint === 'after_helper_publish_native'
              ? 'after_helper_publish'
              : null;
  const backend = createDefaultRuntimeBackend(
    process.platform,
    process.arch,
    typeof process.geteuid === 'function' ? process.geteuid() : null,
    undefined,
    {
      fault(point: RuntimeLauncherMaterializationPoint) {
        if (nativePoint !== null) return;
        if (point !== faultPoint) return;
        if (readyPath) writeFileSync(readyPath, point);
        if (barrierPath) {
          while (!existsSync(barrierPath)) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
          }
          return;
        }
        process.kill(process.pid, 'SIGKILL');
      },
      nativeTest:
        nativePoint !== null
          ? {
              point: nativePoint,
              readyPath,
              barrierPath,
              action: barrierPath ? 'pause' : 'kill',
            }
          : undefined,
    } as any,
  );
  try {
    const runtime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: home }, backend });
    const result = runtime.invoke([outputPath]);
    process.stdout.write(`${JSON.stringify({ ok: true, exit_code: result.exit_code })}\n`);
    process.exitCode = result.exit_code;
  } catch (error) {
    const failure = error as Error & { code?: string };
    process.stderr.write(`${failure.code || 'ERROR'}: ${failure.message}\n`);
    process.exitCode = 1;
  }
}
