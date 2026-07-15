export type RunStorePhaseV2 =
  | 'claim-transaction'
  | 'supervisor-runtime'
  | 'manager-control'
  | 'inventory-audit';

export type RunStoreGrantV2 =
  | {
      phase: 'claim-transaction';
      run_id: string;
      attempt_id: string;
      idempotency_digest: `sha256:${string}`;
    }
  | {
      phase: 'supervisor-runtime';
      run_id: string;
      attempt_id: string;
      supervisor_instance_id: string;
    }
  | { phase: 'manager-control'; run_id: string; manager_id: string }
  | { phase: 'inventory-audit' };

export type RunStoreOperationV2 =
  | {
      schema: 'ccm/run-store-operation/v2';
      operation_id: string;
      phase: RunStorePhaseV2;
      kind: 'read-file';
      segments: string[];
      max_bytes: number;
    }
  | {
      schema: 'ccm/run-store-operation/v2';
      operation_id: string;
      phase: RunStorePhaseV2;
      kind: 'list-directory';
      segments: string[];
      max_entries: number;
      max_name_bytes: number;
    }
  | {
      schema: 'ccm/run-store-operation/v2';
      operation_id: string;
      phase: RunStorePhaseV2;
      kind: 'create-file-no-replace';
      segments: string[];
      bytes_base64: string;
      directory_mode: '0700';
      file_mode: '0600';
      durability: 'file-and-directory-synced-v1';
    }
  | {
      schema: 'ccm/run-store-operation/v2';
      operation_id: string;
      phase: RunStorePhaseV2;
      kind: 'replace-file-cas';
      segments: string[];
      expected_revision: 'absent' | `sha256:${string}`;
      bytes_base64: string;
      directory_mode: '0700';
      file_mode: '0600';
      durability: 'file-and-directory-synced-v1';
    }
  | {
      schema: 'ccm/run-store-operation/v2';
      operation_id: string;
      phase: RunStorePhaseV2;
      kind: 'append-ccmj-frame-cas';
      segments: string[];
      expected_revision: 'absent' | `sha256:${string}`;
      expected_byte_length: number;
      frame_base64: string;
      max_file_bytes: number;
      directory_mode: '0700';
      file_mode: '0600';
      durability: 'file-and-directory-synced-v1';
    };

export type RunStoreCapabilityV2 = {
  schema: 'ccm/run-store-capability/v2';
  authority_id: `sha256:${string}`;
  assurance: 'kernel-cwd-object-v1';
  phase: RunStorePhaseV2;
  execute(operation: RunStoreOperationV2): unknown | Promise<unknown>;
};

export const QUALIFIED_PLATFORMS_V2: readonly ['darwin', 'linux'];
export function oracleErrorV2(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Error & { code: string; effect?: 'none' | 'unknown' };
export function bindRunStoreErrorV2(
  error: unknown,
  authorityId: string | null,
  operation: { operation_id?: unknown } | null,
  defaults?: {
    effect?: 'none' | 'unknown';
    retry?: 'safe-same-operation' | 'reconcile-first' | 'never';
    code?: string;
    overrideClassification?: boolean;
  },
): Error & {
  code: string;
  authority_id: string | null;
  operation_id: string | null;
  effect: 'none' | 'unknown';
  retry: 'safe-same-operation' | 'reconcile-first' | 'never';
};
export function canonicalJsonV2(value: unknown): string;
export function sha256V2(value: string | NodeJS.ArrayBufferView): `sha256:${string}`;
export function bytesBase64(value: string | NodeJS.ArrayBufferView): string;
export function identityFromStatV2(
  stat: import('node:fs').Stats,
  platform?: NodeJS.Platform,
): Record<string, string>;
export function validateGrantV2(grant: unknown): RunStoreGrantV2;
export function createAuthorityEnvelopeV2(input: {
  lexicalHome: string;
  storageLocator: string;
  identity: Record<string, string>;
  grant: RunStoreGrantV2;
  issuedAt?: string;
}): Record<string, unknown> & { authority_id: `sha256:${string}`; root_identity: unknown };
export function authorityEnvironmentV2(authority: unknown): Record<string, string>;
export function decodeAndValidateAuthorityV2(input: {
  env: Record<string, string | undefined>;
  cwdStat: import('node:fs').Stats;
}): Record<string, unknown> & { authority_id: `sha256:${string}`; grant: RunStoreGrantV2 };
export function validateOperationV2(operation: unknown, grant: unknown): RunStoreOperationV2;
export function operationDigestV2(operation: unknown): `sha256:${string}`;
export function validateCapabilityV2(
  capability: unknown,
  authorityId: string,
  phase: RunStorePhaseV2,
): RunStoreCapabilityV2;
export function validateExecutionV2(
  execution: unknown,
  authorityId: string,
  operation: unknown,
): Record<string, unknown>;
export function validateTraceV2(
  trace: unknown,
  expected: {
    authorityId: string;
    consumerInvocations: number;
    capabilityInvocations: number;
    operationDigests: string[];
  },
): Record<string, unknown>;
export function createCcmjFrame(payload: string | NodeJS.ArrayBufferView): Buffer;
