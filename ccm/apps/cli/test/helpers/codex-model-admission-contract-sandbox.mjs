// Test-only process boundary for the Codex A-now contract. This wrapper appends observer events to
// a dedicated parent pipe at attempt time; evaluator return values and stdout cannot erase them.

import { AsyncLocalStorage, createHook } from 'node:async_hooks';
import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import workerThreads from 'node:worker_threads';

const RESULT_FD = 3;
const OBSERVER_JOURNAL_FD = 4;

let journalSequence = 0;

const originalWriteSync = fs.writeSync.bind(fs);

function writeBuffer(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = originalWriteSync(fd, buffer, offset, buffer.length - offset);
    if (written <= 0) throw new Error(`observer channel ${fd} made no write progress`);
    offset += written;
  }
}

function writeJsonLine(fd, value) {
  writeBuffer(fd, Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'));
}

function appendObserverEvent(event) {
  journalSequence += 1;
  writeJsonLine(OBSERVER_JOURNAL_FD, { sequence: journalSequence, ...event });
}

function deniedBoundary(kind, operation) {
  return (..._args) => {
    appendObserverEvent({ type: 'boundary', kind, operation });
    const error = new Error(`CCM_EFFECT_BOUNDARY_DENIED:${kind}:${operation}`);
    error.code = 'CCM_EFFECT_BOUNDARY_DENIED';
    throw error;
  };
}

function patchMethods(target, kind, methods) {
  for (const method of methods) {
    if (typeof target[method] === 'function') target[method] = deniedBoundary(kind, method);
  }
}

function patchAllMethodsExcept(target, kind, allowedMethods = new Set()) {
  for (const method of Reflect.ownKeys(target)) {
    if (typeof method !== 'string' || allowedMethods.has(method)) continue;
    if (typeof target[method] !== 'function') continue;
    const descriptor = Object.getOwnPropertyDescriptor(target, method);
    const replacement = deniedBoundary(kind, method);
    if (descriptor && 'value' in descriptor && descriptor.writable) {
      target[method] = replacement;
    } else if (descriptor?.configurable) {
      Object.defineProperty(target, method, {
        configurable: true,
        enumerable: descriptor.enumerable,
        value: replacement,
        writable: true,
      });
    } else {
      throw new TypeError(`cannot instrument ${kind}.${method}`);
    }
  }
}

function opensForWrite(flags) {
  if (typeof flags === 'string') return /[wa+]/.test(flags);
  if (typeof flags !== 'number') return true;
  const writeMask =
    fs.constants.O_WRONLY |
    fs.constants.O_RDWR |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC |
    fs.constants.O_APPEND;
  return (flags & writeMask) !== 0;
}

const originalOpen = fs.open.bind(fs);
const originalOpenSync = fs.openSync.bind(fs);
const originalPromisesOpen = fs.promises.open.bind(fs.promises);
fs.open = (path, flags, ...rest) =>
  opensForWrite(flags)
    ? deniedBoundary('filesystem', 'open')(path, flags, ...rest)
    : originalOpen(path, flags, ...rest);
fs.openSync = (path, flags, ...rest) =>
  opensForWrite(flags)
    ? deniedBoundary('filesystem', 'openSync')(path, flags, ...rest)
    : originalOpenSync(path, flags, ...rest);
fs.promises.open = (path, flags, ...rest) =>
  opensForWrite(flags)
    ? deniedBoundary('filesystem', 'promises.open')(path, flags, ...rest)
    : originalPromisesOpen(path, flags, ...rest);

// Keep the original pre-import probes active while tsx binds the implementation. These calls are
// known not to replace loader primitives such as Worker and net.Socket. The exhaustive,
// deny-by-default function sweep is armed immediately after binding.
patchMethods(fs, 'filesystem', [
  'appendFile',
  'appendFileSync',
  'chmod',
  'chmodSync',
  'chown',
  'chownSync',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'createWriteStream',
  'link',
  'linkSync',
  'mkdir',
  'mkdirSync',
  'mkdtemp',
  'mkdtempSync',
  'rename',
  'renameSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
  'symlink',
  'symlinkSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'write',
  'writeFile',
  'writeFileSync',
  'writeSync',
]);
patchMethods(fs.promises, 'filesystem', [
  'appendFile',
  'chmod',
  'chown',
  'copyFile',
  'cp',
  'link',
  'mkdir',
  'mkdtemp',
  'rename',
  'rm',
  'rmdir',
  'symlink',
  'truncate',
  'unlink',
  'write',
  'writeFile',
]);
patchMethods(childProcess, 'process', [
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync',
]);
patchMethods(http, 'network', ['get', 'request', 'createServer']);
patchMethods(https, 'network', ['get', 'request', 'createServer']);
patchMethods(http2, 'network', ['connect', 'createServer', 'createSecureServer']);
patchMethods(net, 'network', ['connect', 'createConnection', 'createServer']);
patchMethods(tls, 'network', ['connect', 'createServer']);
patchMethods(dgram, 'network', ['createSocket']);
patchMethods(dns, 'network', [
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
]);
patchMethods(dns.promises, 'network', [
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
]);
syncBuiltinESMExports();

if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = deniedBoundary('network', 'fetch');
}
if (typeof globalThis.WebSocket === 'function') {
  globalThis.WebSocket = class DeniedWebSocket {
    constructor() {
      deniedBoundary('network', 'WebSocket')();
    }
  };
}
process.chdir = deniedBoundary('process', 'chdir');
process.kill = deniedBoundary('process', 'kill');
process.abort = deniedBoundary('process', 'abort');
process.exit = deniedBoundary('process', 'exit');

