export type GuardApiKind = 'module' | 'call' | 'construct';
export type GuardSourceKind = 'production' | 'test';

export interface GuardImplementationRow {
  readonly id: string;
  readonly effectClass: string;
  readonly kind: GuardApiKind;
  readonly targets: readonly string[];
  readonly sourceKinds?: readonly GuardSourceKind[];
}

export const GUARD_IMPLEMENTATION_ROWS: readonly GuardImplementationRow[] = Object.freeze([
  // GUARD-CLASS:process-spawn:START
  {
    id: 'process-spawn.module.child-process',
    effectClass: 'process-spawn',
    kind: 'module',
    targets: ['child_process', 'node:child_process'],
  },
  {
    id: 'process-spawn.call.bun-spawn',
    effectClass: 'process-spawn',
    kind: 'call',
    targets: ['Bun.spawn'],
  },
  {
    id: 'process-spawn.construct.deno-command',
    effectClass: 'process-spawn',
    kind: 'construct',
    targets: ['Deno.Command'],
  },
  // GUARD-CLASS:process-spawn:END
  // GUARD-CLASS:network-socket:START
  {
    id: 'network-socket.module.socket',
    effectClass: 'network-socket',
    kind: 'module',
    targets: ['net', 'node:net', 'tls', 'node:tls', 'dgram', 'node:dgram'],
  },
  {
    id: 'network-socket.construct.websocket',
    effectClass: 'network-socket',
    kind: 'construct',
    targets: ['WebSocket', 'globalThis.WebSocket'],
  },
  // GUARD-CLASS:network-socket:END
  // GUARD-CLASS:network-dns:START
  {
    id: 'network-dns.module.dns',
    effectClass: 'network-dns',
    kind: 'module',
    targets: ['dns', 'node:dns', 'dns/promises', 'node:dns/promises'],
  },
  // GUARD-CLASS:network-dns:END
  // GUARD-CLASS:network-http:START
  {
    id: 'network-http.module.http',
    effectClass: 'network-http',
    kind: 'module',
    targets: ['http', 'node:http', 'https', 'node:https', 'http2', 'node:http2'],
  },
  {
    id: 'network-http.call.fetch',
    effectClass: 'network-http',
    kind: 'call',
    targets: ['fetch', 'globalThis.fetch'],
  },
  // GUARD-CLASS:network-http:END
  // GUARD-CLASS:provider-invocation:START
  {
    id: 'provider-invocation.module.sdk',
    effectClass: 'provider-invocation',
    kind: 'module',
    targets: ['openai', '@anthropic-ai/sdk', '@google/generative-ai'],
  },
  {
    id: 'provider-invocation.call.provider',
    effectClass: 'provider-invocation',
    kind: 'call',
    targets: ['provider.invoke', 'provider.spawn', 'provider.complete'],
  },
  // GUARD-CLASS:provider-invocation:END
  // GUARD-CLASS:model-invocation:START
  {
    id: 'model-invocation.call.model',
    effectClass: 'model-invocation',
    kind: 'call',
    targets: ['model.invoke', 'model.generate', 'model.complete'],
  },
  {
    id: 'model-invocation.call.client',
    effectClass: 'model-invocation',
    kind: 'call',
    targets: ['responses.create', 'messages.create'],
  },
  // GUARD-CLASS:model-invocation:END
  // GUARD-CLASS:os-keychain:START
  {
    id: 'os-keychain.module.keychain',
    effectClass: 'os-keychain',
    kind: 'module',
    targets: ['keytar', 'keychain'],
  },
  {
    id: 'os-keychain.call.keychain',
    effectClass: 'os-keychain',
    kind: 'call',
    targets: [
      'keychain.read',
      'keychain.write',
      'keychain.delete',
      'keychain.getPassword',
      'keychain.setPassword',
      'keychain.deletePassword',
    ],
  },
  // GUARD-CLASS:os-keychain:END
  // GUARD-CLASS:board-write:START
  {
    id: 'board-write.call.writer',
    effectClass: 'board-write',
    kind: 'call',
    targets: ['runWrite', 'writeBoard', 'mutateBoard', 'board.write', 'task.done'],
  },
  // GUARD-CLASS:board-write:END
  // GUARD-CLASS:repo-write:START
  {
    id: 'repo-write.call.writer',
    effectClass: 'repo-write',
    kind: 'call',
    targets: [
      'repo.write',
      'repo.commit',
      'repo.checkout',
      'repo.reset',
      'simpleGit',
      'isomorphicGit',
    ],
  },
  // GUARD-CLASS:repo-write:END
  // GUARD-CLASS:credential-mutation:START
  {
    id: 'credential-mutation.call.account-session',
    effectClass: 'credential-mutation',
    kind: 'call',
    targets: ['account.login', 'account.logout', 'account.switch', 'session.switch'],
  },
  {
    id: 'credential-mutation.call.credential-auth',
    effectClass: 'credential-mutation',
    kind: 'call',
    targets: ['credential.import', 'credential.copy', 'credential.write', 'auth.write'],
  },
  // GUARD-CLASS:credential-mutation:END
  // GUARD-CLASS:ambient-filesystem-io:START
  {
    id: 'ambient-filesystem-io.module.node-fs',
    effectClass: 'ambient-filesystem-io',
    kind: 'module',
    targets: ['fs', 'node:fs', 'fs/promises', 'node:fs/promises'],
    sourceKinds: ['test'],
  },
  // GUARD-CLASS:ambient-filesystem-io:END
]);
