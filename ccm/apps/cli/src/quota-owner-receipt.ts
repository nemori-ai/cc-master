type Data = Record<string, unknown>;

export const QUOTA_OWNER_PREFLIGHT_RECEIPT_SCHEMA = 'ccm/quota-owner-preflight-receipt/v1' as const;

export interface QuotaOwnerPreflightReceipt {
  schema: typeof QUOTA_OWNER_PREFLIGHT_RECEIPT_SCHEMA;
  reservation_id: string;
  reservation_request_hash: string;
  ticket_digest: string;
  attempt_id: string;
  run_ref: string;
  account_id: string;
  pool_id: string;
  source_revision: string;
  authority_digest: string;
  checked_at: string;
}

export interface QuotaOwnerPreflightReceiptBindingContext {
  reservation_id: string;
  reservation_request_hash: string;
  ticket_digest: string;
  attempt_id: string;
  run_ref: string;
  account_id: string;
  pool_id: string;
  source_revision: string;
  authority_digest: string;
}

export const QUOTA_OWNER_PREFLIGHT_RECEIPT_FIELDS = Object.freeze([
  'schema',
  'reservation_id',
  'reservation_request_hash',
  'ticket_digest',
  'attempt_id',
  'run_ref',
  'account_id',
  'pool_id',
  'source_revision',
  'authority_digest',
  'checked_at',
] as const);

export const QUOTA_OWNER_PREFLIGHT_RECEIPT_PREDICATE_IDS = Object.freeze([
  'closed-fields',
  'schema',
  'canonical-identifiers',
  'source-revision',
  'sha256-digests',
  'parseable-checked-at',
] as const);

export const QUOTA_OWNER_PREFLIGHT_RECEIPT_BINDING_IDS = Object.freeze([
  'reservation-id',
  'reservation-request-hash',
  'ticket-digest',
  'attempt-id',
  'run-ref',
  'account-id',
  'pool-id',
  'source-revision',
  'authority-digest',
] as const);

export const QUOTA_OWNER_PREFLIGHT_RECEIPT_REGISTRY = Object.freeze({
  fields: QUOTA_OWNER_PREFLIGHT_RECEIPT_FIELDS,
  predicate_ids: QUOTA_OWNER_PREFLIGHT_RECEIPT_PREDICATE_IDS,
  binding_ids: QUOTA_OWNER_PREFLIGHT_RECEIPT_BINDING_IDS,
});

const FIELD_SET = new Set<string>(QUOTA_OWNER_PREFLIGHT_RECEIPT_FIELDS);
const BINDING_CONTEXT_FIELDS = Object.freeze([
  'reservation_id',
  'reservation_request_hash',
  'ticket_digest',
  'attempt_id',
  'run_ref',
  'account_id',
  'pool_id',
  'source_revision',
  'authority_digest',
] as const);

export function parseQuotaOwnerPreflightReceipt(
  value: unknown,
): Readonly<QuotaOwnerPreflightReceipt> | null {
  const receipt = object(value);
  const keys = Object.keys(receipt);
  if (
    receipt.schema !== QUOTA_OWNER_PREFLIGHT_RECEIPT_SCHEMA ||
    keys.length !== FIELD_SET.size ||
    keys.some((field) => !FIELD_SET.has(field)) ||
    ![
      receipt.reservation_id,
      receipt.attempt_id,
      receipt.run_ref,
      receipt.account_id,
      receipt.pool_id,
    ].every(canonicalIdentifier) ||
    !canonicalRevision(receipt.source_revision) ||
    ![receipt.reservation_request_hash, receipt.ticket_digest, receipt.authority_digest].every(
      sha256Digest,
    ) ||
    !canonicalInstant(receipt.checked_at)
  ) {
    return null;
  }
  return Object.freeze({ ...(receipt as unknown as QuotaOwnerPreflightReceipt) });
}

export function validateQuotaOwnerPreflightReceiptBinding(
  receipt: Readonly<QuotaOwnerPreflightReceipt>,
  context: Readonly<QuotaOwnerPreflightReceiptBindingContext>,
): boolean {
  if (!exactKeys(context as unknown as Data, BINDING_CONTEXT_FIELDS)) return false;
  return (
    receipt.reservation_id === context.reservation_id &&
    receipt.reservation_request_hash === context.reservation_request_hash &&
    receipt.ticket_digest === context.ticket_digest &&
    receipt.attempt_id === context.attempt_id &&
    receipt.run_ref === context.run_ref &&
    receipt.account_id === context.account_id &&
    receipt.pool_id === context.pool_id &&
    receipt.source_revision === context.source_revision &&
    receipt.authority_digest === context.authority_digest
  );
}

function object(value: unknown): Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Data)
    : {};
}

function canonicalIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() === value;
}

function sha256Digest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function canonicalRevision(value: unknown): value is string {
  return canonicalIdentifier(value) && value.startsWith('sha256:');
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function exactKeys(value: Data, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  const expected = new Set(fields);
  return keys.length === fields.length && keys.every((field) => expected.has(field));
}
