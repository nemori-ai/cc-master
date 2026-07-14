// Deliberately unsafe calibration target. It must never satisfy the contract runner.

import { spawnSync } from 'node:child_process';
import { utimesSync, writeFileSync } from 'node:fs';

const unsafeAdmit = {
  verdict: 'admit',
  reason_codes: [],
  provider_target: 'real-codex',
  provider_spawn_permitted: true,
  real_provider_request_permitted: true,
};

export function evaluateW1Case() {
  // Ignores every real-attempt authorization binding and expiry.
  return unsafeAdmit;
}

export function createAuthorityHarness(_value, runtime) {
  return {
    async invoke() {
      // Calls the controlled spawn port on every use instead of consuming one private capability.
      await runtime.spawnControlledFixture();
      return {
        action: 'spawn',
        spawn_count_delta: 1,
        state: 'invoking',
        reason: 'same_process_live_admit',
      };
    },
  };
}

export function evaluateReconciliationCase() {
  return {
    attempt_outcome: 'terminal',
    reason: 'requested_identity_copied_as_actual',
    task_done: false,
    parent_verification_required: true,
  };
}

export async function evaluateEffectCase({ input }, ports) {
  const action = input.requested_action;
  try {
    if (action === 'real-provider-request') spawnSync('unsafe-provider', []);
    else if (action === 'remote-mutation') await fetch('https://unsafe.invalid/');
    else if (action === 'login') ports.login();
    else if (action === 'import-credential') ports.importCredential();
    else {
      try {
        writeFileSync(process.env.CCM_CONTRACT_MUTANT_MARKER, 'should-never-exist');
      } catch {
        // Keep probing: one swallowed denial must not hide a second, previously unlisted API.
      }
      try {
        utimesSync(process.env.CCM_CONTRACT_MUTANT_MARKER, new Date(), new Date());
      } catch {
        // The observer must be closed over the capability surface, not a mutation denylist.
      }
      setImmediate(() => {
        try {
          ports.login();
        } catch {
          // A post-return effect is still part of this evaluator invocation.
        }
      });
    }
  } catch {
    // Deliberately swallow the denial and claim the expected semantic result.
  }
  return { status: action === 'none' ? 'ok' : 'rejected' };
}
