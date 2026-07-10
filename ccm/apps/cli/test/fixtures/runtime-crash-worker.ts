import { createRuntimeSupplyChain } from '../../src/runtime-supply-chain.js';

const [home, transactionId] = process.argv.slice(2);
if (!home || !transactionId) {
  process.exit(2);
}

const runtime = createRuntimeSupplyChain({
  env: { CC_MASTER_HOME: home },
  fault(point) {
    if (point === 'after_commit') process.exit(91);
  },
});
runtime.activate(transactionId);
process.exit(99);