function armAllRuntimeBoundaries() {
  patchAllMethodsExcept(fs, 'filesystem');
  patchAllMethodsExcept(fs.promises, 'filesystem');
  patchAllMethodsExcept(childProcess, 'process');
  patchAllMethodsExcept(http, 'network');
  patchAllMethodsExcept(https, 'network');
  patchAllMethodsExcept(http2, 'network');
  patchAllMethodsExcept(net, 'network');
  patchAllMethodsExcept(tls, 'network');
  patchAllMethodsExcept(dgram, 'network');
  patchAllMethodsExcept(dns, 'network');
  patchAllMethodsExcept(dns.promises, 'network');
  // tsx constructs its transform Worker while binding a .ts module. The child grants that loader
  // capability, then replaces the complete worker-thread function surface before evaluator code.
  patchAllMethodsExcept(workerThreads, 'process');
  syncBuiltinESMExports();
}

function forbiddenPort(action, counter) {
  return (..._args) => {
    appendObserverEvent({ type: 'semantic', action, counter });
    const error = new Error(`CCM_SEMANTIC_EFFECT_DENIED:${action}`);
    error.code = 'CCM_SEMANTIC_EFFECT_DENIED';
    throw error;
  };
}

const effectPorts = Object.freeze({
  controlledFixtureSpawn: async (compiledInvocation) => {
    appendObserverEvent({ type: 'effect', counter: 'controlled_fixture_spawns' });
    await new Promise((resolve) => setImmediate(resolve));
    return Object.freeze({
      schema: 'ccm/provider-started-handle/v1',
      handle_ref: 'controlled-fixture://model-admission-contract',
      provider_target: compiledInvocation?.provider_target ?? 'controlled-fixture',
    });
  },
  realProviderRequest: forbiddenPort('real-provider-request', 'real_provider_requests'),
  paidCanary: forbiddenPort('paid-canary', 'paid_canaries'),
  login: forbiddenPort('login', 'account_mutations'),
  logout: forbiddenPort('logout', 'account_mutations'),
  switchAccount: forbiddenPort('switch-account', 'account_mutations'),
  importCredential: forbiddenPort('import-credential', 'credential_writes'),
  copyCredential: forbiddenPort('copy-credential', 'credential_writes'),
  deviceAuth: forbiddenPort('device-auth', 'account_mutations'),
  refreshAuth: forbiddenPort('refresh-auth', 'account_mutations'),
  writeCredential: forbiddenPort('write-credential', 'credential_writes'),
  writeConfig: forbiddenPort('write-config', 'config_writes'),
  writeBoard: forbiddenPort('write-board', 'board_writes'),
  remoteMutation: forbiddenPort('remote-mutation', 'remote_mutations'),
});

