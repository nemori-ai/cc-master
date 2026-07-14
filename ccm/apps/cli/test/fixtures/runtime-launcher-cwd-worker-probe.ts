import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  createDefaultRuntimeBackend,
  createRuntimeSupplyChain,
} from '../../src/runtime-supply-chain.js';

const [home, outputPath, probeDirectory] = process.argv.slice(2);
if (!home || !outputPath || !probeDirectory) {
  process.stderr.write(
    'usage: runtime-launcher-cwd-worker-probe <home> <output> <probe-directory>\n',
  );
  process.exit(2);
}

process.chdir(probeDirectory);
writeFileSync('cwd-marker', 'caller-cwd');
const readyPath = join(probeDirectory, 'materializer-ready');
const barrierPath = join(probeDirectory, 'materializer-go');
const resultPath = join(probeDirectory, 'worker-result');
const worker = new Worker(
  `
    const { existsSync, readFileSync, writeFileSync } = require('node:fs');
    const { workerData } = require('node:worker_threads');
    const deadline = Date.now() + 3000;
    while (!existsSync(workerData.readyPath) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    if (!existsSync(workerData.readyPath)) {
      writeFileSync(workerData.resultPath, 'READY_TIMEOUT');
    } else {
      try {
        writeFileSync(workerData.resultPath, readFileSync('cwd-marker', 'utf8'));
      } catch (error) {
        writeFileSync(workerData.resultPath, error.code || error.message);
      }
    }
    writeFileSync(workerData.barrierPath, 'go');
  `,
  { eval: true, workerData: { readyPath, barrierPath, resultPath } },
);

const backend = createDefaultRuntimeBackend(
  process.platform,
  process.arch,
  typeof process.geteuid === 'function' ? process.geteuid() : null,
  undefined,
  {
    nativeTest: {
      point: 'before_helper_publish',
      readyPath,
      barrierPath,
      action: 'pause',
    },
  },
);
const runtime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: home }, backend });
const result = runtime.invoke([outputPath]);
await worker.terminate();
const workerResult = existsSync(resultPath) ? readFileSync(resultPath, 'utf8') : 'NO_RESULT';
process.stdout.write(
  `${JSON.stringify({ exit_code: result.exit_code, cwd: process.cwd(), workerResult })}\n`,
);
