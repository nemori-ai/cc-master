import { writeSync } from 'node:fs';
import { durableWriteFileSync } from '../../dist/index.mjs';

const [target, encodedPayload, checkpoint] = process.argv.slice(2);
if (!target || !encodedPayload || !checkpoint) process.exit(2);

durableWriteFileSync(target, Buffer.from(encodedPayload, 'base64').toString('utf8'), {
  fault(point) {
    if (point !== checkpoint) return;
    writeSync(1, `${point}\n`);
    const blocker = new Int32Array(new SharedArrayBuffer(4));
    while (true) Atomics.wait(blocker, 0, 0, 60_000);
  },
});
process.exit(99);
