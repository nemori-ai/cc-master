import { createHash } from 'node:crypto';

const ID_FIELDS = Object.freeze({
  'source-snapshot': ['source_snapshot_id', 'source'],
  'projection-plan': ['projection_plan_id', 'plan'],
  'artifact-snapshot': ['artifact_snapshot_id', 'observation'],
  'verified-snapshot-attestation': [
    'verified_snapshot_attestation_id',
    'verify',
  ],
  'publish-receipt': ['publish_receipt_id', 'publish'],
  'release-bundle-attestation': [
    'release_bundle_attestation_id',
    'release',
  ],
});

function rejectUnsupported(value, path = '$') {
  if (value === null || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'string') {
    if (value !== value.normalize('NFC')) {
      throw new TypeError(`non-NFC string at ${path}`);
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError(`non-canonical number at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectUnsupported(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (key !== key.normalize('NFC')) {
        throw new TypeError(`non-NFC object key at ${path}`);
      }
      rejectUnsupported(item, `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`unsupported canonical JSON value at ${path}`);
}

/**
 * RFC 8785/JCS-compatible canonical JSON for the contract's deliberately
 * restricted value domain (NFC strings, safe integers, booleans, null,
 * arrays, and plain objects). Object keys use UTF-16 code-unit ordering.
 */
export function canonicalJson(value) {
  rejectUnsupported(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalHash(domain, body) {
  if (!/^[a-z][a-z0-9-]*$/u.test(domain)) {
    throw new TypeError(`invalid trusted projection hash domain: ${domain}`);
  }
  return createHash('sha256')
    .update(`cc-master/trusted-projection/${domain}/v1alpha1\0`, 'utf8')
    .update(canonicalJson(body), 'utf8')
    .digest('hex');
}

export function withoutOwnId(artifact, idField) {
  const body = {};
  for (const [key, value] of Object.entries(artifact)) {
    if (key !== idField) body[key] = value;
  }
  return body;
}

export function computeArtifactId(kind, artifact) {
  const tuple = ID_FIELDS[kind];
  if (!tuple) throw new TypeError(`unknown trusted projection artifact kind: ${kind}`);
  const [idField, prefix] = tuple;
  return `tpt:${prefix}:${canonicalHash(kind, withoutOwnId(artifact, idField))}`;
}

export function computeTreeSha256(entries) {
  return canonicalHash('artifact-tree', { entries });
}

export function computeContentId(entries) {
  return `tpt:content:${computeTreeSha256(entries)}`;
}

export const ARTIFACT_ID_FIELDS = ID_FIELDS;
