/**
 * Pre-compiler trusted projection policy planner.
 *
 * This module consumes only a frozen SourceSnapshot, reviewed host strategy
 * declarations, and (only when a reproducible transform needs bytes) source
 * blobs whose identity is checked against that snapshot. It never scans a
 * candidate, archive, live dist, or compiler output.
 *
 * Narrow integration API:
 *   deriveTrustedExpectedFiles(input) -> exact files + provenance
 *   freezeTrustedProjectionPolicy(input) -> host-plans branded policy
 *
 * Pass the latter directly as `policy` to freezeProjectionPlan().
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  PRODUCT_HOSTS,
  freezeTrustedHostPolicy,
} from './host-plans.mjs';
import { buildAndValidateGraph } from '../graph.mjs';
import { buildHostArtifacts } from '../compile/emit.mjs';
import { materializeRuntimeArtifacts } from '../compile/skill-overlay.mjs';
import { projectCoverageSubgraph, resolveHostCoveragePlan } from '../host-coverage.mjs';

const require = createRequire(import.meta.url);
const {
  SKILL_DIST_EXCLUDES,
  applySkillProjection,
  copyDir,
  copyFileWithMode,
  planSkillProjection,
  readStrategyMode,
  readYamlString,
} = require('../../project-skill.cjs');

export const REVIEWED_STRATEGIES_SCHEMA =
  'cc-master/trusted-projection/reviewed-host-strategies/v1alpha1';
export const PROJECTION_METADATA_SCHEMA =
  'cc-master/trusted-projection/policy-provenance/v1alpha1';
export const TRUSTED_TRANSFORMS = Object.freeze([
  'source-copy/v1',
  'utf8-replace-all/v1',
  'kimi-manifest/v1',
  'repository-source-projection/v1',
]);

const HOST_SET = new Set(PRODUCT_HOSTS);
const SHA256 = /^[a-f0-9]{64}$/u;
const LOGICAL_ID = /^[a-z][a-z0-9.-]*$/u;
const FORBIDDEN_INPUT_FIELDS = Object.freeze([
  'archive',
  'candidate',
  'candidateEntries',
  'candidateSnapshot',
  'compilerOutput',
  'expected_entries',
  'liveSnapshot',
]);
const REPOSITORY_TRANSFORM_IDENTITIES = new WeakMap();

function fail(code, message, witness = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.witness = witness;
  throw error;
}

function comparePath(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function portablePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.normalize('NFC') ||
    value === '.' ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail('TPT-ARTIFACT-UNSAFE', `unsafe portable path ${JSON.stringify(value)}`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail('TPT-ARTIFACT-UNSAFE', `unsafe portable path ${JSON.stringify(value)}`);
  }
  return value;
}

function isKnowledgePath(value) {
  return value === 'knowledge' || value.startsWith('knowledge/');
}

function closedShape(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('TPT-POLICY-DECLARATION-INVALID', `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail('TPT-POLICY-DECLARATION-INVALID', `${label} shape is not closed`, {
      actual,
      expected,
    });
  }
}

function sourceFiles(snapshot) {
  if (
    !snapshot ||
    snapshot.schema !== 'cc-master/trusted-projection/source-snapshot/v1alpha1' ||
    !Array.isArray(snapshot.entries)
  ) {
    fail('TPT-SOURCE-SNAPSHOT-INVALID', 'a frozen v1alpha1 SourceSnapshot is required');
  }
  return new Map(
    snapshot.entries
      .filter((entry) => entry.kind === 'file')
      .map((entry) => [entry.path, entry]),
  );
}

function blobMap(sourceBytes) {
  if (sourceBytes === undefined || sourceBytes === null) return new Map();
  const pairs =
    sourceBytes instanceof Map ? [...sourceBytes.entries()] : Object.entries(sourceBytes);
  return new Map(
    pairs.map(([portable, value]) => [
      portablePath(portable),
      Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value),
    ]),
  );
}

function checkedBlob(portable, blobs, files) {
  const entry = files.get(portable);
  const bytes = blobs.get(portable);
  if (!entry || !bytes) {
    fail(
      'TPT-POLICY-TRANSFORM-INPUT-MISSING',
      `reproducible transform requires frozen source bytes for ${portable}`,
    );
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== entry.size || sha256 !== entry.sha256) {
    fail(
      'TPT-POLICY-SOURCE-DRIFT',
      `source bytes do not match frozen identity for ${portable}`,
      {
        expected_sha256: entry.sha256,
        actual_sha256: sha256,
        expected_size: entry.size,
        actual_size: bytes.length,
      },
    );
  }
  return bytes;
}

function validateSourceRef(ref, files) {
  closedShape(ref, ['path', 'sha256', 'size', 'posix_mode'], 'source_ref');
  const portable = portablePath(ref.path);
  if (isKnowledgePath(portable)) {
    fail(
      'TPT-PLAN-KNOWLEDGE-EXCLUDED',
      `repo-only plugin/src/knowledge input is forbidden: ${portable}`,
    );
  }
  if (
    !SHA256.test(ref.sha256) ||
    !Number.isSafeInteger(ref.size) ||
    ref.size < 0 ||
    !Number.isInteger(ref.posix_mode) ||
    ref.posix_mode < 0 ||
    ref.posix_mode > 0o7777
  ) {
    fail('TPT-POLICY-DECLARATION-INVALID', `invalid source ref identity for ${portable}`);
  }
  const actual = files.get(portable);
  if (
    !actual ||
    actual.sha256 !== ref.sha256 ||
    actual.size !== ref.size ||
    actual.posix_mode !== ref.posix_mode
  ) {
    fail('TPT-POLICY-SOURCE-DRIFT', `reviewed source identity drifted: ${portable}`, {
      reviewed: ref,
      frozen: actual ?? null,
    });
  }
  return actual;
}

function sourceRefMap(output, files) {
  if (!Array.isArray(output.source_refs) || output.source_refs.length === 0) {
    fail('TPT-POLICY-DECLARATION-INVALID', `output ${output.path} has no source refs`);
  }
  const refs = new Map();
  for (const ref of output.source_refs) {
    const entry = validateSourceRef(ref, files);
    if (refs.has(ref.path)) {
      fail('TPT-POLICY-DECLARATION-INVALID', `duplicate source ref ${ref.path}`);
    }
    refs.set(ref.path, entry);
  }
  return refs;
}

function requireParameterSource(parameters, key, refs) {
  const value = portablePath(parameters[key]);
  if (!refs.has(value)) {
    fail(
      'TPT-POLICY-DECLARATION-INVALID',
      `transform parameter ${key}=${value} is not a reviewed source ref`,
    );
  }
  return value;
}

function reproduceTransform(output, refs, blobs) {
  const { transform } = output;
  if (
    !transform ||
    typeof transform !== 'object' ||
    Array.isArray(transform) ||
    typeof transform.id !== 'string' ||
    !transform.parameters ||
    typeof transform.parameters !== 'object' ||
    Array.isArray(transform.parameters)
  ) {
    fail('TPT-POLICY-DECLARATION-INVALID', `invalid transform for ${output.path}`);
  }
  const parameters = transform.parameters;
  if (transform.id === 'source-copy/v1') {
    closedShape(parameters, ['source'], `${transform.id}.parameters`);
    const source = requireParameterSource(parameters, 'source', refs);
    const entry = refs.get(source);
    return {
      sha256: entry.sha256,
      size: entry.size,
      posix_mode: entry.posix_mode,
    };
  }
  if (transform.id === 'utf8-replace-all/v1') {
    closedShape(
      parameters,
      ['source', 'mode_source', 'replacements'],
      `${transform.id}.parameters`,
    );
    const source = requireParameterSource(parameters, 'source', refs);
    const modeSource = requireParameterSource(parameters, 'mode_source', refs);
    if (!Array.isArray(parameters.replacements) || parameters.replacements.length === 0) {
      fail('TPT-POLICY-DECLARATION-INVALID', 'utf8 replacements must be non-empty');
    }
    let text = checkedBlob(source, blobs, refs).toString('utf8');
    for (const replacement of parameters.replacements) {
      closedShape(replacement, ['from', 'to'], 'utf8 replacement');
      if (
        typeof replacement.from !== 'string' ||
        replacement.from.length === 0 ||
        typeof replacement.to !== 'string'
      ) {
        fail('TPT-POLICY-DECLARATION-INVALID', 'invalid utf8 replacement');
      }
      text = text.split(replacement.from).join(replacement.to);
    }
    if (/\{\{[A-Z0-9_]+\}\}/u.test(text)) {
      fail('TPT-POLICY-TRANSFORM-UNRESOLVED', `unresolved adapter slot in ${output.path}`);
    }
    const bytes = Buffer.from(text, 'utf8');
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      posix_mode: refs.get(modeSource).posix_mode,
    };
  }
  if (transform.id === 'kimi-manifest/v1') {
    closedShape(
      parameters,
      ['manifest', 'hooks_fragment'],
      `${transform.id}.parameters`,
    );
    const manifestPath = requireParameterSource(parameters, 'manifest', refs);
    const manifestBytes = checkedBlob(manifestPath, blobs, refs);
    let manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8'));
    } catch {
      fail('TPT-POLICY-TRANSFORM-INVALID', `invalid JSON manifest ${manifestPath}`);
    }
    if (parameters.hooks_fragment === null) {
      delete manifest.hooks;
    } else {
      const hooksPath = requireParameterSource(parameters, 'hooks_fragment', refs);
      const hooksBytes = checkedBlob(hooksPath, blobs, refs);
      let fragment;
      try {
        fragment = JSON.parse(hooksBytes.toString('utf8'));
      } catch {
        fail('TPT-POLICY-TRANSFORM-INVALID', `invalid hooks fragment ${hooksPath}`);
      }
      const hooks = Array.isArray(fragment) ? fragment : fragment?.hooks;
      if (!Array.isArray(hooks)) {
        fail('TPT-POLICY-TRANSFORM-INVALID', `${hooksPath} does not declare hooks[]`);
      }
      manifest.hooks = hooks;
    }
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      posix_mode: refs.get(manifestPath).posix_mode,
    };
  }
  if (transform.id === 'repository-source-projection/v1') {
    const identity = REPOSITORY_TRANSFORM_IDENTITIES.get(transform);
    if (!identity) {
      fail(
        'TPT-POLICY-TRANSFORM-UNDECLARED',
        `repository projection transform for ${output.path} was not produced by the trusted builder`,
      );
    }
    return identity;
  }
  fail(
    'TPT-POLICY-TRANSFORM-UNDECLARED',
    `generated artifact ${output.path} uses undeclared transform ${transform.id}`,
  );
}

function normalizeOutput(output, files, blobs) {
  closedShape(
    output,
    ['path', 'kind', 'producer', 'source_refs', 'transform'],
    'reviewed output',
  );
  const portable = portablePath(output.path);
  if (isKnowledgePath(portable)) {
    fail(
      'TPT-PLAN-KNOWLEDGE-EXCLUDED',
      `runtime knowledge output is forbidden: ${portable}`,
    );
  }
  if (output.kind !== 'file' || !LOGICAL_ID.test(output.producer ?? '')) {
    fail('TPT-POLICY-DECLARATION-INVALID', `invalid output kind/producer for ${portable}`);
  }
  const refs = sourceRefMap(output, files);
  const identity = reproduceTransform(output, refs, blobs);
  return Object.freeze({
    path: portable,
    kind: 'file',
    ...identity,
    executable: (identity.posix_mode & 0o111) !== 0,
    producer: output.producer,
    source_refs: Object.freeze(
      output.source_refs
        .map((ref) => Object.freeze({ ...ref }))
        .sort((left, right) => comparePath(left.path, right.path)),
    ),
    transform: Object.freeze(structuredClone(output.transform)),
  });
}

function validateTopLevel(input) {
  for (const field of FORBIDDEN_INPUT_FIELDS) {
    if (Object.hasOwn(input ?? {}, field)) {
      fail('TPT-PLAN-SELF-AUTH', `policy planner refuses ${field}`);
    }
  }
  const reviewed = input?.reviewedStrategies;
  if (!reviewed || reviewed.schema !== REVIEWED_STRATEGIES_SCHEMA) {
    fail('TPT-POLICY-DECLARATION-INVALID', 'reviewed strategy schema is invalid');
  }
  closedShape(
    reviewed,
    ['schema', 'policy_id', 'directory_mode', 'scope', 'hosts'],
    'reviewed strategies',
  );
  if (
    !LOGICAL_ID.test(reviewed.policy_id ?? '') ||
    !Number.isInteger(reviewed.directory_mode) ||
    reviewed.directory_mode < 0 ||
    reviewed.directory_mode > 0o7777
  ) {
    fail('TPT-POLICY-DECLARATION-INVALID', 'invalid policy id or directory mode');
  }
  const declaredHosts = Object.keys(reviewed.hosts ?? {}).sort();
  if (
    declaredHosts.length !== PRODUCT_HOSTS.length ||
    declaredHosts.some((host, index) => host !== [...PRODUCT_HOSTS].sort()[index])
  ) {
    fail('TPT-PLAN-HOST-PARITY', 'reviewed strategies must cover exactly four hosts');
  }
  return reviewed;
}

function normalizeScope(scope) {
  closedShape(
    scope,
    [
      'required_source_paths',
      'skills_safe_prefixes',
      'cross_surface_prefixes',
      'cross_surface_action',
    ],
    'projection scope',
  );
  return structuredClone(scope);
}

export function deriveTrustedExpectedFiles(input) {
  const reviewed = validateTopLevel(input);
  const files = sourceFiles(input.sourceSnapshot);
  const blobs = blobMap(input.sourceBytes);
  const results = {};
  for (const host of PRODUCT_HOSTS) {
    if (!HOST_SET.has(host)) continue;
    const hostDeclaration = reviewed.hosts[host];
    closedShape(hostDeclaration, ['host_outputs', 'skills_outputs'], `${host} strategy`);
    results[host] = {};
    for (const [surface, field] of [
      ['host', 'host_outputs'],
      ['skills', 'skills_outputs'],
    ]) {
      if (!Array.isArray(hostDeclaration[field]) || hostDeclaration[field].length === 0) {
        fail('TPT-POLICY-DECLARATION-INVALID', `${host}/${surface} has no outputs`);
      }
      const outputs = hostDeclaration[field]
        .map((output) => normalizeOutput(output, files, blobs))
        .sort((left, right) => comparePath(left.path, right.path));
      const paths = outputs.map((output) => output.path);
      if (new Set(paths).size !== paths.length) {
        fail('TPT-PLAN-DRIFT', `${host}/${surface} maps duplicate runtime paths`);
      }
      results[host][surface] = Object.freeze(outputs);
    }
    Object.freeze(results[host]);
  }
  return Object.freeze(results);
}

export function freezeTrustedProjectionPolicy(input) {
  const reviewed = validateTopLevel(input);
  const expected = deriveTrustedExpectedFiles(input);
  const provenanceHosts = {};
  const hosts = {};
  for (const host of PRODUCT_HOSTS) {
    provenanceHosts[host] = {};
    hosts[host] = {};
    for (const [surface, rulesField] of [
      ['host', 'host_rules'],
      ['skills', 'skills_rules'],
    ]) {
      provenanceHosts[host][surface] = expected[host][surface].map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        sha256: entry.sha256,
        size: entry.size,
        posix_mode: entry.posix_mode,
        producer: entry.producer,
        source_refs: entry.source_refs,
        transform: entry.transform,
      }));
      hosts[host][rulesField] = expected[host][surface].map((entry) => ({
        operator: `trusted.${entry.producer}.${entry.transform.id.replaceAll('/', '.')}`,
        inputs: entry.source_refs.map((ref) => ref.path),
        to: entry.path,
        expected: {
          sha256: entry.sha256,
          size: entry.size,
          posix_mode: entry.posix_mode,
        },
      }));
    }
  }
  return freezeTrustedHostPolicy({
    id: reviewed.policy_id,
    declaration: {
      schema: 'cc-master/trusted-projection-host-policy/v1alpha1',
      directory_mode: reviewed.directory_mode,
      scope: normalizeScope(reviewed.scope),
      projection_metadata: {
        schema: PROJECTION_METADATA_SCHEMA,
        reviewed_strategies_schema: reviewed.schema,
        hosts: provenanceHosts,
      },
      hosts,
    },
  });
}

function walkRegularFiles(root) {
  const found = [];
  const visit = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      comparePath(a.name, b.name),
    )) {
      const absolute = path.join(directory, entry.name);
      const portable = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        fail('TPT-ARTIFACT-UNSAFE', `symlink in trusted source/projection: ${portable}`);
      }
      if (stat.isDirectory()) visit(absolute, portable);
      else if (stat.isFile()) found.push({ absolute, path: portable, stat });
      else fail('TPT-ARTIFACT-UNSAFE', `special file in trusted source/projection: ${portable}`);
    }
  };
  visit(root);
  return found.sort((left, right) => comparePath(left.path, right.path));
}

function assertFrozenRepositorySource(repoRoot, snapshot) {
  const src = path.join(repoRoot, 'plugin', 'src');
  const actual = walkRegularFiles(src);
  const frozen = sourceFiles(snapshot);
  if (
    actual.length !== frozen.size ||
    actual.some((entry) => !frozen.has(entry.path))
  ) {
    fail('TPT-POLICY-SOURCE-DRIFT', 'plugin/src closed file set differs from SourceSnapshot');
  }
  for (const item of actual) {
    const bytes = fs.readFileSync(item.absolute);
    const expected = frozen.get(item.path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const mode = item.stat.mode & 0o7777;
    if (
      sha256 !== expected.sha256 ||
      bytes.length !== expected.size ||
      mode !== expected.posix_mode
    ) {
      fail('TPT-POLICY-SOURCE-DRIFT', `plugin/src drifted after freeze: ${item.path}`);
    }
  }
  return { src, frozen };
}

function copyTracked(source, target, sourceRoot, stagingRoot, sourcesByOutput) {
  copyFileWithMode(source, target);
  const output = path.relative(stagingRoot, target).split(path.sep).join('/');
  const input = path.relative(sourceRoot, source).split(path.sep).join('/');
  sourcesByOutput.set(output, new Set([input]));
}

function copyDirTracked(source, target, sourceRoot, stagingRoot, sourcesByOutput) {
  copyDir(source, target);
  for (const file of walkRegularFiles(target)) {
    const output = path.relative(stagingRoot, file.absolute).split(path.sep).join('/');
    const relative = path.relative(target, file.absolute);
    const input = path.relative(sourceRoot, path.join(source, relative)).split(path.sep).join('/');
    sourcesByOutput.set(output, new Set([input]));
  }
}

function projectRepositoryNonSkills({
  sourceRoot,
  host,
  stagingRoot,
  sourcesByOutput,
}) {
  const manifestDirectory = {
    'claude-code': '.claude-plugin',
    codex: '.codex-plugin',
    cursor: '.cursor-plugin',
  }[host];
  if (manifestDirectory) {
    copyDirTracked(
      path.join(sourceRoot, manifestDirectory),
      path.join(stagingRoot, manifestDirectory),
      sourceRoot,
      stagingRoot,
      sourcesByOutput,
    );
  } else {
    const manifestPath = path.join(sourceRoot, '.kimi-plugin', 'plugin.json');
    const fragmentPath = path.join(
      sourceRoot,
      'hooks',
      '_hosts',
      'kimi-code',
      'hooks.fragment.json',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (fs.existsSync(fragmentPath)) {
      const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
      const hooks = Array.isArray(fragment) ? fragment : fragment.hooks;
      if (!Array.isArray(hooks)) fail('TPT-POLICY-TRANSFORM-INVALID', 'kimi hooks[] missing');
      manifest.hooks = hooks;
    } else delete manifest.hooks;
    const target = path.join(stagingRoot, 'kimi.plugin.json');
    fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
    sourcesByOutput.set(
      'kimi.plugin.json',
      new Set([
        '.kimi-plugin/plugin.json',
        ...(fs.existsSync(fragmentPath)
          ? ['hooks/_hosts/kimi-code/hooks.fragment.json']
          : []),
      ]),
    );
  }

  const commandsRoot = path.join(sourceRoot, 'commands');
  for (const command of fs.readdirSync(commandsRoot).sort(comparePath)) {
    if (command.startsWith('_')) continue;
    const commandRoot = path.join(commandsRoot, command);
    if (!fs.statSync(commandRoot).isDirectory()) continue;
    const strategy = path.join(commandRoot, 'adapters', host, 'strategy.yaml');
    const mode = readStrategyMode(strategy);
    if (mode !== 'host_native') continue;
    const source = path.join(commandRoot, 'adapters', host, readYamlString(strategy, 'source'));
    const targetRel = readYamlString(strategy, 'target');
    copyTracked(source, path.join(stagingRoot, targetRel), sourceRoot, stagingRoot, sourcesByOutput);
    sourcesByOutput.get(targetRel).add(
      path.relative(sourceRoot, strategy).split(path.sep).join('/'),
    );
  }

  const adaptersRoot = path.join(sourceRoot, 'adapters');
  for (const capability of fs.readdirSync(adaptersRoot).sort(comparePath)) {
    if (capability.startsWith('_') || capability === 'AGENTS.md') continue;
    const capabilityRoot = path.join(adaptersRoot, capability);
    if (!fs.statSync(capabilityRoot).isDirectory()) continue;
    const hostRoot = path.join(capabilityRoot, 'adapters', host);
    const strategy = path.join(hostRoot, 'strategy.yaml');
    if (readStrategyMode(strategy) !== 'host_native') continue;
    const source = path.join(hostRoot, readYamlString(strategy, 'source'));
    const targetRel = readYamlString(strategy, 'target');
    copyTracked(source, path.join(stagingRoot, targetRel), sourceRoot, stagingRoot, sourcesByOutput);
    sourcesByOutput.get(targetRel).add(
      path.relative(sourceRoot, strategy).split(path.sep).join('/'),
    );
  }

  if (host === 'cursor') {
    const rules = path.join(sourceRoot, 'rules', 'cursor');
    if (fs.existsSync(rules)) {
      copyDirTracked(
        rules,
        path.join(stagingRoot, 'rules'),
        sourceRoot,
        stagingRoot,
        sourcesByOutput,
      );
    }
  }

  const hooksRoot = path.join(sourceRoot, 'hooks');
  const hooksTarget = path.join(stagingRoot, 'hooks');
  const hostHooks = path.join(hooksRoot, '_hosts', host);
  if (host !== 'kimi-code') {
    copyTracked(
      path.join(hostHooks, 'hooks.json'),
      path.join(hooksTarget, 'hooks.json'),
      sourceRoot,
      stagingRoot,
      sourcesByOutput,
    );
  }
  if (host === 'codex' || host === 'cursor' || host === 'kimi-code') {
    if (fs.existsSync(hostHooks)) {
      for (const entry of fs.readdirSync(hostHooks, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
        copyTracked(
          path.join(hostHooks, entry.name),
          path.join(hooksTarget, '_hosts', host, entry.name),
          sourceRoot,
          stagingRoot,
          sourcesByOutput,
        );
      }
    }
  }
  const shared = path.join(hooksRoot, '_shared');
  if (fs.existsSync(shared)) {
    for (const entry of fs.readdirSync(shared, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      copyTracked(
        path.join(shared, entry.name),
        path.join(hooksTarget, '_shared', entry.name),
        sourceRoot,
        stagingRoot,
        sourcesByOutput,
      );
    }
  }
  for (const hook of fs.readdirSync(hooksRoot).sort(comparePath)) {
    if (hook.startsWith('_') || hook === 'AGENTS.md' || hook === 'CLAUDE.md') continue;
    const implementation = path.join(hooksRoot, hook, 'implementations', host);
    if (!fs.existsSync(implementation)) continue;
    for (const entry of fs.readdirSync(implementation, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === 'meta.yaml') continue;
      const target =
        host === 'claude-code'
          ? path.join(hooksTarget, 'scripts', entry.name)
          : path.join(hooksTarget, hook, 'implementations', host, entry.name);
      copyTracked(
        path.join(implementation, entry.name),
        target,
        sourceRoot,
        stagingRoot,
        sourcesByOutput,
      );
    }
  }
}

function projectRepositorySkills({
  repoRoot,
  sourceRoot,
  host,
  stagingRoot,
  sourcesByOutput,
}) {
  const skillsRoot = path.join(sourceRoot, 'skills');
  for (const skill of fs.readdirSync(skillsRoot).sort(comparePath)) {
    if (skill.startsWith('_')) continue;
    const skillRoot = path.join(skillsRoot, skill);
    if (!fs.statSync(skillRoot).isDirectory()) continue;
    const plan = planSkillProjection({ repoRoot, host, skill });
    if (plan.mode === 'planned') continue;
    const target = path.join(stagingRoot, 'skills', skill);
    applySkillProjection(plan, target);
    const strategyRef = path.relative(sourceRoot, plan.strategy).split(path.sep).join('/');
    for (const file of walkRegularFiles(target)) {
      const output = path.relative(stagingRoot, file.absolute).split(path.sep).join('/');
      const relative = path.relative(target, file.absolute);
      const candidates =
        plan.mode === 'unsupported_stub'
          ? [path.join(skillRoot, 'adapters', host, 'stub', relative)]
          : [
              path.join(plan.canonical, relative),
              path.join(skillRoot, 'adapters', host, 'partial', relative),
            ];
      const source = candidates.find((candidate) => fs.existsSync(candidate));
      const refs = new Set([strategyRef]);
      if (source) refs.add(path.relative(sourceRoot, source).split(path.sep).join('/'));
      sourcesByOutput.set(output, refs);
    }
  }
}

function sourceRefFromEntry(frozen, portable) {
  const entry = frozen.get(portable);
  if (!entry) fail('TPT-POLICY-SOURCE-DRIFT', `projection referenced non-frozen ${portable}`);
  return {
    path: portable,
    sha256: entry.sha256,
    size: entry.size,
    posix_mode: entry.posix_mode,
  };
}

function repositoryOutputs({
  host,
  stagingRoot,
  frozen,
  sourcesByOutput,
  overlayArtifacts,
  sourceSnapshot,
}) {
  return walkRegularFiles(stagingRoot).map((file) => {
    const logical = `plugin/dist/${host}/${file.path}`;
    const overlay = overlayArtifacts.get(logical);
    const bytes = overlay === undefined
      ? fs.readFileSync(file.absolute)
      : Buffer.from(overlay.endsWith('\n') ? overlay : `${overlay}\n`, 'utf8');
    const refs = [...(sourcesByOutput.get(file.path) ?? [])]
      .filter((portable) => !isKnowledgePath(portable))
      .sort(comparePath);
    if (refs.length === 0) {
      fail('TPT-POLICY-DECLARATION-INVALID', `no reviewed source refs for ${host}/${file.path}`);
    }
    const transform = {
      id: 'repository-source-projection/v1',
      parameters: {
        host,
        source_snapshot_id: sourceSnapshot.source_snapshot_id,
        output: file.path,
        overlay: overlay !== undefined,
      },
    };
    REPOSITORY_TRANSFORM_IDENTITIES.set(transform, {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      posix_mode: file.stat.mode & 0o7777,
    });
    return {
      path: file.path,
      kind: 'file',
      producer: overlay === undefined ? 'repository.projection' : 'repository.overlay',
      source_refs: refs.map((portable) => sourceRefFromEntry(frozen, portable)),
      transform,
    };
  });
}

/**
 * Build the reviewed, exact current repository policy declaration from frozen
 * plugin/src only. Scratch materialization is private planner state outside
 * plugin/dist; it is never a compiler candidate and is removed before return.
 * Runtime knowledge/ is intentionally excluded from the policy output.
 */
