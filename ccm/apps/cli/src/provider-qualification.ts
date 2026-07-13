import {
  createProviderEvidence,
  type ProviderBinaryIdentity,
  type ProviderEvidence,
  redactProviderDiagnostic,
  sha256Bytes,
  sha256Canonical,
} from './provider-evidence.js';

export const CODEX_QUALIFICATION_OUTCOME_REVISION =
  'ccm/codex-qualification-phase-outcome/v1' as const;

export const CODEX_QUALIFICATION_PHASE_REGISTRY = [
  { id: 'version', nonzeroReason: 'version_probe_failed' },
  { id: 'root-help', nonzeroReason: 'root_help_probe_failed' },
  { id: 'exec-help', nonzeroReason: 'exec_help_probe_failed' },
  { id: 'app-server-help', nonzeroReason: 'app_server_help_probe_failed' },
  { id: 'app-server-schema', nonzeroReason: 'app_server_schema_probe_failed' },
  { id: 'exec-parse-only', nonzeroReason: 'exec_parse_only_probe_failed' },
] as const;

export type CodexQualificationPhase = (typeof CODEX_QUALIFICATION_PHASE_REGISTRY)[number]['id'];

type QualificationPredicateId = 'binary-available' | 'behavioral-capability-proven';

export type CodexQualificationFailureOutcome =
  | {
      kind: 'nonzero';
      exitCode: number | null;
      signal: string | null;
      stdout: string;
      stderr: string;
    }
  | {
      kind: 'supervisor-error';
      code: string;
      operation: string;
      stream?: string;
      limitBytes?: number;
      observedBytes?: number;
      termination: { exitCode: number | null; signal: string | null; reaped: boolean } | null;
      reapTimedOut: boolean;
    };

export interface CodexQualificationFailureInput {
  phase: CodexQualificationPhase;
  binary: ProviderBinaryIdentity;
  observedAt: string;
  outcome: CodexQualificationFailureOutcome;
}

export interface CodexQualificationFinalization {
  phase: CodexQualificationPhase;
  outcome: 'nonzero' | 'timeout' | 'supervisor-error';
  evidence: ProviderEvidence;
  passed: Partial<Record<QualificationPredicateId, boolean>>;
  bindings: Partial<Record<QualificationPredicateId, string[]>>;
  failedReasons: Partial<Record<QualificationPredicateId, string>>;
  error: Record<string, unknown>;
}

const PHASE_BY_ID = new Map(
  CODEX_QUALIFICATION_PHASE_REGISTRY.map((definition) => [definition.id, definition]),
);
const PHASE_BY_METHOD = new Map(
  CODEX_QUALIFICATION_PHASE_REGISTRY.map((definition) => [
    `codex-qualification/${definition.id}`,
    definition,
  ]),
);
const DIAGNOSTIC_EXCERPT_BYTES = 1_024;

function phaseDefinition(phase: string): (typeof CODEX_QUALIFICATION_PHASE_REGISTRY)[number] {
  const definition = PHASE_BY_ID.get(phase as CodexQualificationPhase);
  if (!definition) throw new Error(`unregistered Codex qualification phase: ${phase}`);
  return definition;
}

function boundedUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let bytes = 0;
  let result = '';
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function exactDispatcherKeys(dispatcher: Record<string, unknown>): string[] {
  return Object.keys(dispatcher).sort();
}

export function assertCodexQualificationDispatcher(dispatcher: Record<string, unknown>): void {
  const expected = CODEX_QUALIFICATION_PHASE_REGISTRY.map((phase) => phase.id).sort();
  const actual = exactDispatcherKeys(dispatcher);
  if (
    actual.length !== expected.length ||
    actual.some((phase, index) => phase !== expected[index])
  ) {
    throw new Error(
      `Codex qualification dispatcher must exact-match registry: expected=${expected.join(',')} actual=${actual.join(',')}`,
    );
  }
  for (const phase of expected) {
    if (typeof dispatcher[phase] !== 'function')
      throw new Error(`Codex qualification dispatcher phase is not callable: ${phase}`);
  }
}

export function isCodexQualificationEvidenceMethod(method: string): boolean {
  return PHASE_BY_METHOD.has(method);
}

function finalizationOutcome(
  outcome: CodexQualificationFailureOutcome,
): CodexQualificationFinalization['outcome'] {
  if (outcome.kind === 'nonzero') return 'nonzero';
  return outcome.code.endsWith('_timeout') ? 'timeout' : 'supervisor-error';
}

function outcomePayload(
  phase: CodexQualificationPhase,
  outcome: CodexQualificationFailureOutcome,
): Record<string, unknown> {
  if (outcome.kind === 'nonzero') {
    const stdout = redactProviderDiagnostic(outcome.stdout);
    const stderr = redactProviderDiagnostic(outcome.stderr);
    return {
      schema: CODEX_QUALIFICATION_OUTCOME_REVISION,
      phase,
      attempted: true,
      outcome: 'nonzero',
      process: {
        exit_code: outcome.exitCode,
        signal: outcome.signal,
        termination: null,
        reap_timed_out: false,
      },
      diagnostics: {
        stdout: {
          bytes: Buffer.byteLength(stdout, 'utf8'),
          sha256: sha256Bytes(stdout),
          excerpt: boundedUtf8(stdout, DIAGNOSTIC_EXCERPT_BYTES),
        },
        stderr: {
          bytes: Buffer.byteLength(stderr, 'utf8'),
          sha256: sha256Bytes(stderr),
          excerpt: boundedUtf8(stderr, DIAGNOSTIC_EXCERPT_BYTES),
        },
      },
    };
  }
  return {
    schema: CODEX_QUALIFICATION_OUTCOME_REVISION,
    phase,
    attempted: true,
    outcome: finalizationOutcome(outcome),
    process: {
      exit_code: outcome.termination?.exitCode ?? null,
      signal: outcome.termination?.signal ?? null,
      termination:
        outcome.termination === null
          ? null
          : {
              exit_code: outcome.termination.exitCode,
              signal: outcome.termination.signal,
              reaped: outcome.termination.reaped,
            },
      reap_timed_out: outcome.reapTimedOut,
    },
    supervisor: {
      code: outcome.code,
      operation: outcome.operation,
      stream: outcome.stream ?? null,
      limit_bytes: outcome.limitBytes ?? null,
      observed_bytes: outcome.observedBytes ?? null,
    },
    diagnostics: { stdout: null, stderr: null },
  };
}

