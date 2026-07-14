import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

interface WorkerPayload {
  home: string;
  operation: 'refresh' | 'reserve';
  request?: Record<string, unknown>;
  sourceKey?: string;
  observation?: Record<string, unknown>;
  collectorDir?: string;
  workerId?: number;
  ready: SharedArrayBuffer;
  start: SharedArrayBuffer;
}

interface QuotaAdmissionStore {
  refreshObservation: (
    request: Readonly<Record<string, unknown>>,
    collect: () => Promise<Record<string, unknown>>,
  ) => unknown | Promise<unknown>;
  reserve: (request: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
}

interface QuotaAdmissionStoreModule {
  createQuotaAdmissionStore: (options: { home: string }) => QuotaAdmissionStore;
}

async function main(): Promise<void> {
  const payload = workerData as WorkerPayload;
  const moduleUrl = new URL('../../../src/quota-admission-store.js', import.meta.url).href;
  const storeModule = (await import(moduleUrl)) as unknown as QuotaAdmissionStoreModule;
  if (typeof storeModule.createQuotaAdmissionStore !== 'function') {
    throw new Error('HONEST RED: quota store createQuotaAdmissionStore export is absent');
  }

  const store = storeModule.createQuotaAdmissionStore({ home: payload.home });
  const ready = new Int32Array(payload.ready);
  const start = new Int32Array(payload.start);
  Atomics.add(ready, 0, 1);
  Atomics.notify(ready, 0);
  while (Atomics.load(start, 0) === 0) Atomics.wait(start, 0, 0);
  let result: unknown;
  if (payload.operation === 'refresh') {
    if (!payload.sourceKey || !payload.observation || !payload.collectorDir) {
      throw new Error('refresh worker payload is incomplete');
    }
    result = await store.refreshObservation({ source_key: payload.sourceKey }, async () => {
      mkdirSync(payload.collectorDir as string, { recursive: true });
      writeFileSync(
        join(payload.collectorDir as string, `call-${payload.workerId ?? 'unknown'}.json`),
        '{"collector_called":true}\n',
        { flag: 'wx', mode: 0o600 },
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
      return structuredClone(payload.observation as Record<string, unknown>);
    });
  } else {
    if (!payload.request) throw new Error('reservation worker request is missing');
    result = await store.reserve(payload.request);
  }
  parentPort?.postMessage({ ok: true, result });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  parentPort?.postMessage({ ok: false, error: message });
});
