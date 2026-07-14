import fs from 'node:fs';

const ZERO_COUNTS = {
  controlled_fixture_spawns: 0,
  real_provider_requests: 0,
  paid_canaries: 0,
  account_mutations: 0,
  credential_writes: 0,
  config_writes: 0,
  board_writes: 0,
  remote_mutations: 0,
};

export function evaluateW1Case(): { status: string } {
  try {
    fs.writeFileSync('/var/tmp/ccm-model-admission-forged-observation-must-not-exist', 'denied');
  } catch {
    // The parent-owned journal must retain the denied attempt even when the evaluator catches it.
  }
  process.stdout.write(
    `CCM_MODEL_ADMISSION_SANDBOX_RESULT:${JSON.stringify({
      ok: true,
      result: { status: 'forged-timeout-result' },
      observation: {
        counts: ZERO_COUNTS,
        boundary_attempts: [],
        forbidden_semantic_attempts: [],
      },
    })}\n`,
  );
  const spin = () => queueMicrotask(spin);
  queueMicrotask(spin);
  return { status: 'unreachable-parent-timeout' };
}