function outcomeError(
  phase: CodexQualificationPhase,
  outcome: CodexQualificationFailureOutcome,
): string {
  const label = finalizationOutcome(outcome);
  if (outcome.kind === 'nonzero') {
    return `phase=${phase} outcome=${label} exit_code=${String(outcome.exitCode)} signal=${String(outcome.signal)} stderr=${boundedUtf8(redactProviderDiagnostic(outcome.stderr), DIAGNOSTIC_EXCERPT_BYTES)}`;
  }
  return `phase=${phase} outcome=${label} code=${outcome.code} termination_exit_code=${String(outcome.termination?.exitCode ?? null)} termination_signal=${String(outcome.termination?.signal ?? null)} termination_reaped=${String(outcome.termination?.reaped ?? false)} reap_timed_out=${String(outcome.reapTimedOut)}`;
}

export function finalizeCodexQualificationFailure(
  input: CodexQualificationFailureInput,
): CodexQualificationFinalization {
  const definition = phaseDefinition(input.phase);
  if (input.outcome.kind === 'nonzero') {
    if (input.outcome.exitCode === 0 && input.outcome.signal === null)
      throw new Error(`qualification phase ${input.phase} cannot finalize a successful outcome`);
  } else if (input.outcome.operation !== input.phase) {
    throw new Error(
      `qualification supervisor operation mismatch: expected=${input.phase} actual=${input.outcome.operation}`,
    );
  }
  const outcome = finalizationOutcome(input.outcome);
  const payload = outcomePayload(input.phase, input.outcome);
  const evidence = createProviderEvidence(input.binary, {
    kind: 'binary-capability',
    surface: 'cli-headless',
    method: `codex-qualification/${input.phase}`,
    revision: CODEX_QUALIFICATION_OUTCOME_REVISION,
    schemaVersion: CODEX_QUALIFICATION_OUTCOME_REVISION,
    payload,
    observedAt: input.observedAt,
    validUntil: null,
    freshness: 'unknown',
    completeness: 'complete',
    errors: [outcomeError(input.phase, input.outcome)],
  });
  const finalization: CodexQualificationFinalization = {
    phase: input.phase,
    outcome,
    evidence,
    passed: {
      'binary-available': true,
      'behavioral-capability-proven': false,
    },
    bindings: {
      'binary-available': [evidence.evidence_id],
      'behavioral-capability-proven': [evidence.evidence_id],
    },
    failedReasons: {
      'behavioral-capability-proven': 'binary_capability_unproven',
    },
    error:
      input.outcome.kind === 'nonzero'
        ? {
            code: 'binary_capability_unproven',
            reason: definition.nonzeroReason,
            detail: input.phase,
          }
        : { code: input.outcome.code, phase: input.phase },
  };
  assertCodexQualificationFinalization(finalization);
  return finalization;
}

export function assertCodexQualificationFinalization(
  finalization: CodexQualificationFinalization,
): void {
  phaseDefinition(finalization.phase);
  const evidence = finalization.evidence;
  const method = `codex-qualification/${finalization.phase}`;
  if (
    evidence.kind !== 'binary-capability' ||
    evidence.source.method !== method ||
    !isCodexQualificationEvidenceMethod(evidence.source.method) ||
    evidence.source.revision !== CODEX_QUALIFICATION_OUTCOME_REVISION ||
    evidence.source.schema_version !== CODEX_QUALIFICATION_OUTCOME_REVISION ||
    evidence.freshness !== 'unknown' ||
    evidence.completeness !== 'complete'
  )
    throw new Error(`invalid qualification evidence envelope for ${finalization.phase}`);
  const expectedEvidenceId = `ev-${sha256Canonical({
    schema: 'ccm/provider-evidence-reference/v1',
    source_method: evidence.source.method,
    source_revision: evidence.source.revision,
    payload_sha256: evidence.payload_sha256,
  })}`;
  if (evidence.evidence_id !== expectedEvidenceId)
    throw new Error(`qualification evidence id is not value-bound for ${finalization.phase}`);
  if (
    finalization.passed['binary-available'] !== true ||
    finalization.passed['behavioral-capability-proven'] !== false ||
    Object.keys(finalization.passed).length !== 2
  )
    throw new Error(`qualification predicates are not facet-correct for ${finalization.phase}`);
  for (const predicate of ['binary-available', 'behavioral-capability-proven'] as const) {
    const ids = finalization.bindings[predicate];
    if (ids?.length !== 1 || ids[0] !== evidence.evidence_id)
      throw new Error(`qualification predicate binding is invalid: ${predicate}`);
  }
  if (
    finalization.failedReasons['behavioral-capability-proven'] !== 'binary_capability_unproven' ||
    Object.keys(finalization.failedReasons).length !== 1
  )
    throw new Error(`qualification predicate reason is invalid for ${finalization.phase}`);
}
