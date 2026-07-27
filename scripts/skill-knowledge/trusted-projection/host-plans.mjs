/**
 * Trusted host/surface projection planning.
 *
 * This module is intentionally filesystem- and publisher-free. TX4 supplies a
 * frozen SourceSnapshot plus an application-owned declarative policy, then
 * passes the returned ProjectionPlan to the transaction compiler/verifier.
 *
 * Narrow integration API:
 *   freezeTrustedHostPolicy(input) -> immutable reviewed policy token
 *   deriveProjectionScope(input) -> immutable scope decision
 *   freezeProjectionPlan(input)  -> TX0 ProjectionPlan
 *   projectionLockTarget(input)  -> shared full/skills host lock contract
 *
 * Candidate trees, archives, live dist and caller-provided expected entries are
 * not inputs to this boundary.
 *
 * Policy rules are either exact copies (`from`, `to`) or trusted pre-compiler
 * transforms (`inputs`, `to`, `expected:{sha256,size,posix_mode}`). A transform
 * identity is reviewed policy data bound by trusted_policy_sha256; it never
 * comes from the candidate compiler output.
 */
import { createHash } from 'node:crypto';

export const PRODUCT_HOSTS = Object.freeze([
  'claude-code',
  'codex',
  'cursor',
  'kimi-code',
]);
export const PLAN_INVARIANTS = Object.freeze([
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
]);

const HOST_SET = new Set(PRODUCT_HOSTS);
const SHA256 = /^[a-f0-9]{64}$/u;
const TRANSACTION_ID = /^tpt:tx:[a-z0-9][a-z0-9.-]*$/u;
const LOGICAL_ID = /^[a-z][a-z0-9.-]*$/u;
const SELF_AUTH_FIELDS = Object.freeze([
  'archive',
  'candidate',
  'candidateEntries',
  'candidateSnapshot',
  'expected_entries',
  'liveSnapshot',
]);
const TRUSTED_POLICIES = new WeakSet();

function fail(code, message, witness = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.witness = witness;
  throw error;
}

