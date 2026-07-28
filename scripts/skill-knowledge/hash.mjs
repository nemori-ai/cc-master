import crypto from 'node:crypto';
import { HARDENING_CONTRACT } from './contracts.mjs';

export const GRAPH_HASH_ALGORITHM = HARDENING_CONTRACT.C6.algorithm;
export const SPAN_HASH_ALGORITHM = HARDENING_CONTRACT.C7.algorithm;
export const BUDGET_ALGORITHM = HARDENING_CONTRACT.C8.algorithm;
export const CHANGE_HEAD_DIGEST_EXCLUDES = HARDENING_CONTRACT.C6.change_head_digest_excludes;
export const IDENTITY_SET_FIELDS = new Set(HARDENING_CONTRACT.C6.identity_set_fields);
export const SEMANTIC_ORDER_FIELDS = new Set(HARDENING_CONTRACT.C6.semantic_order_fields);

/** CRLF → LF; lone CR is preserved (C7 / C8). */
export function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n');
}

export function sha256Hex(textOrBuffer) {
  const buffer =
    typeof textOrBuffer === 'string' ? Buffer.from(textOrBuffer, 'utf8') : textOrBuffer;
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function hashMarkdownSpan(content) {
  return sha256Hex(normalizeNewlines(content));
}

/**
 * Deterministic budget estimator v1 (C8).
 * lines: empty → 0; else LF count + 1 if final byte is not LF.
 */
export function estimateBudget(text) {
  const normalized = normalizeNewlines(text);
  const utf8_bytes = Buffer.byteLength(normalized, 'utf8');
  if (utf8_bytes === 0) {
    return { utf8_bytes: 0, lines: 0, estimated_tokens: 0 };
  }
  let newlines = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === '\n') newlines += 1;
  }
  const lines = newlines + (normalized.endsWith('\n') ? 0 : 1);
  return {
    utf8_bytes,
    lines,
    estimated_tokens: Math.ceil(utf8_bytes / 3),
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Locale-independent ascending comparator (C6 §10.2 Unicode code-point order).
 * Iterates Unicode scalar values (not UTF-16 code units / localeCompare), so
 * U+E000 sorts before U+10000. Lone surrogates compare by their numeric
 * codePointAt scalar and advance one unit. Shared prefix: shorter string first.
 */
export function compareCodePoint(left, right) {
  const a = String(left);
  const b = String(right);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const cpA = a.codePointAt(i);
    const cpB = b.codePointAt(j);
    if (cpA !== cpB) return cpA < cpB ? -1 : 1;
    i += cpA > 0xffff ? 2 : 1;
    j += cpB > 0xffff ? 2 : 1;
  }
  if (i === a.length && j === b.length) return 0;
  return i === a.length ? -1 : 1;
}

function identityKey(item, field) {
  if (typeof item === 'string') return item;
  if (isPlainObject(item)) {
    if (typeof item.id === 'string') return item.id;
    // Inventory entries (top-level `inventory` or `canonical_source_inventory`) key by path.
    if (
      (field === 'canonical_source_inventory' || field === 'inventory') &&
      typeof item.path === 'string'
    ) {
      return item.path;
    }
  }
  return JSON.stringify(item);
}

/**
 * Stable JSON serialization for canonical graph hash (C6 §10.2).
 * - object keys: Unicode code point ascending
 * - contract-declared identity-set arrays: sort by stable id (or inventory path)
 * - semantic-order arrays: preserve authored order
 * - never sort semantic sequence arrays; only declared identity sets are reordered
 */
export function stableSerialize(value, path = []) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    const leaf = path[path.length - 1];
    const items = [...value];
    if (typeof leaf === 'string' && IDENTITY_SET_FIELDS.has(leaf)) {
      items.sort((left, right) =>
        compareCodePoint(identityKey(left, leaf), identityKey(right, leaf)),
      );
    } else if (typeof leaf === 'string' && SEMANTIC_ORDER_FIELDS.has(leaf)) {
      // Explicitly preserve authored order.
    }
    return `[${items.map((item, index) => stableSerialize(item, path.concat(String(index)))).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort(compareCodePoint);
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], path.concat(key))}`)
      .join(',')}}`;
  }
  throw new TypeError(`Unsupported value for stableSerialize at ${path.join('.')}`);
}

function stripExcludedFields(value, excludes) {
  if (!isPlainObject(value)) return value;
  const clone = { ...value };
  for (const field of excludes) delete clone[field];
  return clone;
}

export function changeHeadDigest(changeHead) {
  if (changeHead == null) return null;
  const stripped = stripExcludedFields(changeHead, CHANGE_HEAD_DIGEST_EXCLUDES);
  return sha256Hex(stableSerialize(stripped));
}

/**
 * @param {{
 *   manifests: object[],
 *   span_hashes: Record<string, string>,
 *   inventory: unknown,
 *   change_head: object | null,
 * }} input
 */
export function canonicalGraphHash(input) {
  const manifests = [...(input.manifests ?? [])].sort((left, right) =>
    compareCodePoint(left.id ?? '', right.id ?? ''),
  );
  const spanEntries = Object.entries(input.span_hashes ?? {}).sort(([left], [right]) =>
    compareCodePoint(left, right),
  );
  const payload = {
    algorithm: GRAPH_HASH_ALGORITHM,
    manifests,
    span_hashes: Object.fromEntries(spanEntries),
    inventory: input.inventory ?? null,
    change_head_digest: changeHeadDigest(input.change_head ?? null),
  };
  return sha256Hex(stableSerialize(payload));
}
