import {
  CANONICAL_LAUNCH_IDENTITY_FIELD_REGISTRY,
  type CanonicalLaunchIdentity,
  canonicalJson,
  canonicalLaunchIdentityDigest,
  isSha256Digest,
  normalizeCanonicalLaunchIdentity,
  sha256Digest,
} from '@ccm/engine';

type Data = Record<string, unknown>;

// Provider consumption contract: parse the candidate ticket, digest that parsed value, and require
// the digest to equal the owner preflight receipt's ticket_digest before using any launch field.
// The provider then binds the shared canonical identity plus its provider-local extension to the
// actual invocation. Only the quota owner calls the binding validator with its authoritative
// reservation; a provider must never treat an unbound caller copy as authority.

export const QUOTA_ADMISSION_TICKET_SCHEMA = 'ccm/quota-admission-ticket/v1' as const;

export const QUOTA_ADMISSION_TICKET_FIELDS = Object.freeze([
  'schema',
  'ticket_id',
  'reservation_id',
  'reservation_request_hash',
  'reservation_expires_at',
  'attempt_id',
  'run_ref',
  'account_id',
  'pool_id',
  'identity_fingerprint',
  'aggregation_key',
  'live_source_revision',
  'runtime_sha256',
  'launch_idempotency_key',
  'launch_nonce',
  'issued_at',
  'committed_at',
  'launch_by',
  'canonical_identity',
  'canonical_identity_digest',
  'provider_extension',
] as const);

export const QUOTA_ADMISSION_TICKET_REQUEST_FIELDS = Object.freeze(
  QUOTA_ADMISSION_TICKET_FIELDS.filter((field) => field !== 'committed_at'),
);

export const QUOTA_ADMISSION_TICKET_PREDICATE_IDS = Object.freeze([
  'closed-fields',
  'schema',
  'canonical-identifiers',
  'sha256-digests',
  'live-source-revision',
  'parseable-instants',
  'committed-not-before-issued',
  'launch-after-issued',
  'launch-not-before-committed',
  'launch-not-after-reservation-expiry',
  'canonical-identity',
  'canonical-identity-top-level-binding',
  'provider-extension',
] as const);

export const QUOTA_ADMISSION_TICKET_RESERVATION_BINDING_IDS = Object.freeze([
  'reservation-id',
  'reservation-request-hash',
  'reservation-expiry',
  'attempt-id',
  'account-id',
  'pool-id',
  'identity-fingerprint',
  'aggregation-key',
  'live-source-revision',
] as const);

export const QUOTA_ADMISSION_TICKET_PROVIDER_LAUNCH_BINDING_IDS = Object.freeze([
  'ticket-digest',
  'reservation-id',
  'reservation-request-hash',
  'reservation-expiry',
  'attempt-id',
  'run-ref',
  'account-id',
  'pool-id',
  'identity-fingerprint',
  'aggregation-key',
  'live-source-revision',
  'runtime-sha256',
  'launch-idempotency-key',
  'launch-nonce',
  'checked-at-window',
  'canonical-identity',
  'provider-extension',
] as const);

export const QUOTA_ADMISSION_TICKET_REGISTRY = Object.freeze({
  fields: QUOTA_ADMISSION_TICKET_FIELDS,
  request_fields: QUOTA_ADMISSION_TICKET_REQUEST_FIELDS,
  predicate_ids: QUOTA_ADMISSION_TICKET_PREDICATE_IDS,
  reservation_binding_ids: QUOTA_ADMISSION_TICKET_RESERVATION_BINDING_IDS,
  provider_launch_binding_ids: QUOTA_ADMISSION_TICKET_PROVIDER_LAUNCH_BINDING_IDS,
  canonical_identity: CANONICAL_LAUNCH_IDENTITY_FIELD_REGISTRY,
});

export interface QuotaAdmissionTicket {
  schema: typeof QUOTA_ADMISSION_TICKET_SCHEMA;
  ticket_id: string;
  reservation_id: string;
  reservation_request_hash: string;
  reservation_expires_at: string;
  attempt_id: string;
  run_ref: string;
  account_id: string;
  pool_id: string;
  identity_fingerprint: string;
  aggregation_key: string;
  live_source_revision: string;
  runtime_sha256: string;
  launch_idempotency_key: string;
  launch_nonce: string;
  issued_at: string;
  committed_at: string;
  launch_by: string;
  canonical_identity: Readonly<CanonicalLaunchIdentity>;
  canonical_identity_digest: string;
  provider_extension: Readonly<Record<string, unknown>>;
}

