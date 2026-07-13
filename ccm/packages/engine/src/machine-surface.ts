// machine-surface.ts — provider-neutral C1 machine-surface eligibility contract.
//
// This module only evaluates already-observed facts. It never probes binaries, auth, quota, files,
// processes, or credentials; those are composition-root responsibilities.

export const MACHINE_SURFACE_CONTRACT = 'ccm/machine-surface/v1' as const;
export const MACHINE_SURFACE_INVENTORY_CONTRACT = 'ccm/machine-surface-inventory/v1' as const;

export type MachineSurfaceKind = 'origin-plugin' | 'cli-headless';
export type BinaryFactState = 'available' | 'missing' | 'unsupported' | 'unknown';
export type CompatibilityState = 'supported' | 'unsupported' | 'unknown';
export type AuthFactState = 'authenticated' | 'unauthenticated' | 'unknown';
export type ModelEntitlementState = 'entitled' | 'not-entitled' | 'unknown';
export type QuotaFactState = 'ample' | 'tight' | 'exhausted' | 'unknown';
export type CapabilityFactState = 'supported' | 'unsupported' | 'unknown';
export type NegativeCapabilityState = 'forbidden' | 'unsupported' | 'unknown' | 'supported';

export interface MachineSurfaceEligibilityInput {
  schema: typeof MACHINE_SURFACE_CONTRACT;
  surface_kind: MachineSurfaceKind;
  installed: boolean;
  binary_state: BinaryFactState;
  compatibility: CompatibilityState;
  auth_state: AuthFactState;
  model_entitlement: ModelEntitlementState;
  quota_state: QuotaFactState;
  headless_execution: CapabilityFactState;
  account_mutation: NegativeCapabilityState;
  credential_mutation: NegativeCapabilityState;
}

export type MachineSurfaceEligibilityReason =
  | 'contract-invalid'
  | 'surface-not-headless'
  | 'surface-not-installed'
  | 'binary-missing'
  | 'binary-unsupported'
  | 'binary-unknown'
  | 'compatibility-unsupported'
  | 'compatibility-unknown'
  | 'auth-missing'
  | 'auth-unknown'
  | 'model-not-entitled'
  | 'model-entitlement-unknown'
  | 'quota-tight'
  | 'quota-exhausted'
  | 'quota-unknown'
  | 'headless-execution-unsupported'
  | 'headless-execution-unknown'
  | 'account-mutation-not-forbidden'
  | 'credential-mutation-not-forbidden';

export interface MachineSurfaceEligibility {
  automatic: boolean;
  reason_codes: MachineSurfaceEligibilityReason[];
}

export function evaluateMachineSurfaceEligibility(input: unknown): MachineSurfaceEligibility {
  const { facts, invalid } = normalizeEligibilityInput(input);
  if (facts.surface_kind !== 'cli-headless') {
    return {
      automatic: false,
      reason_codes: invalid
        ? ['contract-invalid', 'surface-not-headless']
        : ['surface-not-headless'],
    };
  }

  const reasons: MachineSurfaceEligibilityReason[] = [];
  if (invalid) reasons.push('contract-invalid');
  if (!facts.installed) reasons.push('surface-not-installed');

  if (facts.binary_state === 'missing') reasons.push('binary-missing');
  else if (facts.binary_state === 'unsupported') reasons.push('binary-unsupported');
  else if (facts.binary_state === 'unknown') reasons.push('binary-unknown');

  if (facts.compatibility === 'unsupported') reasons.push('compatibility-unsupported');
  else if (facts.compatibility === 'unknown') reasons.push('compatibility-unknown');

  if (facts.auth_state === 'unauthenticated') reasons.push('auth-missing');
  else if (facts.auth_state === 'unknown') reasons.push('auth-unknown');

  if (facts.model_entitlement === 'not-entitled') reasons.push('model-not-entitled');
  else if (facts.model_entitlement === 'unknown') reasons.push('model-entitlement-unknown');

  if (facts.quota_state === 'tight') reasons.push('quota-tight');
  else if (facts.quota_state === 'exhausted') reasons.push('quota-exhausted');
  else if (facts.quota_state === 'unknown') reasons.push('quota-unknown');

  if (facts.headless_execution === 'unsupported') {
    reasons.push('headless-execution-unsupported');
  } else if (facts.headless_execution === 'unknown') {
    reasons.push('headless-execution-unknown');
  }

  if (facts.account_mutation !== 'forbidden') {
    reasons.push('account-mutation-not-forbidden');
  }
  if (facts.credential_mutation !== 'forbidden') {
    reasons.push('credential-mutation-not-forbidden');
  }

  return { automatic: reasons.length === 0, reason_codes: reasons };
}

function normalizeEligibilityInput(input: unknown): {
  facts: MachineSurfaceEligibilityInput;
  invalid: boolean;
} {
  const value = isRecord(input) ? input : {};
  let invalid = value.schema !== MACHINE_SURFACE_CONTRACT;

  const surfaceKind = enumFact(
    value.surface_kind,
    ['origin-plugin', 'cli-headless'],
    'origin-plugin',
  );
  const installed = typeof value.installed === 'boolean' ? value.installed : false;
  const binaryState = enumFact(
    value.binary_state,
    ['available', 'missing', 'unsupported', 'unknown'],
    'unknown',
  );
  const compatibility = enumFact(
    value.compatibility,
    ['supported', 'unsupported', 'unknown'],
    'unknown',
  );
  const authState = enumFact(
    value.auth_state,
    ['authenticated', 'unauthenticated', 'unknown'],
    'unknown',
  );
  const modelEntitlement = enumFact(
    value.model_entitlement,
    ['entitled', 'not-entitled', 'unknown'],
    'unknown',
  );
  const quotaState = enumFact(
    value.quota_state,
    ['ample', 'tight', 'exhausted', 'unknown'],
    'unknown',
  );
  const headlessExecution = enumFact(
    value.headless_execution,
    ['supported', 'unsupported', 'unknown'],
    'unknown',
  );
  const accountMutation = enumFact(
    value.account_mutation,
    ['forbidden', 'unsupported', 'unknown', 'supported'],
    'unknown',
  );
  const credentialMutation = enumFact(
    value.credential_mutation,
    ['forbidden', 'unsupported', 'unknown', 'supported'],
    'unknown',
  );

  invalid ||=
    surfaceKind.invalid ||
    typeof value.installed !== 'boolean' ||
    binaryState.invalid ||
    compatibility.invalid ||
    authState.invalid ||
    modelEntitlement.invalid ||
    quotaState.invalid ||
    headlessExecution.invalid ||
    accountMutation.invalid ||
    credentialMutation.invalid;

  return {
    invalid,
    facts: {
      schema: MACHINE_SURFACE_CONTRACT,
      surface_kind: surfaceKind.value,
      installed,
      binary_state: binaryState.value,
      compatibility: compatibility.value,
      auth_state: authState.value,
      model_entitlement: modelEntitlement.value,
      quota_state: quotaState.value,
      headless_execution: headlessExecution.value,
      account_mutation: accountMutation.value,
      credential_mutation: credentialMutation.value,
    },
  };
}

function enumFact<const T extends readonly string[], F extends T[number]>(
  value: unknown,
  allowed: T,
  fallback: F,
): { value: T[number]; invalid: boolean } {
  return typeof value === 'string' && allowed.includes(value)
    ? { value, invalid: false }
    : { value: fallback, invalid: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
