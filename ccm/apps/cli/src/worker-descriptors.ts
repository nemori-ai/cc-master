export type WorkerHarness = 'codex' | 'claude-code' | 'cursor-agent';
export type WorkerExecutableKey = 'codex' | 'claude' | 'cursor-agent';

export interface WorkerDescriptor {
  harness: WorkerHarness;
  executableKey: WorkerExecutableKey;
  defaultAgentHelpPrefix: readonly string[];
}

export const WORKER_HARNESSES = ['codex', 'claude-code', 'cursor-agent'] as const;

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
});

export function workerDescriptor(harness: string): WorkerDescriptor | null {
  return (WORKER_HARNESSES as readonly string[]).includes(harness)
    ? DESCRIPTORS[harness as WorkerHarness]
    : null;
}
