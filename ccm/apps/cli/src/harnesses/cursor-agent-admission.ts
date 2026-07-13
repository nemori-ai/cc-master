import type {
  CursorAgentAdmission,
  CursorAgentAdmissionEvidence,
  CursorAgentAdmissionRequest,
  HarnessCliProbe,
  SurfaceFact,
} from './types.js';

export type CursorAgentProcessFailureKind =
  | 'binary-unavailable'
  | 'authentication-unavailable'
  | 'quota-unavailable'
  | 'sandbox-unavailable'
  | 'transport-failed';

export interface CursorAgentProcessResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  failure?: {
    phase: 'pre-exec' | 'runtime';
    kind: CursorAgentProcessFailureKind;
  };
}

export interface CursorAgentProcessInvocation {
  command: string;
  args: readonly string[];
}

export interface CursorAgentAdmissionEffects {
  runProcess(invocation: CursorAgentProcessInvocation): CursorAgentProcessResult;
}

export interface CursorAgentAdmissionProbeInput {
  binary: HarnessCliProbe;
  authentication: SurfaceFact;
  quota: SurfaceFact;
  request: CursorAgentAdmissionRequest;
  prompt: string;
}

export function createUnprobedCursorAgentAdmission(
  binary: HarnessCliProbe,
  authentication: SurfaceFact,
  quota: SurfaceFact,
): CursorAgentAdmission {
  return evaluateCursorAgentAdmission({
    request: null,
    binary,
    authentication,
    quota,
    sandbox: 'unknown',
    result_schema: 'unknown',
    task_acceptance: 'unknown',
    transport: { terminated: false, exit_code: null, signal: null },
  });
}

export function probeCursorAgentAdmission(
  input: CursorAgentAdmissionProbeInput,
  effects: CursorAgentAdmissionEffects,
): CursorAgentAdmission {
  const preflight = preflightBlocker(input);
  if (preflight) {
    return evaluateCursorAgentAdmission({
      request: input.request,
      binary: input.binary,
      authentication: input.authentication,
      quota: input.quota,
      sandbox: input.request.sandbox === 'not-requested' ? 'not-requested' : 'unknown',
      result_schema: 'unknown',
      task_acceptance: 'unknown',
      transport: { terminated: false, exit_code: null, signal: null },
    });
  }

  const processResult = effects.runProcess({
    command: input.binary.path as string,
    args: cursorAgentArgs(input.request, input.prompt),
  });
  return evaluateCursorAgentAdmission(admissionEvidenceFromProcess(input, processResult));
}

export function evaluateCursorAgentAdmission(
  evidence: CursorAgentAdmissionEvidence,
): CursorAgentAdmission {
  const blockers: string[] = [];
  if (!evidence.request) blockers.push('request.unknown');
  if (!evidence.binary.available) blockers.push('binary.unavailable');
  if (evidence.authentication.state !== 'available') {
    blockers.push(`authentication.${evidence.authentication.state}`);
  }
  if (evidence.quota.state !== 'available') blockers.push(`quota.${evidence.quota.state}`);

  if (evidence.request?.sandbox === 'required') {
    if (evidence.sandbox !== 'supported') blockers.push(`sandbox.${evidence.sandbox}`);
  } else if (evidence.request?.sandbox === 'not-requested') {
    if (evidence.sandbox !== 'not-requested') blockers.push(`sandbox.${evidence.sandbox}`);
  }

  if (evidence.result_schema !== 'valid') {
    blockers.push(`result_schema.${evidence.result_schema}`);
  }
  if (evidence.task_acceptance !== 'accepted') {
    blockers.push(`task_acceptance.${evidence.task_acceptance}`);
  }
  if (!evidence.transport.terminated) blockers.push('transport.not-terminated');
  if (evidence.transport.exit_code !== null && evidence.transport.exit_code !== 0) {
    blockers.push(`transport.exit-${evidence.transport.exit_code}`);
  }
  if (evidence.transport.signal) blockers.push(`transport.signal-${evidence.transport.signal}`);

  return {
    schema: 'ccm/cursor-agent-admission/v1',
    ...evidence,
    blockers,
    schedulable: blockers.length === 0,
  };
}