function comparePath(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function assertCanonicalValue(value, at = '$') {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (value !== value.normalize('NFC')) {
      fail('TPT-PLAN-NONCANONICAL', `non-NFC string at ${at}`);
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail('TPT-PLAN-NONCANONICAL', `non-canonical number at ${at}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCanonicalValue(item, `${at}[${index}]`));
    return;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      assertCanonicalValue(key, `${at}.<key>`);
      assertCanonicalValue(item, `${at}.${key}`);
    }
    return;
  }
  fail('TPT-PLAN-NONCANONICAL', `unsupported canonical value at ${at}`);
}

function canonicalJson(value) {
  assertCanonicalValue(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(domain, value) {
  return createHash('sha256')
    .update(`cc-master/trusted-projection/${domain}/v1alpha1\0`, 'utf8')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

function artifactId(domain, prefix, artifact, ownId) {
  return `tpt:${prefix}:${canonicalHash(
    domain,
    Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== ownId)),
  )}`;
}

export function computeTrustedArtifactId(domain, prefix, artifact, ownId) {
  return artifactId(domain, prefix, artifact, ownId);
}

function assertPortablePath(value, { allowRoot = true } = {}) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.normalize('NFC') ||
    (!allowRoot && value === '.') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail('TPT-ARTIFACT-UNSAFE', `unsafe portable path ${JSON.stringify(value)}`);
  }
  if (value === '.') {
    if (allowRoot) return value;
    fail('TPT-ARTIFACT-UNSAFE', 'root path is not valid here');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    fail('TPT-ARTIFACT-UNSAFE', `unsafe portable path ${JSON.stringify(value)}`);
  }
  return value;
}

function directoryPaths(filePaths) {
  const directories = new Set(['.']);
  for (const filePath of filePaths) {
    const segments = filePath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }
  return [...directories];
}

function buildEntries(files, directoryMode) {
  if (!Number.isInteger(directoryMode) || directoryMode < 0 || directoryMode > 0o7777) {
    fail('TPT-ARTIFACT-UNSAFE', `invalid directory mode ${directoryMode}`);
  }
  const fileEntries = files.map((file) => {
    const [portablePath, sha256, size, posixMode] = file;
    const normalizedPath = assertPortablePath(portablePath, { allowRoot: false });
    if (!SHA256.test(sha256 ?? '') || !Number.isSafeInteger(size) || size < 0) {
      fail('TPT-ARTIFACT-UNSAFE', `invalid file identity for ${normalizedPath}`);
    }
    if (!Number.isInteger(posixMode) || posixMode < 0 || posixMode > 0o7777) {
      fail('TPT-ARTIFACT-UNSAFE', `invalid mode for ${normalizedPath}`);
    }
    return {
      path: normalizedPath,
      kind: 'file',
      sha256,
      size,
      executable: (posixMode & 0o111) !== 0,
      posix_mode: posixMode,
    };
  });
  const filePaths = fileEntries.map((entry) => entry.path);
  if (new Set(filePaths).size !== filePaths.length) {
    fail('TPT-ARTIFACT-UNSAFE', 'duplicate file path in tree');
  }
  const filePathSet = new Set(filePaths);
  for (const filePath of filePaths) {
    const segments = filePath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join('/');
      if (filePathSet.has(ancestor)) {
        fail(
          'TPT-ARTIFACT-UNSAFE',
          `file/directory path collision at ${ancestor}`,
        );
      }
    }
  }

  const entriesByPath = new Map(fileEntries.map((entry) => [entry.path, entry]));
  const directories = directoryPaths(filePaths).sort((left, right) => {
    const depth = right.split('/').length - left.split('/').length;
    return depth || comparePath(left, right);
  });
  for (const directory of directories) {
    const prefix = directory === '.' ? '' : `${directory}/`;
    const children = [...entriesByPath.values()]
      .filter((entry) => {
        if (!entry.path.startsWith(prefix) || entry.path === directory) return false;
        return !entry.path.slice(prefix.length).includes('/');
      })
      .map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        sha256: entry.sha256,
        size: entry.size,
        executable: entry.executable,
        posix_mode: entry.posix_mode,
      }))
      .sort((left, right) => comparePath(left.path, right.path));
    entriesByPath.set(directory, {
      path: directory,
      kind: 'directory',
      sha256: canonicalHash('directory-entry', children),
      size: 0,
      executable: (directoryMode & 0o111) !== 0,
      posix_mode: directoryMode,
    });
  }
  return [...entriesByPath.values()].sort((left, right) => comparePath(left.path, right.path));
}

function treeIdentity(entries) {
  const treeSha256 = canonicalHash('artifact-tree', { entries });
  return {
    treeSha256,
    contentId: `tpt:content:${treeSha256}`,
  };
}

function assertEntry(entry) {
  assertPortablePath(entry?.path);
  if (entry?.kind !== 'file' && entry?.kind !== 'directory') {
    fail('TPT-ARTIFACT-UNSAFE', `unsupported entry kind ${JSON.stringify(entry?.kind)}`);
  }
  if (
    !SHA256.test(entry.sha256 ?? '') ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    !Number.isInteger(entry.posix_mode) ||
    entry.posix_mode < 0 ||
    entry.posix_mode > 0o7777 ||
    entry.executable !== ((entry.posix_mode & 0o111) !== 0)
  ) {
    fail('TPT-ARTIFACT-UNSAFE', `invalid entry identity for ${entry.path}`);
  }
}

function assertSourceSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== 'cc-master/trusted-projection/source-snapshot/v1alpha1') {
    fail('TPT-SOURCE-SNAPSHOT-INVALID', 'source snapshot schema is not v1alpha1');
  }
  const expectedFields = [
    'entries',
    'git_tree',
    'mode_model',
    'schema',
    'source_content_id',
    'source_root_id',
    'source_snapshot_id',
    'transaction_id',
    'tree_sha256',
  ];
  if (
    canonicalJson(Object.keys(snapshot).sort()) !== canonicalJson(expectedFields)
  ) {
    fail('TPT-SOURCE-SNAPSHOT-INVALID', 'source snapshot shape is not closed');
  }
  if (!TRANSACTION_ID.test(snapshot.transaction_id ?? '')) {
    fail('TPT-SOURCE-SNAPSHOT-INVALID', 'invalid transaction id');
  }
  if (
    !LOGICAL_ID.test(snapshot.source_root_id ?? '') ||
    snapshot.mode_model !== 'posix-12bit' ||
    (snapshot.git_tree !== null && !SHA256.test(snapshot.git_tree ?? ''))
  ) {
    fail('TPT-SOURCE-SNAPSHOT-INVALID', 'invalid source root, git tree, or mode model');
  }
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length === 0) {
    fail('TPT-SOURCE-SNAPSHOT-INVALID', 'source snapshot entries are empty');
  }
  snapshot.entries.forEach(assertEntry);
  const paths = snapshot.entries.map((entry) => entry.path);
  const sorted = [...paths].sort(comparePath);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((entry, index) => entry !== sorted[index])
  ) {
    fail('TPT-ARTIFACT-UNSAFE', 'source entries are duplicate or nondeterministically ordered');
  }
  if (
    snapshot.entries[0]?.path !== '.' ||
    snapshot.entries[0]?.kind !== 'directory'
  ) {
    fail('TPT-ARTIFACT-UNSAFE', 'source snapshot root directory is missing');
  }
  const identity = treeIdentity(snapshot.entries);
  if (
    snapshot.tree_sha256 !== identity.treeSha256 ||
    snapshot.source_content_id !== identity.contentId
  ) {
    fail('TPT-SOURCE-SNAPSHOT-INVALID', 'source snapshot content identity does not match entries');
  }
  const expectedId = artifactId(
    'source-snapshot',
    'source',
    snapshot,
    'source_snapshot_id',
  );
  if (snapshot.source_snapshot_id !== expectedId) {
    fail('TPT-SOURCE-SNAPSHOT-INVALID', 'source snapshot artifact id does not match');
  }
}

export function freezeSourceSnapshot({
  transactionId,
  rootId = 'plugin-src',
  entries,
  gitTree = null,
  directoryMode = 0o755,
}) {
  if (!TRANSACTION_ID.test(transactionId ?? '') || !LOGICAL_ID.test(rootId ?? '')) {
    fail('TPT-SOURCE-SNAPSHOT-INVALID', 'source snapshot identity is malformed');
  }
  if (!Array.isArray(entries)) {
    fail('TPT-SOURCE-SNAPSHOT-INVALID', 'source snapshot entries are required');
  }
  const files = entries
    .filter((entry) => entry?.kind === 'file')
    .map((entry) => [
      entry.path,
      entry.sha256,
      entry.size,
      entry.posix_mode,
    ]);
  const normalized = buildEntries(files, directoryMode);
  const identity = treeIdentity(normalized);
  const snapshot = {
    schema: 'cc-master/trusted-projection/source-snapshot/v1alpha1',
    transaction_id: transactionId,
    source_snapshot_id: '',
    source_content_id: identity.contentId,
    source_root_id: rootId,
    git_tree: gitTree,
    mode_model: 'posix-12bit',
    entries: normalized,
    tree_sha256: identity.treeSha256,
  };
  snapshot.source_snapshot_id = artifactId(
    'source-snapshot',
    'source',
    snapshot,
    'source_snapshot_id',
  );
  assertSourceSnapshot(snapshot);
  return deepFreeze(snapshot);
}

function validatePolicyShape(policy) {
  if (
    !policy ||
    !LOGICAL_ID.test(policy.id ?? '') ||
    !policy.declaration ||
    policy.declaration.schema !== 'cc-master/trusted-projection-host-policy/v1alpha1'
  ) {
    fail('TPT-PLAN-UNTRUSTED-POLICY', 'projection policy is malformed');
  }
  const declaredHosts = Object.keys(policy.declaration.hosts ?? {}).sort();
  const productHosts = [...PRODUCT_HOSTS].sort();
  if (canonicalJson(declaredHosts) !== canonicalJson(productHosts)) {
    fail('TPT-PLAN-HOST-PARITY', 'trusted policy must declare exactly all product hosts', {
      declared_hosts: declaredHosts,
    });
  }
  const scope = policy.declaration.scope;
  if (
    !scope ||
    !['expand', 'fail'].includes(scope.cross_surface_action) ||
    !Array.isArray(scope.required_source_paths) ||
    !Array.isArray(scope.skills_safe_prefixes) ||
    !Array.isArray(scope.cross_surface_prefixes)
  ) {
    fail('TPT-PLAN-UNTRUSTED-POLICY', 'projection scope policy is malformed');
  }
  for (const value of [
    ...scope.required_source_paths,
    ...scope.skills_safe_prefixes,
    ...scope.cross_surface_prefixes,
  ]) {
    assertPortablePath(value.endsWith('/') ? value.slice(0, -1) : value, {
      allowRoot: false,
    });
  }
  assertCanonicalValue(policy.declaration);
  return policy.declaration;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

/**
 * Application bootstrap freezes reviewed source/strategy projection rules once.
 * The returned object is the only policy form accepted by the planner; candidate
 * or archive data cannot manufacture the module-private trust mark.
 */
export function freezeTrustedHostPolicy({ id, declaration }) {
  const policy = {
    id,
    declaration: structuredClone(declaration),
  };
  validatePolicyShape(policy);
  deepFreeze(policy);
  TRUSTED_POLICIES.add(policy);
  return policy;
}

function validatePolicy(policy) {
  if (!policy || !TRUSTED_POLICIES.has(policy)) {
    fail(
      'TPT-PLAN-UNTRUSTED-POLICY',
      'policy was not frozen by the trusted host-policy bootstrap',
    );
  }
  return validatePolicyShape(policy);
}

function sourceFileMap(snapshot) {
  return new Map(
    snapshot.entries
      .filter((entry) => entry.kind === 'file')
      .map((entry) => [entry.path, entry]),
  );
}

function changedFilePaths(current, previous) {
  const currentFiles = sourceFileMap(current);
  const previousFiles = sourceFileMap(previous);
  const paths = new Set([...currentFiles.keys(), ...previousFiles.keys()]);
  return [...paths]
    .filter((portablePath) => {
      const left = currentFiles.get(portablePath);
      const right = previousFiles.get(portablePath);
      return canonicalJson(left ?? null) !== canonicalJson(right ?? null);
    })
    .sort(comparePath);
}

function hasPrefix(portablePath, prefixes) {
  return prefixes.some((prefix) => portablePath.startsWith(prefix));
}

function assertVerifiedBase(verifiedBase, host) {
  if (
    !verifiedBase ||
    verifiedBase.schema !== 'cc-master/trusted-projection-verified-base/v1alpha1' ||
    verifiedBase.host !== host ||
    !verifiedBase.source_snapshot ||
    verifiedBase.verified_source_content_id !==
      verifiedBase.source_snapshot.source_content_id ||
    !/^tpt:content:[a-f0-9]{64}$/u.test(verifiedBase.live_artifact_content_id ?? '')
  ) {
    fail('TPT-SKILLS-BASE-UNVERIFIED', 'skills scope requires a verified full-host base');
  }
  assertSourceSnapshot(verifiedBase.source_snapshot);
}

export function projectionLockTarget({ host, surface }) {
  if (!HOST_SET.has(host) || !['host', 'skills'].includes(surface)) {
    fail('TPT-LOCK-TARGET-INVALID', 'lock target host/surface is invalid');
  }
  return Object.freeze({
    schema: 'cc-master/trusted-projection-lock-target/v1alpha1',
    host,
    requested_surface: surface,
    lock_key: `plugin-dist-host:${host}`,
    serializes_surfaces: Object.freeze(['host', 'skills']),
  });
}

export function deriveProjectionScope({
  sourceSnapshot,
  host,
  scope,
  policy,
  verifiedBase = null,
}) {
  assertSourceSnapshot(sourceSnapshot);
  if (!HOST_SET.has(host) || !['host', 'skills'].includes(scope)) {
    fail('TPT-PLAN-SCOPE-INVALID', 'projection host/scope is invalid');
  }
  const declaration = validatePolicy(policy);
  const knownPaths = new Set(sourceSnapshot.entries.map((entry) => entry.path));
  const missing = declaration.scope.required_source_paths.filter(
    (portablePath) => !knownPaths.has(portablePath),
  );
  if (missing.length > 0) {
    fail('TPT-PLAN-SOURCE-INCOMPLETE', 'full-host source snapshot is incomplete', {
      missing,
    });
  }
  if (scope === 'host') {
    return Object.freeze({
      schema: 'cc-master/trusted-projection-scope-decision/v1alpha1',
      host,
      requested_scope: 'host',
      effective_surface: 'host',
      verified_base_content_id: null,
      changed_paths: Object.freeze([]),
      expansion_reason: null,
    });
  }

  assertVerifiedBase(verifiedBase, host);
  const basePaths = new Set(
    verifiedBase.source_snapshot.entries.map((entry) => entry.path),
  );
  const missingBase = declaration.scope.required_source_paths.filter(
    (portablePath) => !basePaths.has(portablePath),
  );
  if (missingBase.length > 0) {
    fail(
      'TPT-SKILLS-BASE-UNVERIFIED',
      'verified base is not a full-host source snapshot',
      { missing: missingBase },
    );
  }
  const changedPaths = changedFilePaths(
    sourceSnapshot,
    verifiedBase.source_snapshot,
  );
  const crossSurface = changedPaths.filter(
    (portablePath) =>
      hasPrefix(portablePath, declaration.scope.cross_surface_prefixes) ||
      !hasPrefix(portablePath, declaration.scope.skills_safe_prefixes),
  );
  if (crossSurface.length > 0 && declaration.scope.cross_surface_action === 'fail') {
    fail(
      'TPT-SKILLS-SCOPE-CROSS-SURFACE',
      'skills scope cannot prove isolation from other host surfaces',
      { changed_paths: crossSurface },
    );
  }
  return Object.freeze({
    schema: 'cc-master/trusted-projection-scope-decision/v1alpha1',
    host,
    requested_scope: 'skills',
    effective_surface: crossSurface.length > 0 ? 'host' : 'skills',
    verified_base_content_id: verifiedBase.live_artifact_content_id,
    changed_paths: Object.freeze(changedPaths),
    expansion_reason:
      crossSurface.length > 0 ? 'cross-surface-source-or-strategy-drift' : null,
  });
}

function normalizeRules(rules, sourceFiles) {
  if (!Array.isArray(rules) || rules.length === 0) {
    fail('TPT-PLAN-UNTRUSTED-POLICY', 'host policy has no projection rules');
  }
  return rules
    .map((rule) => {
      const inputs = Array.isArray(rule?.inputs)
        ? [...rule.inputs]
        : rule?.from
          ? [rule.from]
          : [];
      if (
        !rule ||
        !/^[a-z][a-z0-9.-]*$/u.test(rule.operator ?? '') ||
        inputs.length === 0 ||
        new Set(inputs).size !== inputs.length ||
        inputs.some((input) => !sourceFiles.has(input))
      ) {
        fail('TPT-PLAN-DRIFT', 'projection rule input is absent from frozen source', {
          inputs,
        });
      }
      inputs.forEach((input) => assertPortablePath(input, { allowRoot: false }));
      assertPortablePath(rule.to, { allowRoot: false });
      if (rule.to === 'knowledge' || rule.to.startsWith('knowledge/')) {
        fail(
          'TPT-PLAN-KNOWLEDGE-EXCLUDED',
          'repo-only knowledge must not enter runtime host plans',
          { output: rule.to },
        );
      }
      let expected = null;
      if (rule.expected !== undefined) {
        const candidate = rule.expected;
        if (
          !candidate ||
          !SHA256.test(candidate.sha256 ?? '') ||
          !Number.isSafeInteger(candidate.size) ||
          candidate.size < 0 ||
          !Number.isInteger(candidate.posix_mode) ||
          candidate.posix_mode < 0 ||
          candidate.posix_mode > 0o7777 ||
          Object.keys(candidate).sort().join(',') !== 'posix_mode,sha256,size'
        ) {
          fail(
            'TPT-PLAN-UNTRUSTED-POLICY',
            `invalid trusted transform identity for ${rule.to}`,
          );
        }
        expected = {
          sha256: candidate.sha256,
          size: candidate.size,
          posix_mode: candidate.posix_mode,
        };
      } else if (inputs.length !== 1) {
        fail(
          'TPT-PLAN-UNTRUSTED-POLICY',
          `multi-input transform ${rule.to} requires a trusted expected identity`,
        );
      }
      return {
        operator: rule.operator,
        inputs,
        to: rule.to,
        expected,
      };
    })
    .sort(
      (left, right) =>
        comparePath(left.to, right.to) ||
        comparePath(left.inputs.join('\0'), right.inputs.join('\0')) ||
        comparePath(left.operator, right.operator),
    );
}

export function freezeProjectionPlan(input) {
  for (const field of SELF_AUTH_FIELDS) {
    if (Object.hasOwn(input ?? {}, field)) {
      fail(
        'TPT-PLAN-SELF-AUTH',
        `planner refuses candidate/archive-derived field ${field}`,
      );
    }
  }
  const {
    sourceSnapshot,
    host,
    scope,
    policy,
    verifiedBase = null,
  } = input ?? {};
  const scopeDecision = deriveProjectionScope({
    sourceSnapshot,
    host,
    scope,
    policy,
    verifiedBase,
  });
  const declaration = validatePolicy(policy);
  const sourceFiles = sourceFileMap(sourceSnapshot);
  const hostPolicy = declaration.hosts[host];
  const rules = normalizeRules(
    scopeDecision.effective_surface === 'skills'
      ? hostPolicy.skills_rules
      : hostPolicy.host_rules,
    sourceFiles,
  );
  const mappedFiles = rules.map((rule) => {
    const sourceEntry = sourceFiles.get(rule.inputs[0]);
    const identity = rule.expected ?? sourceEntry;
    return [rule.to, identity.sha256, identity.size, identity.posix_mode];
  });
  const outputPaths = mappedFiles.map(([portablePath]) => portablePath);
  if (new Set(outputPaths).size !== outputPaths.length) {
    fail('TPT-PLAN-DRIFT', 'projection policy maps multiple inputs to one output');
  }
  const expectedEntries = buildEntries(mappedFiles, declaration.directory_mode);
  if (
    expectedEntries.some(
      (entry) => entry.path === 'knowledge' || entry.path.startsWith('knowledge/'),
    )
  ) {
    fail('TPT-PLAN-KNOWLEDGE-EXCLUDED', 'repo-only knowledge output detected');
  }

  const operations = [
    {
      operator: `scope.${scopeDecision.effective_surface}`,
      inputs: [],
      outputs: [],
      parameters_sha256: canonicalHash('projection-parameters', scopeDecision),
    },
    ...rules.map((rule) => ({
      operator: rule.operator,
      inputs: rule.inputs,
      outputs: [rule.to],
      parameters_sha256: canonicalHash('projection-parameters', {
        host,
        surface: scopeDecision.effective_surface,
        inputs: rule.inputs,
        to: rule.to,
        expected: rule.expected,
      }),
    })),
  ];
  const plan = {
    schema: 'cc-master/trusted-projection/projection-plan/v1alpha1',
    transaction_id: sourceSnapshot.transaction_id,
    projection_plan_id: '',
    host,
    surface: scopeDecision.effective_surface,
    input_kind: 'source_snapshot',
    input_snapshot_id: sourceSnapshot.source_snapshot_id,
    input_content_id: sourceSnapshot.source_content_id,
    upstream_publish_receipt_id: null,
    trusted_policy_id: policy.id,
    trusted_policy_sha256: canonicalHash('trusted-policy', declaration),
    operations,
    expected_entries: expectedEntries,
  };
  plan.projection_plan_id = artifactId(
    'projection-plan',
    'plan',
    plan,
    'projection_plan_id',
  );
  return Object.freeze(plan);
}