export interface QuotaAdmissionTicketBindingContext {
  aggregation_key: string;
  reservation: Readonly<Record<string, unknown>>;
}

export interface QuotaAdmissionTicketProviderLaunchBindingContext {
  ticket_digest: string;
  reservation_id: string;
  reservation_request_hash: string;
  reservation_expires_at: string;
  attempt_id: string;
  run_ref: string;
  account_id: string;
  pool_id: string;
  identity_fingerprint: string;
  aggregation_key: string;
  live_source_revision: string;
  runtime_sha256: string;
  launch_idempotency_key: string;
  launch_nonce: string;
  checked_at: string;
  canonical_identity: Readonly<CanonicalLaunchIdentity>;
  provider_extension: unknown;
}

const FIELD_SET = new Set<string>(QUOTA_ADMISSION_TICKET_FIELDS);
const INSTANT_FIELDS = [
  'reservation_expires_at',
  'issued_at',
  'committed_at',
  'launch_by',
] as const;
const IDENTIFIER_FIELDS = QUOTA_ADMISSION_TICKET_FIELDS.filter(
  (field) =>
    field !== 'schema' &&
    field !== 'canonical_identity' &&
    field !== 'provider_extension' &&
    !INSTANT_FIELDS.includes(field as (typeof INSTANT_FIELDS)[number]),
);
const PROVIDER_LAUNCH_CONTEXT_FIELDS = Object.freeze([
  'ticket_digest',
  'reservation_id',
  'reservation_request_hash',
  'reservation_expires_at',
  'attempt_id',
  'run_ref',
  'account_id',
  'pool_id',
  'identity_fingerprint',
  'aggregation_key',
  'live_source_revision',
  'runtime_sha256',
  'launch_idempotency_key',
  'launch_nonce',
  'checked_at',
  'canonical_identity',
  'provider_extension',
] as const);

export function parseQuotaAdmissionTicket(value: unknown): Readonly<QuotaAdmissionTicket> | null {
  const ticket = object(value);
  let canonicalIdentity: Readonly<CanonicalLaunchIdentity>;
  try {
    canonicalIdentity = normalizeCanonicalLaunchIdentity(ticket.canonical_identity);
  } catch {
    return null;
  }
  const providerExtension = jsonObject(ticket.provider_extension);
  const keys = Object.keys(ticket);
  if (
    keys.length !== FIELD_SET.size ||
    keys.some((field) => !FIELD_SET.has(field)) ||
    ticket.schema !== QUOTA_ADMISSION_TICKET_SCHEMA ||
    !IDENTIFIER_FIELDS.every((field) => canonicalIdentifier(ticket[field])) ||
    !isSha256Digest(ticket.identity_fingerprint) ||
    !isSha256Digest(ticket.runtime_sha256) ||
    !isSha256Digest(ticket.canonical_identity_digest) ||
    !canonicalRevision(ticket.live_source_revision) ||
    !INSTANT_FIELDS.every((field) => parseableInstant(ticket[field])) ||
    !providerExtension ||
    !canonicalIdentifier(providerExtension.schema)
  ) {
    return null;
  }

  const issuedAt = Date.parse(String(ticket.issued_at));
  const committedAt = Date.parse(String(ticket.committed_at));
  const launchBy = Date.parse(String(ticket.launch_by));
  const reservationExpiresAt = Date.parse(String(ticket.reservation_expires_at));
  if (
    committedAt < issuedAt ||
    launchBy <= issuedAt ||
    launchBy < committedAt ||
    launchBy > reservationExpiresAt
  ) {
    return null;
  }
  if (
    canonicalIdentity.account.account_id !== ticket.account_id ||
    canonicalIdentity.account.pool_id !== ticket.pool_id ||
    canonicalIdentity.account.identity_fingerprint !== ticket.identity_fingerprint ||
    canonicalIdentity.runtime.image_sha256 !== ticket.runtime_sha256 ||
    canonicalLaunchIdentityDigest(canonicalIdentity) !== ticket.canonical_identity_digest
  ) {
    return null;
  }
  return Object.freeze({
    ...(ticket as unknown as QuotaAdmissionTicket),
    canonical_identity: canonicalIdentity,
    provider_extension: providerExtension,
  });
}

