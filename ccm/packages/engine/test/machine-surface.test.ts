import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateMachineSurfaceEligibility,
  MACHINE_SURFACE_CONTRACT,
  type MachineSurfaceEligibilityInput,
} from '../src/machine-surface.ts';

function eligibleHeadless(
  overrides: Partial<MachineSurfaceEligibilityInput> = {},
): MachineSurfaceEligibilityInput {
  return {
    schema: MACHINE_SURFACE_CONTRACT,
    surface_kind: 'cli-headless',
    installed: true,
    binary_state: 'available',
    compatibility: 'supported',
    auth_state: 'authenticated',
    model_entitlement: 'entitled',
    quota_state: 'ample',
    headless_execution: 'supported',
    account_mutation: 'forbidden',
    credential_mutation: 'forbidden',
    ...overrides,
  };
}

test('machine surface eligibility admits only an independently proven headless surface', () => {
  assert.deepEqual(evaluateMachineSurfaceEligibility(eligibleHeadless()), {
    automatic: true,
    reason_codes: [],
  });

  assert.deepEqual(
    evaluateMachineSurfaceEligibility(eligibleHeadless({ surface_kind: 'origin-plugin' })),
    {
      automatic: false,
      reason_codes: ['surface-not-headless'],
    },
  );
});

test('authenticated with unknown quota is fail-closed and never automatic eligible', () => {
  assert.deepEqual(
    evaluateMachineSurfaceEligibility(
      eligibleHeadless({ auth_state: 'authenticated', quota_state: 'unknown' }),
    ),
    {
      automatic: false,
      reason_codes: ['quota-unknown'],
    },
  );
});

test('authenticated with quota but unknown model entitlement is fail-closed', () => {
  assert.deepEqual(
    evaluateMachineSurfaceEligibility(
      eligibleHeadless({ auth_state: 'authenticated', model_entitlement: 'unknown' }),
    ),
    {
      automatic: false,
      reason_codes: ['model-entitlement-unknown'],
    },
  );
});

test('runtime-invalid or missing headless facts never become automatically eligible', () => {
  const result = evaluateMachineSurfaceEligibility({
    schema: MACHINE_SURFACE_CONTRACT,
    surface_kind: 'cli-headless',
    installed: true,
    binary_state: 'available',
    compatibility: 'supported',
    auth_state: 'authenticated',
    quota_state: 'ample',
    account_mutation: 'forbidden',
    credential_mutation: 'forbidden',
  });

  assert.equal(result.automatic, false);
  assert.ok(result.reason_codes.includes('contract-invalid'));
  assert.ok(result.reason_codes.includes('model-entitlement-unknown'));
  assert.ok(result.reason_codes.includes('headless-execution-unknown'));
});

test('wrong schema and invalid enum values normalize to unknown and fail closed', () => {
  const result = evaluateMachineSurfaceEligibility({
    ...eligibleHeadless(),
    schema: 'ccm/machine-surface/v999',
    binary_state: 'sure-why-not',
    quota_state: 100,
  });

  assert.equal(result.automatic, false);
  assert.deepEqual(result.reason_codes, ['contract-invalid', 'binary-unknown', 'quota-unknown']);
});

test('unknown facts and forbidden-mutation violations remain distinct rejection reasons', () => {
  const result = evaluateMachineSurfaceEligibility(
    eligibleHeadless({
      binary_state: 'unknown',
      compatibility: 'unknown',
      auth_state: 'unknown',
      model_entitlement: 'not-entitled',
      quota_state: 'tight',
      headless_execution: 'unknown',
      account_mutation: 'supported',
      credential_mutation: 'unknown',
    }),
  );

  assert.equal(result.automatic, false);
  assert.deepEqual(result.reason_codes, [
    'binary-unknown',
    'compatibility-unknown',
    'auth-unknown',
    'model-not-entitled',
    'quota-tight',
    'headless-execution-unknown',
    'account-mutation-not-forbidden',
    'credential-mutation-not-forbidden',
  ]);
});
