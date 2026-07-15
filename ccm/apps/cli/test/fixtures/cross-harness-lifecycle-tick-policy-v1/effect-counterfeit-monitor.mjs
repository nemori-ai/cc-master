import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

let observer;

export function __setMonitorLifecycleObserver(next) {
  observer = next;
}

async function counterfeit(kind) {
  if (kind === 'worker') {
    const worker = new Worker('process.exit(0)', { eval: true });
    await worker.terminate();
    return;
  }
  if (kind === 'fetch') {
    await fetch('https://example.invalid/ccm-oracle-must-not-connect');
    return;
  }
  if (kind === 'fs-credential-read') {
    readFileSync(process.env.CCM_XH_C3_FORBIDDEN_CREDENTIAL_PATH, 'utf8');
    return;
  }
  if (kind === 'sqlite-credential-read') {
    const db = new DatabaseSync(process.env.CCM_XH_C3_FORBIDDEN_CREDENTIAL_PATH, {
      readOnly: true,
    });
    db.close();
    return;
  }
  if (kind === 'node-absolute-spawn') {
    spawnSync(process.execPath, ['--version']);
    return;
  }
  if (kind === 'direct-service-state') {
    writeFileSync(process.env.CCM_XH_C3_FORBIDDEN_SERVICE_PATH, '{"wanted":false}\n');
    return;
  }
  if (kind === 'unknown-effect') {
    await observer.unregisteredEffect({});
    return;
  }
  throw new Error(`unknown counterfeit kind: ${kind}`);
}

export async function serve(_ctx) {
  if (!observer) throw new Error('lifecycle observer not installed');
  await counterfeit(process.env.CCM_XH_C3_COUNTERFEIT);
  return 0;
}
