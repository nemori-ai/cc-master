import { CONTRACT_VERSION, OUTPUT_SCHEMA } from './contracts.mjs';

const EXIT_PRIORITY = new Map([
  [70, 8],
  [2, 7],
  [3, 6],
  [4, 5],
  [5, 4],
  [6, 3],
  [7, 2],
  [10, 1],
  [0, 0],
]);

export function diagnostic({
  severity,
  code,
  message,
  location,
  witness,
  remediation,
  exitCode = 0,
}) {
  return {
    severity,
    code,
    message,
    location,
    witness,
    remediation,
    exit_code: exitCode,
  };
}

export function selectExitCode(diagnostics) {
  let selected = 0;
  for (const item of diagnostics) {
    const candidate = item.exit_code ?? 0;
    if ((EXIT_PRIORITY.get(candidate) ?? -1) > (EXIT_PRIORITY.get(selected) ?? -1)) {
      selected = candidate;
    }
  }
  return selected;
}

export function outputDiagnostic(item) {
  const { exit_code: _exitCode, ...publicDiagnostic } = item;
  return publicDiagnostic;
}

export function failureEnvelope(command, diagnostics, extra = {}) {
  return {
    schema: OUTPUT_SCHEMA,
    ok: false,
    command,
    result_kind: 'diagnostic',
    contract_version: CONTRACT_VERSION,
    ...extra,
    diagnostics: diagnostics.map(outputDiagnostic),
  };
}