async function readRequest() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function execute(request, implementation) {
  if (request.mode === 'evaluate') {
    const evaluate = implementation[request.evaluator];
    if (typeof evaluate !== 'function') throw new TypeError(`${request.evaluator} export`);
    return { result: await evaluate(request.value) };
  }
  if (request.mode === 'effect') {
    const evaluate = implementation.evaluateEffectCase;
    if (typeof evaluate !== 'function') throw new TypeError('evaluateEffectCase export');
    return { result: await evaluate(request.value, effectPorts) };
  }
  if (request.mode === 'authority') {
    const createHarness = implementation.createAuthorityHarness;
    if (typeof createHarness !== 'function') throw new TypeError('createAuthorityHarness export');
    const harness = await createHarness(request.value, {
      spawnControlledFixture: effectPorts.controlledFixtureSpawn,
    });
    if (harness === null || typeof harness.invoke !== 'function') {
      throw new TypeError('createAuthorityHarness must return { invoke() }');
    }
    const invoke = () => Promise.resolve().then(() => harness.invoke());
    let results;
    if (request.invocation.mode === 'concurrent') {
      results = await Promise.all(Array.from({ length: request.invocation.count }, () => invoke()));
    } else {
      results = [];
      for (let index = 0; index < request.invocation.count; index += 1) {
        results.push(await invoke());
      }
    }
    return { results };
  }
  throw new TypeError(`unknown sandbox mode: ${request.mode}`);
}

const invocationScope = new AsyncLocalStorage();
const INVOCATION_SCOPE = Object.freeze({ name: 'model-admission-contract-invocation' });
const pendingInvocationResources = new Map();
const invocationHook = createHook({
  init(asyncId, type) {
    if (invocationScope.getStore() === INVOCATION_SCOPE) {
      pendingInvocationResources.set(asyncId, type);
    }
  },
  destroy(asyncId) {
    pendingInvocationResources.delete(asyncId);
  },
  promiseResolve(asyncId) {
    pendingInvocationResources.delete(asyncId);
  },
});
invocationHook.enable();

async function awaitInvocationQuiescence() {
  const deadline = Date.now() + 1_000;
  let emptyTurns = 0;
  while (emptyTurns < 2) {
    await new Promise((resolve) => setImmediate(resolve));
    if (pendingInvocationResources.size === 0) emptyTurns += 1;
    else emptyTurns = 0;
    if (Date.now() >= deadline) {
      appendObserverEvent({
        type: 'boundary',
        kind: 'async',
        operation: `non-quiescent:${[...new Set(pendingInvocationResources.values())].sort().join(',')}`,
      });
      return;
    }
  }
}

let reply;
let protocolFault;
try {
  const request = await readRequest();
  protocolFault = request.protocol_fault;
  const implementation = await import(request.module_url);
  armAllRuntimeBoundaries();
  const output = await invocationScope.run(INVOCATION_SCOPE, () =>
    execute(request, implementation),
  );
  await invocationScope.run(undefined, () => awaitInvocationQuiescence());
  reply = { ok: true, ...output };
} catch (cause) {
  await invocationScope.run(undefined, () => awaitInvocationQuiescence());
  reply = {
    ok: false,
    error: {
      name: cause instanceof Error ? cause.name : 'Error',
      message: cause instanceof Error ? cause.message : String(cause),
      ...(cause && typeof cause === 'object' && 'code' in cause
        ? { code: String(cause.code) }
        : {}),
    },
  };
}

let resultFrame = reply;
if (protocolFault === 'success-with-error') {
  resultFrame = {
    ok: true,
    result: { status: 'malformed-success' },
    error: { name: 'ForgedError', message: 'success and error must not coexist' },
  };
} else if (protocolFault === 'non-string-error-code') {
  resultFrame = {
    ok: false,
    error: { name: 'ForgedError', message: 'error code must be a string', code: 37 },
  };
} else if (protocolFault === 'unknown-result-key') {
  resultFrame = {
    ok: true,
    result: { status: 'malformed-success' },
    evaluator_authority: 1,
  };
} else if (protocolFault === 'success-missing-result') {
  resultFrame = { ok: true };
} else if (protocolFault === 'failure-with-result') {
  resultFrame = {
    ok: false,
    result: { status: 'must-not-escape' },
    error: { name: 'ForgedError', message: 'failure must not carry a result' },
  };
}

if (protocolFault === 'malformed-result') {
  writeBuffer(RESULT_FD, Buffer.from('{malformed-result\n', 'utf8'));
} else if (protocolFault !== 'missing-result') {
  writeJsonLine(RESULT_FD, resultFrame);
  if (protocolFault === 'duplicate-result') writeJsonLine(RESULT_FD, resultFrame);
}
