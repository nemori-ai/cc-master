'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const moduleApi = require('node:module');

const capture = process.env.CCM_XH_C3_EFFECT_CAPTURE || '';
let allowedChildren = [];
try {
  const parsed = JSON.parse(process.env.CCM_XH_C3_ALLOWED_CHILDREN_JSON || '[]');
  if (Array.isArray(parsed)) allowedChildren = parsed.map((value) => path.resolve(String(value)));
} catch {
  allowedChildren = [];
}

function record(kind, detail) {
  if (!capture) return;
  fs.mkdirSync(path.dirname(capture), { recursive: true });
  fs.appendFileSync(capture, `${JSON.stringify({ type: 'effect', kind, detail: String(detail || '') })}\n`);
}

function block(kind, detail) {
  record(kind, detail);
  const error = new Error(`XH C3 effect sentinel blocked ${kind}: ${detail || ''}`);
  error.code = 'CCM_XH_C3_EFFECT_BLOCKED';
  throw error;
}

function normalized(command) {
  const text = Array.isArray(command) ? command[0] : command;
  const value = String(text || '');
  if (!value || !path.isAbsolute(value)) return '';
  return path.resolve(value);
}

function childAllowed(command, args) {
  const executable = normalized(command);
  if (allowedChildren.includes(executable)) return true;
  if (executable !== path.resolve(process.execPath)) return false;
  const argv = Array.isArray(args) ? args : [];
  const script = argv.length > 0 && typeof argv[0] === 'string' ? normalized(argv[0]) : '';
  return allowedChildren.includes(script);
}

for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[method];
  childProcess[method] = function guardedCommand(command, ...rest) {
    const args = Array.isArray(rest[0]) ? rest[0] : [];
    if (!childAllowed(command, args)) return block('process', normalized(command) || String(command || ''));
    return original.call(this, command, ...rest);
  };
}

for (const method of ['exec', 'execSync']) {
  childProcess[method] = function guardedShell(command) {
    return block('process:shell', String(command || ''));
  };
}

function blockMethods(moduleName, methods) {
  const target = require(moduleName);
  for (const method of methods) {
    if (typeof target[method] !== 'function') continue;
    target[method] = function blockedNetworkCall(...args) {
      const detail = typeof args[0] === 'string' ? args[0] : method;
      return block(`network:${moduleName}.${method}`, detail);
    };
  }
}

blockMethods('node:http', ['request', 'get']);
blockMethods('node:https', ['request', 'get']);
blockMethods('node:http2', ['connect']);
blockMethods('node:net', ['connect', 'createConnection']);
blockMethods('node:tls', ['connect']);
blockMethods('node:dgram', ['createSocket']);
blockMethods('node:dns', ['lookup', 'resolve', 'resolve4', 'resolve6']);

globalThis.fetch = async function blockedFetch(resource) {
  return block('network:fetch', String(resource || ''));
};

moduleApi.syncBuiltinESMExports();
