export interface SourceMutationProbe {
  readonly effectClass: string;
  readonly source: string;
}

export const SOURCE_MUTATION_PROBES: readonly SourceMutationProbe[] = Object.freeze([
  {
    effectClass: 'process-spawn',
    source: "require('node:child_process').spawn('provider')",
  },
  {
    effectClass: 'network-socket',
    source: "require('node:net').connect(443)",
  },
  {
    effectClass: 'network-dns',
    source: "require('node:dns').resolve('provider.invalid')",
  },
  {
    effectClass: 'network-http',
    source: "require('node:http').request('http://provider.invalid')",
  },
  {
    effectClass: 'provider-invocation',
    source: "void import('openai')",
  },
  {
    effectClass: 'model-invocation',
    source: 'model.invoke({})',
  },
  {
    effectClass: 'os-keychain',
    source: 'keychain.read()',
  },
  {
    effectClass: 'board-write',
    source: 'writeBoard({})',
  },
  {
    effectClass: 'repo-write',
    source: 'repo.write({})',
  },
  {
    effectClass: 'credential-mutation',
    source: 'account.login({})',
  },
  {
    effectClass: 'ambient-filesystem-io',
    source: "require('node:fs').writeFileSync('/tmp/quota-ambient-proof', 'mutated')",
  },
]);
