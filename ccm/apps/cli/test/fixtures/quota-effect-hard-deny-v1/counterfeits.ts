export interface CounterfeitProbe {
  readonly id: string;
  readonly source: string;
}

export interface CounterfeitApiRow {
  readonly apiId: string;
  readonly effectClass: string;
  readonly sourceKinds?: readonly ('production' | 'test')[];
  readonly probes: readonly CounterfeitProbe[];
}

export const COUNTERFEIT_API_ROWS: readonly CounterfeitApiRow[] = Object.freeze([
  {
    apiId: 'process-spawn.module.child-process',
    effectClass: 'process-spawn',
    probes: [
      {
        id: 'bare-alias',
        source: "import { spawn as launch } from 'child_process'; launch('provider');",
      },
      {
        id: 'node-dynamic',
        source: "const cp = await import('node:child_process'); cp.spawn('provider');",
      },
    ],
  },
  {
    apiId: 'process-spawn.call.bun-spawn',
    effectClass: 'process-spawn',
    probes: [{ id: 'alias', source: "const launch = Bun.spawn; launch(['provider']);" }],
  },
  {
    apiId: 'process-spawn.construct.deno-command',
    effectClass: 'process-spawn',
    probes: [{ id: 'construct', source: "const Command = Deno.Command; new Command('provider');" }],
  },
  {
    apiId: 'network-socket.module.socket',
    effectClass: 'network-socket',
    probes: [
      { id: 'net', source: "import { connect } from 'net'; connect(443);" },
      { id: 'node-tls', source: "await import('node:tls');" },
      { id: 'dgram-require', source: "require('dgram').createSocket('udp4');" },
    ],
  },
  {
    apiId: 'network-socket.construct.websocket',
    effectClass: 'network-socket',
    probes: [
      {
        id: 'global-alias',
        source: "const Socket = globalThis.WebSocket; new Socket('wss://provider.invalid');",
      },
    ],
  },
  {
    apiId: 'network-dns.module.dns',
    effectClass: 'network-dns',
    probes: [
      {
        id: 'promises',
        source: "import { resolve } from 'dns/promises'; resolve('provider.invalid');",
      },
      { id: 'node-dynamic', source: "await import('node:dns');" },
    ],
  },
  {
    apiId: 'network-http.module.http',
    effectClass: 'network-http',
    probes: [
      {
        id: 'https',
        source: "import { request } from 'https'; request('https://provider.invalid');",
      },
      { id: 'node-http2', source: "await import('node:http2');" },
    ],
  },
  {
    apiId: 'network-http.call.fetch',
    effectClass: 'network-http',
    probes: [
      {
        id: 'global-alias',
        source: "const request = globalThis.fetch; request('https://provider.invalid');",
      },
    ],
  },
  {
    apiId: 'provider-invocation.module.sdk',
    effectClass: 'provider-invocation',
    probes: [
      {
        id: 'openai-dynamic',
        source: "const sdk = await import('openai'); sdk.responses.create({});",
      },
      { id: 'anthropic', source: "import Anthropic from '@anthropic-ai/sdk'; new Anthropic();" },
      { id: 'google-require', source: "require('@google/generative-ai');" },
    ],
  },
  {
    apiId: 'provider-invocation.call.provider',
    effectClass: 'provider-invocation',
    probes: [
      {
        id: 'destructured-alias',
        source: 'const p = provider; const { invoke: call } = p; call({});',
      },
    ],
  },
  {
    apiId: 'model-invocation.call.model',
    effectClass: 'model-invocation',
    probes: [
      {
        id: 'member-alias',
        source: "const generate = model.generate; generate({ prompt: 'quota' });",
      },
    ],
  },
  {
    apiId: 'model-invocation.call.client',
    effectClass: 'model-invocation',
    probes: [{ id: 'responses', source: 'const client = responses; client.create({});' }],
  },
  {
    apiId: 'os-keychain.module.keychain',
    effectClass: 'os-keychain',
    probes: [
      { id: 'keytar-dynamic', source: "await import('keytar');" },
      { id: 'keychain', source: "import keychain from 'keychain'; keychain.read();" },
    ],
  },
  {
    apiId: 'os-keychain.call.keychain',
    effectClass: 'os-keychain',
    probes: [
      {
        id: 'password-alias',
        source: "const readSecret = keychain.getPassword; readSecret('auth');",
      },
    ],
  },
  {
    apiId: 'board-write.call.writer',
    effectClass: 'board-write',
    probes: [{ id: 'writer-alias', source: 'const persist = writeBoard; persist({});' }],
  },
  {
    apiId: 'repo-write.call.writer',
    effectClass: 'repo-write',
    probes: [
      {
        id: 'repo-alias',
        source: "const repository = repo; repository.commit({ message: 'counterfeit' });",
      },
    ],
  },
  {
    apiId: 'credential-mutation.call.account-session',
    effectClass: 'credential-mutation',
    probes: [
      {
        id: 'session-alias',
        source:
          "const current = session; const change = current.switch; change({ provider: 'cursor' });",
      },
    ],
  },
  {
    apiId: 'credential-mutation.call.credential-auth',
    effectClass: 'credential-mutation',
    probes: [
      {
        id: 'auth-destructure',
        source: "const { write: persist } = auth; persist({ token: 'secret' });",
      },
    ],
  },
  {
    apiId: 'ambient-filesystem-io.module.node-fs',
    effectClass: 'ambient-filesystem-io',
    sourceKinds: ['test'],
    probes: [
      {
        id: 'node-fs-direct-write',
        source:
          "import { writeFileSync } from 'node:fs'; writeFileSync('/tmp/quota-ambient-proof', 'mutated');",
      },
      {
        id: 'fs-promises-dynamic',
        source: "void import('fs/promises');",
      },
    ],
  },
]);
