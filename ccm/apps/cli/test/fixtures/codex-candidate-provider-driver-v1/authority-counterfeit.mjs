import * as childProcess from 'node:child_process';
import * as cluster from 'node:cluster';
import * as dgram from 'node:dgram';
import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { Worker } from 'node:worker_threads';

const attempts = {
  'net.connect': () => net.connect({ port: -1 }),
  'net.createConnection': () => net.createConnection({ port: -1 }),
  'dns.lookup': () => dns.lookup('counterfeit.invalid'),
  'dns.resolve': () => dns.resolve('counterfeit.invalid'),
  'dns.resolve4': () => dns.resolve4('counterfeit.invalid'),
  'dns.resolve6': () => dns.resolve6('counterfeit.invalid'),
  'dns.resolveAny': () => dns.resolveAny('counterfeit.invalid'),
  'http.request': () => http.request('ftp://counterfeit.invalid'),
  'http.get': () => http.get('ftp://counterfeit.invalid'),
  'https.request': () => https.request('http://counterfeit.invalid'),
  'https.get': () => https.get('http://counterfeit.invalid'),
  'tls.connect': () => tls.connect({ port: -1 }),
  'dgram.createSocket': () => dgram.createSocket('counterfeit-invalid-socket-type'),
  'globalThis.fetch': () => {
    const rejected = globalThis.fetch('counterfeit invalid URL');
    void rejected.catch(() => {});
  },
  'globalThis.WebSocket': () => {
    if (typeof globalThis.WebSocket !== 'function') {
      throw new Error('counterfeit WebSocket surface is unavailable');
    }
    return new globalThis.WebSocket('counterfeit invalid URL');
  },
  'child_process.spawn': () => childProcess.spawn(undefined),
  'child_process.spawnSync': () => childProcess.spawnSync(undefined),
  'child_process.exec': () => childProcess.exec(undefined),
  'child_process.execSync': () => childProcess.execSync(undefined),
  'child_process.execFile': () => childProcess.execFile(undefined),
  'child_process.execFileSync': () => childProcess.execFileSync(undefined),
  'child_process.fork': () => childProcess.fork(undefined),
  'worker_threads.Worker': () => new Worker(undefined),
  'cluster.fork': () =>
    cluster.fork(
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('counterfeit cluster escaped its authority guard');
          },
        },
      ),
    ),
};

export function attemptAuthorityEscape(api) {
  const attempt = attempts[api];
  if (typeof attempt !== 'function') throw new Error(`unknown counterfeit authority API: ${api}`);
  return attempt();
}