export function buildRepositoryReviewedStrategies({ repoRoot, sourceSnapshot }) {
  const root = path.resolve(repoRoot);
  const { src: sourceRoot, frozen } = assertFrozenRepositorySource(root, sourceSnapshot);
  const built = buildAndValidateGraph({ repoRoot: root, sourceRoot: 'plugin/src/knowledge' });
  if (!built.ok || !built.graph) {
    fail('TPT-POLICY-TRANSFORM-INVALID', 'authored graph cannot reproduce runtime overlays');
  }
  const { plan: coveragePlan } = resolveHostCoveragePlan(built.graph);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-master-tpt-policy-'));
  try {
    const hosts = {};
    for (const host of PRODUCT_HOSTS) {
      const stagingRoot = path.join(temporaryRoot, host);
      fs.mkdirSync(stagingRoot);
      const sourcesByOutput = new Map();
      projectRepositoryNonSkills({
        sourceRoot,
        host,
        stagingRoot,
        sourcesByOutput,
      });
      projectRepositorySkills({
        repoRoot: root,
        sourceRoot,
        host,
        stagingRoot,
        sourcesByOutput,
      });
      const hostCoverage = coveragePlan[host] ?? { mode: 'unsupported', moduleIds: [] };
      const graph =
        hostCoverage.mode === 'full'
          ? built.graph
          : projectCoverageSubgraph(built.graph, hostCoverage.moduleIds ?? [], { host });
      const compiled = buildHostArtifacts({
        host,
        graph,
        repoRoot: root,
        hostDistAbsolute: stagingRoot,
      });
      const errors = compiled.diagnostics.filter((item) => item.severity === 'error');
      if (errors.length > 0) {
        fail('TPT-POLICY-TRANSFORM-INVALID', `overlay reproduction failed for ${host}`, {
          diagnostics: errors.map((item) => item.code),
        });
      }
      const hostOutputs = repositoryOutputs({
        host,
        stagingRoot,
        frozen,
        sourcesByOutput,
        overlayArtifacts: materializeRuntimeArtifacts(compiled.artifacts, { host }),
        sourceSnapshot,
      });
      const skillsOutputs = hostOutputs
        .filter((output) => output.path.startsWith('skills/'))
        .map((output) => output);
      hosts[host] = { host_outputs: hostOutputs, skills_outputs: skillsOutputs };
    }
    return Object.freeze({
      schema: REVIEWED_STRATEGIES_SCHEMA,
      policy_id: 'policy.cc-master-repository-projection-v1',
      directory_mode: 0o755,
      scope: {
        required_source_paths: [
          '.claude-plugin/plugin.json',
          '.codex-plugin/plugin.json',
          '.cursor-plugin/plugin.json',
          '.kimi-plugin/plugin.json',
        ],
        skills_safe_prefixes: ['skills/'],
        cross_surface_prefixes: ['commands/', 'hooks/', 'adapters/', 'knowledge/'],
        cross_surface_action: 'expand',
      },
      hosts,
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
