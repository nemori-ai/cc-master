export type WorkerHarness = 'codex' | 'claude-code' | 'cursor-agent' | 'kimi-code';
export type WorkerExecutableKey = 'codex' | 'claude' | 'cursor-agent' | 'kimi';

export interface WorkerDescriptor {
  harness: WorkerHarness;
  executableKey: WorkerExecutableKey;
  defaultAgentHelpPrefix: readonly string[];
}

export const WORKER_HARNESSES = ['codex', 'claude-code', 'cursor-agent', 'kimi-code'] as const;

const DESCRIPTORS: Readonly<Record<WorkerHarness, WorkerDescriptor>> = Object.freeze({
  codex: Object.freeze({
    harness: 'codex',
    executableKey: 'codex',
    defaultAgentHelpPrefix: ['exec'],
  }),
  'claude-code': Object.freeze({
    harness: 'claude-code',
    executableKey: 'claude',
    defaultAgentHelpPrefix: [],
  }),
  'cursor-agent': Object.freeze({
    harness: 'cursor-agent',
    executableKey: 'cursor-agent',
    defaultAgentHelpPrefix: [],
  }),
  // kimi -p is the top-level headless entry (no exec subcommand); help/run pass argv straight through.
  'kimi-code': Object.freeze({
    harness: 'kimi-code',
    executableKey: 'kimi',
    defaultAgentHelpPrefix: [],
  }),
});

export function workerDescriptor(harness: string): WorkerDescriptor | null {
  return (WORKER_HARNESSES as readonly string[]).includes(harness)
    ? DESCRIPTORS[harness as WorkerHarness]
    : null;
}