export function cursorAgentAdmissionMatchesRequest(
  admission: CursorAgentAdmission,
  request: CursorAgentAdmissionRequest,
): boolean {
  return (
    admission.schedulable &&
    admission.request?.mode === request.mode &&
    admission.request.sandbox === request.sandbox
  );
}

function preflightBlocker(input: CursorAgentAdmissionProbeInput): string | null {
  if (!input.binary.available || !input.binary.path) return 'binary.unavailable';
  if (input.authentication.state !== 'available') {
    return `authentication.${input.authentication.state}`;
  }
  if (input.quota.state !== 'available') return `quota.${input.quota.state}`;
  return null;
}

function cursorAgentArgs(request: CursorAgentAdmissionRequest, prompt: string): string[] {
  const args = ['--print', '--output-format', 'json', '--trust'];
  if (request.sandbox === 'required') args.push('--sandbox', 'enabled');
  if (request.mode !== 'agent') args.push('--mode', request.mode);
  args.push(prompt);
  return args;
}

function admissionEvidenceFromProcess(
  input: CursorAgentAdmissionProbeInput,
  result: CursorAgentProcessResult,
): CursorAgentAdmissionEvidence {
  const binary = { ...input.binary };
  const authentication = { ...input.authentication };
  const quota = { ...input.quota };
  const transport = {
    terminated: result.exitCode !== null || result.signal !== null,
    exit_code: result.exitCode,
    signal: result.signal,
  };

  if (result.failure?.kind === 'binary-unavailable') binary.available = false;
  if (result.failure?.kind === 'authentication-unavailable') {
    authentication.state = 'unavailable';
    authentication.source = 'cursor-agent-process';
  }
  if (result.failure?.kind === 'quota-unavailable') {
    quota.state = 'unavailable';
    quota.source = 'cursor-agent-process';
  }

  if (result.failure) {
    return {
      request: input.request,
      binary,
      authentication,
      quota,
      sandbox:
        result.failure.kind === 'sandbox-unavailable'
          ? 'unavailable'
          : input.request.sandbox === 'not-requested'
            ? 'not-requested'
            : 'unknown',
      result_schema: 'unknown',
      task_acceptance: 'unknown',
      transport,
    };
  }

  const terminal = parseTerminalResult(result.stdout, result.exitCode);
  return {
    request: input.request,
    binary,
    authentication,
    quota,
    sandbox: input.request.sandbox === 'required' ? 'supported' : 'not-requested',
    result_schema: terminal.result_schema,
    task_acceptance: terminal.task_acceptance,
    transport,
  };
}

function parseTerminalResult(
  stdout: string,
  exitCode: number | null,
): Pick<CursorAgentAdmissionEvidence, 'result_schema' | 'task_acceptance'> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      result_schema: exitCode === 0 ? 'invalid-empty' : 'unknown',
      task_acceptance: 'unknown',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { result_schema: 'invalid-shape', task_acceptance: 'unknown' };
  }

  if (!isTerminalResult(parsed)) {
    return { result_schema: 'invalid-shape', task_acceptance: 'unknown' };
  }
  if (parsed.subtype === 'success' && parsed.is_error === false && exitCode === 0) {
    return { result_schema: 'valid', task_acceptance: 'accepted' };
  }
  if (parsed.subtype !== 'success' && parsed.is_error === true) {
    return { result_schema: 'valid', task_acceptance: 'rejected' };
  }
  return { result_schema: 'invalid-shape', task_acceptance: 'unknown' };
}

function isTerminalResult(value: unknown): value is {
  type: 'result';
  subtype: string;
  is_error: boolean;
  result: string;
  session_id: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'result' &&
    typeof candidate.subtype === 'string' &&
    typeof candidate.is_error === 'boolean' &&
    typeof candidate.result === 'string' &&
    typeof candidate.session_id === 'string' &&
    candidate.session_id.length > 0
  );
}

export type {
  CursorAgentAdmission,
  CursorAgentAdmissionRequest,
} from './types.js';