export function validateQuotaAdmissionTicketBinding(
  ticket: Readonly<QuotaAdmissionTicket>,
  context: Readonly<QuotaAdmissionTicketBindingContext>,
): boolean {
  const reservation = context.reservation;
  return (
    ticket.reservation_id === reservation.id &&
    ticket.reservation_request_hash === reservation.hash &&
    ticket.reservation_expires_at === reservation.expires_at &&
    ticket.attempt_id === reservation.attempt_id &&
    ticket.account_id === reservation.account_id &&
    ticket.pool_id === reservation.pool_id &&
    ticket.identity_fingerprint === reservation.identity_fingerprint &&
    ticket.aggregation_key === context.aggregation_key &&
    ticket.live_source_revision === reservation.source_revision
  );
}

export function validateQuotaAdmissionTicket(
  value: unknown,
  context: Readonly<QuotaAdmissionTicketBindingContext>,
): Readonly<QuotaAdmissionTicket> | null {
  const ticket = parseQuotaAdmissionTicket(value);
  return ticket && validateQuotaAdmissionTicketBinding(ticket, context) ? ticket : null;
}

export function validateQuotaAdmissionTicketProviderLaunchBinding(
  ticket: Readonly<QuotaAdmissionTicket>,
  context: Readonly<QuotaAdmissionTicketProviderLaunchBindingContext>,
): boolean {
  if (!exactKeys(context as unknown as Data, PROVIDER_LAUNCH_CONTEXT_FIELDS)) return false;
  const checkedAt = canonicalInstant(context.checked_at);
  const committedAt = canonicalInstant(ticket.committed_at);
  const launchBy = canonicalInstant(ticket.launch_by);
  const reservationExpiresAt = canonicalInstant(ticket.reservation_expires_at);
  return (
    checkedAt !== null &&
    committedAt !== null &&
    launchBy !== null &&
    reservationExpiresAt !== null &&
    checkedAt >= committedAt &&
    checkedAt < launchBy &&
    checkedAt < reservationExpiresAt &&
    digestQuotaAdmissionTicket(ticket) === context.ticket_digest &&
    ticket.reservation_id === context.reservation_id &&
    ticket.reservation_request_hash === context.reservation_request_hash &&
    ticket.reservation_expires_at === context.reservation_expires_at &&
    ticket.attempt_id === context.attempt_id &&
    ticket.run_ref === context.run_ref &&
    ticket.account_id === context.account_id &&
    ticket.pool_id === context.pool_id &&
    ticket.identity_fingerprint === context.identity_fingerprint &&
    ticket.aggregation_key === context.aggregation_key &&
    ticket.live_source_revision === context.live_source_revision &&
    ticket.runtime_sha256 === context.runtime_sha256 &&
    ticket.launch_idempotency_key === context.launch_idempotency_key &&
    ticket.launch_nonce === context.launch_nonce &&
    canonicalJson(ticket.canonical_identity) === canonicalJson(context.canonical_identity) &&
    canonicalJson(ticket.provider_extension) === canonicalJson(context.provider_extension)
  );
}

export function canonicalQuotaAdmissionTicketJson(ticket: Readonly<QuotaAdmissionTicket>): string {
  const parsed = parseQuotaAdmissionTicket(ticket);
  if (!parsed) throw new TypeError('quota admission ticket is invalid');
  return canonicalJson(parsed);
}

export function digestQuotaAdmissionTicket(ticket: Readonly<QuotaAdmissionTicket>): string {
  const parsed = parseQuotaAdmissionTicket(ticket);
  if (!parsed) throw new TypeError('quota admission ticket is invalid');
  return sha256Digest(canonicalJson(parsed));
}

function object(value: unknown): Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Data)
    : {};
}

function canonicalIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() === value;
}

function canonicalRevision(value: unknown): value is string {
  return canonicalIdentifier(value) && value.startsWith('sha256:');
}

function parseableInstant(value: unknown): value is string {
  return canonicalInstant(value) !== null;
}

function canonicalInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!jsonValue(value) || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return deepFreeze(structuredClone(value) as Record<string, unknown>);
}

function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  if (typeof value !== 'object') return false;
  return Object.entries(value).every(
    ([key, child]) => canonicalIdentifier(key) && jsonValue(child),
  );
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function exactKeys(value: Data, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  const expected = new Set(fields);
  return keys.length === fields.length && keys.every((field) => expected.has(field));
}
