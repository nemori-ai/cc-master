import {
  type AttachInstruction,
  type CapabilityResult,
  sessionAttachInstruction,
  type TrackedDispatchCapabilities,
  type TranscriptRef,
} from '@ccm/engine';
import { locateTranscriptFile } from './agent-probe.js';
import type { WorkerHarness } from './worker-descriptors.js';

export interface SessionIdentityObservation {
  sessionId: string;
  source: string;
}

export interface WorkerIdentityTracker {
  push(stream: 'stdout' | 'stderr', text: string): SessionIdentityObservation[];
  finish(): SessionIdentityObservation[];
}

export interface WorkerSessionCapabilities {
  transcript: CapabilityResult<TranscriptRef>;
  attach: CapabilityResult<AttachInstruction>;
}

const UNSUPPORTED_IDENTITY: Readonly<Record<'claude-code' | 'cursor-agent', string>> = {
  'claude-code': 'headless-session-identity-not-yet-observed',
  'cursor-agent': 'native-session-identity-not-proven',
};

export interface InitialWorkerCapabilityEvidence {
  readonly transcriptRef?: string | null;
  readonly env?: Record<string, string | undefined>;
}

export function initialIdentityCapability(
  harness: WorkerHarness,
): CapabilityResult<{ kind: 'session-id'; value: string }> {
  if (harness === 'codex' || harness === 'claude-code' || harness === 'kimi-code') {
    return { status: 'unavailable', reason: 'session-identity-not-yet-observed' };
  }
  return { status: 'unsupported', reason: UNSUPPORTED_IDENTITY[harness] };
}

export function initialWorkerCapabilities(
  harness: WorkerHarness,
  evidence: InitialWorkerCapabilityEvidence = {},
): TrackedDispatchCapabilities {
  const location = locateTranscriptFile(
    {
      harness,
      handleKind: 'none',
      handleValue: '',
      transcriptRef: evidence.transcriptRef,
    },
    { env: evidence.env },
  );
  const transcript: CapabilityResult<TranscriptRef> = location
    ? { status: 'supported', value: { path: location.path } }
    : {
        status: 'unavailable',
        reason: evidence.transcriptRef
          ? 'explicit-transcript-not-readable'
          : harness === 'cursor-agent'
            ? 'external-transcript-not-provided-or-readable'
            : 'session-identity-not-yet-observed',
      };
  if (harness === 'cursor-agent') {
    return {
      identity: initialIdentityCapability(harness),
      transcript,
      attach: { status: 'unsupported', reason: 'exact-session-attach-not-proven' },
    };
  }
  return {
    identity: initialIdentityCapability(harness),
    transcript,
    attach: { status: 'unavailable', reason: 'session-identity-not-yet-observed' },
  };
}

function nonempty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function parseIdentityLine(
  harness: WorkerHarness,
  line: string,
  structuredTransport: boolean,
): SessionIdentityObservation | null {
  if (harness === 'cursor-agent' || !structuredTransport) return null;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  if (harness === 'codex') {
    const sessionId = record.type === 'thread.started' ? nonempty(record.thread_id) : null;
    return sessionId ? { sessionId, source: 'codex-jsonl:thread.started' } : null;
  }
  if (harness === 'claude-code') {
    const sessionId = record.type === 'result' ? nonempty(record.session_id) : null;
    return sessionId ? { sessionId, source: 'claude-json:result' } : null;
  }
  const sessionId =
    record.role === 'meta' && record.type === 'session.resume_hint'
      ? nonempty(record.session_id)
      : null;
  return sessionId ? { sessionId, source: 'kimi-stream-json:session.resume_hint' } : null;
}

function optionValue(argv: readonly string[], name: string): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === name) return argv[index + 1] ?? null;
    if (value?.startsWith(`${name}=`)) return value.slice(name.length + 1);
  }
  return null;
}

function usesStructuredIdentityTransport(
  harness: WorkerHarness,
  providerArgv: readonly string[],
): boolean {
  if (harness === 'codex') return providerArgv.includes('--json');
  if (harness === 'cursor-agent') return false;
  const format = optionValue(providerArgv, '--output-format');
  return harness === 'claude-code'
    ? format === 'json' || format === 'stream-json'
    : format === 'stream-json';
}

export function explicitWorkerSessionIdentity(
  harness: WorkerHarness,
  providerArgv: readonly string[],
): SessionIdentityObservation | null {
  if (harness !== 'claude-code') return null;
  const values: string[] = [];
  for (let index = 0; index < providerArgv.length; index += 1) {
    const value = providerArgv[index];
    if (value === '--session-id') {
      const candidate = nonempty(providerArgv[index + 1]);
      if (candidate) values.push(candidate);
    } else if (value?.startsWith('--session-id=')) {
      const candidate = nonempty(value.slice('--session-id='.length));
      if (candidate) values.push(candidate);
    }
  }
  const unique = [...new Set(values)];
  const sessionId = unique.length === 1 ? unique[0] : null;
  if (!sessionId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(sessionId)) return null;
  return { sessionId, source: 'claude-argv:--session-id' };
}

export function createWorkerIdentityTracker(
  harness: WorkerHarness,
  providerArgv: readonly string[] = [],
): WorkerIdentityTracker {
  const buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
  const seen = new Set<string>();
  const structuredTransport = usesStructuredIdentityTransport(harness, providerArgv);

  const parse = (line: string): SessionIdentityObservation[] => {
    const observation = parseIdentityLine(harness, line.trim(), structuredTransport);
    if (!observation || seen.has(observation.sessionId)) return [];
    seen.add(observation.sessionId);
    return [observation];
  };

  return {
    push(stream, text) {
      if (harness === 'cursor-agent' || !structuredTransport) return [];
      buffers[stream] += text;
      const lines = buffers[stream].split(/\r?\n/u);
      buffers[stream] = lines.pop() ?? '';
      return lines.flatMap(parse);
    },
    finish() {
      if (harness === 'cursor-agent' || !structuredTransport) return [];
      const observations: SessionIdentityObservation[] = [];
      for (const stream of ['stdout', 'stderr'] as const) {
        if (buffers[stream] !== '') observations.push(...parse(buffers[stream]));
        buffers[stream] = '';
      }
      return observations;
    },
  };
}

export function sessionCapabilities(input: {
  harness: WorkerHarness;
  sessionId: string;
  cwd: string;
  env: Record<string, string | undefined>;
  transcriptRef?: string | null;
}): WorkerSessionCapabilities {
  if (input.harness === 'cursor-agent') {
    return {
      transcript: { status: 'unsupported', reason: 'native-transcript-is-sqlite-not-jsonl' },
      attach: { status: 'unsupported', reason: 'exact-session-attach-not-proven' },
    };
  }
  const location = locateTranscriptFile(
    {
      harness: input.harness,
      handleKind: 'session-id',
      handleValue: input.sessionId,
      transcriptRef: input.transcriptRef,
    },
    { env: input.env },
  );
  const transcript: CapabilityResult<TranscriptRef> = location
    ? { status: 'supported', value: { path: location.path } }
    : { status: 'unavailable', reason: 'session-transcript-not-found' };
  const attach = sessionAttachInstruction(input);
  if (!attach) throw new Error(`session attach is not supported for ${input.harness}`);
  return {
    transcript,
    attach: { status: 'supported', value: attach },
  };
}
