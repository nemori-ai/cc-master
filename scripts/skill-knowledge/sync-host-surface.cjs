/**
 * Whole-host orchestration for sync-plugin-dist full surface.
 *
 * Owns: path integrity → sibling host staging → closed-set projection
 * (manifest/commands/adapters/skills+overlay+entry pins/hooks/rules) →
 * candidate-root compile → runtime attestation → publishHostTree.
 *
 * Outer catch cleans ONLY this orchestration's staging.
 * Backup create / restore / post-commit cleanup belong solely to publishHostTree.
 *
 * `stamp` is an explicit internal parameter (tests inject deterministic values).
 * Optional `injectLateFault` is a dev-test-only seam after staging is fully built
 * (including compile) and before publish — production sync never passes it.
 * Optional `injectPostPublishFault` runs after a successful publishHostTree and
 * must throw so callers can observe residual live dist with a non-zero sync.
 * `attestationMode: 'candidate-v2'` enables dual-manifest candidate attestation
 * (exact accepted_sap + trusted expected-final rebuild). Marker/overlay-normalized
 * bypasses are intentionally absent.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  assertPacingRenderedArtifact,
  assertPacingRuntimeTree,
} = require('../pacing-read-only-attestation.cjs');
const {
  assertProviderGuidanceAcceptedSap,
  assertProviderGuidanceRuntimeTree,
  loadProviderGuidanceRegistry,
} = require('../provider-guidance-attestation.cjs');
const {
  applyFinalSkillOverlay,
  applySkillProjection,
  copyDir,
  copyFileWithMode,
  planSkillProjection,
  readStrategyMode,
  readYamlString,
  requireDir,
} = require('../project-skill.cjs');
const { publishHostTree } = require('./publish-host-tree.cjs');

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function tryRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function isInsideRoot(candidate, root) {
  const candidateResolved = path.resolve(candidate);
  const rootResolved = path.resolve(root);
  return (
    candidateResolved === rootResolved ||
    candidateResolved.startsWith(`${rootResolved}${path.sep}`)
  );
}

function rmNoFollow(targetAbsolute, containmentRoot) {
  const absolute = path.resolve(targetAbsolute);
  const root = path.resolve(containmentRoot);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`refusing to remove ${absolute} outside ${root}`);
  }
  const stat = lstatOrNull(absolute);
  if (!stat) return;
  if (stat.isSymbolicLink() || stat.isFile()) {
    fs.unlinkSync(absolute);
    return;
  }
  if (!stat.isDirectory()) {
    fs.unlinkSync(absolute);
    return;
  }
  for (const name of fs.readdirSync(absolute)) {
    rmNoFollow(path.join(absolute, name), root);
  }
  fs.rmdirSync(absolute);
}

function assertSafeStamp(stamp) {
  if (!stamp || /[\\/]/.test(String(stamp))) {
    throw new Error(`invalid host publish stamp: ${JSON.stringify(stamp)}`);
  }
  return String(stamp);
}

/**
 * Fail closed before any mkdir/rm/cp: repo→plugin→dist (and live host if present)
 * must be real directories with no symlink segments. Live host symlink → refuse
 * immediately without touching external content.
 *
 * Creates ordinary `plugin/dist` when missing (never through a symlink ancestor).
 */
function assertHostDistPathIntegrity(repoRoot, host) {
  const root = path.resolve(repoRoot);
  const repoStat = lstatOrNull(root);
  if (!repoStat || repoStat.isSymbolicLink() || !repoStat.isDirectory()) {
    throw new Error(`repo root must be a real directory (no symlink): ${root}`);
  }
  const repoReal = tryRealpath(root);
  if (!repoReal) {
    throw new Error(`repo root realpath unavailable: ${root}`);
  }

  const pluginAbsolute = path.join(root, 'plugin');
  const pluginStat = lstatOrNull(pluginAbsolute);
  if (!pluginStat || pluginStat.isSymbolicLink() || !pluginStat.isDirectory()) {
    throw new Error(
      `plugin/ must be a real directory (no symlink): ${pluginAbsolute}`,
    );
  }
  const pluginReal = tryRealpath(pluginAbsolute);
  if (!pluginReal || !isInsideRoot(pluginReal, repoReal)) {
    throw new Error(`plugin/ realpath escapes repo: ${pluginAbsolute}`);
  }

  const distAbsolute = path.join(pluginAbsolute, 'dist');
  let distStat = lstatOrNull(distAbsolute);
  if (!distStat) {
    fs.mkdirSync(distAbsolute);
    distStat = lstatOrNull(distAbsolute);
  }
  if (!distStat || distStat.isSymbolicLink() || !distStat.isDirectory()) {
    throw new Error(
      `plugin/dist must be a real directory (no symlink): ${distAbsolute}`,
    );
  }
  const distReal = tryRealpath(distAbsolute);
  if (!distReal || !isInsideRoot(distReal, repoReal)) {
    throw new Error(`plugin/dist realpath escapes repo: ${distAbsolute}`);
  }

  const live = path.join(distAbsolute, host);
  const liveStat = lstatOrNull(live);
  if (liveStat) {
    if (liveStat.isSymbolicLink()) {
      throw new Error(
        `refusing live host that is a symlink (external sentinel must stay untouched): ${live}`,
      );
    }
    if (!liveStat.isDirectory()) {
      throw new Error(`live host must be a real directory: ${live}`);
    }
    const liveReal = tryRealpath(live);
    if (!liveReal || !isInsideRoot(liveReal, repoReal)) {
      throw new Error(`live host realpath escapes repo: ${live}`);
    }
  }

  return {
    repoAbsolute: root,
    repoReal,
    distParentAbsolute: distAbsolute,
    liveAbsolute: live,
    liveExists: Boolean(liveStat),
  };
}

function applySkillsScopedEntryPinsBridge({ repoRoot, host, stagingRoot, skillsTree }) {
  const script = path.join(repoRoot, 'scripts/skill-knowledge/apply-final-skill-overlay.mjs');
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--repo-root',
      repoRoot,
      '--host',
      host,
      '--entry-pins-only',
      '--staging-root',
      stagingRoot,
      '--skills-tree',
      skillsTree,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `skills-scoped entry pins failed for ${host}: ${result.stderr || result.stdout || `exit ${result.status}`}`,
    );
  }
  let parsed;
  try {
    const { parseStructuredJsonStdout } = require('./json-framing.cjs');
    parsed = parseStructuredJsonStdout(result.stdout, {
      label: `skills-scoped entry pins (${host})`,
    });
  } catch (error) {
    throw new Error(
      `skills-scoped entry pins returned non-JSON for ${host}: ${error.message}; stdout=${result.stdout}`,
    );
  }
  if (!parsed || parsed.ok !== true) {
    throw new Error(`skills-scoped entry pins refused for ${host}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function compileIntoCandidate({ repoRoot, host, candidateRoot }) {
  const script = path.join(repoRoot, 'scripts/skill-knowledge/compile-candidate-host.mjs');
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--repo-root',
      repoRoot,
      '--host',
      host,
      '--candidate-root',
      candidateRoot,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    let compileBody = null;
    try {
      const { parseStructuredJsonStdout } = require('./json-framing.cjs');
      compileBody = parseStructuredJsonStdout(result.stdout || result.stderr || '', {
        label: `candidate-root compile (${host})`,
      });
    } catch {
      compileBody = null;
    }
    const nestedDiagnostics = [];
    if (compileBody && typeof compileBody === 'object') {
      for (const item of compileBody.diagnostics ?? []) {
        if (item && item.severity === 'error') nestedDiagnostics.push(item);
      }
      for (const hostResult of compileBody.host_results ?? []) {
        for (const item of hostResult.diagnostics ?? []) {
          if (item && item.severity === 'error') nestedDiagnostics.push(item);
        }
      }
    }
    const error = new Error(
      nestedDiagnostics.length > 0
        ? `candidate-root compile failed for ${host}`
        : `candidate-root compile failed for ${host}: ${result.stderr || result.stdout || `exit ${result.status}`}`,
    );
    error.code = 'SKG-CHANGE-CANDIDATE-RUNTIME';
    error.sync_envelope = {
      schema: 'cc-master/skill-knowledge-sync/v1alpha1',
      ok: false,
      host,
      phase: 'candidate_compile',
      exit_status: result.status,
      compile_ok: compileBody?.ok ?? false,
      graph_hash: compileBody?.graph_hash ?? null,
    };
    error.compile_diagnostics = nestedDiagnostics;
    error.compile_body = compileBody;
    throw error;
  }
  return result;
}

function resolveAttestationMode(attestationMode) {
  if (attestationMode === 'candidate-v2' || attestationMode === 'accepted') {
    return attestationMode;
  }
  if (process.env.SKG_CANDIDATE_RUNTIME_ATTESTATION === 'candidate-v2') {
    return 'candidate-v2';
  }
  return 'accepted';
}

function attestProjectedSkillTree({
  plan,
  projectionTarget,
  repoRoot,
  attestationMode,
}) {
  if (plan.providerGuidanceContract) {
    const registry = loadProviderGuidanceRegistry(plan.providerGuidanceRegistryPath, repoRoot);
    if (attestationMode === 'candidate-v2') {
      // Final trusted compare happens after overlays via candidate-attestation bridge.
      // Here only accepted_sap is checked when called on raw SAP (see projectSkillsIntoStaging).
      assertProviderGuidanceAcceptedSap(
        registry,
        plan.providerGuidanceContract.host,
        plan.providerGuidanceContract.skill,
        projectionTarget,
      );
    } else {
      assertProviderGuidanceRuntimeTree(
        registry,
        plan.providerGuidanceContract.host,
        plan.providerGuidanceContract.skill,
        projectionTarget,
      );
    }
  }
  if (plan.readOnlyContract) {
    assertPacingRenderedArtifact(
      plan.pacingRegistry,
      plan.readOnlyContract.host,
      plan.pacingRenderedBody,
    );
    assertPacingRuntimeTree(plan.pacingRegistry, plan.readOnlyContract.host, projectionTarget);
  }
}

function runCandidateGuidanceAttestationBridge({
  repoRoot,
  host,
  skillsStaging,
  stagingRoot,
  registryPath,
  graphSha256,
}) {
  const script = path.join(repoRoot, 'scripts/skill-knowledge/candidate-attestation.mjs');
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--repo-root',
      repoRoot,
      '--host',
      host,
      '--skills-staging',
      skillsStaging,
      '--staging-root',
      stagingRoot,
      '--registry',
      registryPath,
      '--graph-sha256',
      graphSha256,
    ],
    { encoding: 'utf8' },
  );
  let parsed;
  try {
    const { parseStructuredJsonStdout } = require('./json-framing.cjs');
    parsed = parseStructuredJsonStdout(result.stdout, {
      label: `candidate attestation (${host})`,
    });
  } catch (error) {
    throw Object.assign(
      new Error(
        `candidate attestation bridge non-JSON for ${host}: ${error.message}; ${result.stderr || result.stdout}`,
      ),
      { code: 'SKG-CHANGE-CANDIDATE-ATTESTATION' },
    );
  }
  if (result.status !== 0 || !parsed?.ok) {
    throw Object.assign(
      new Error(parsed?.message || `candidate attestation failed for ${host}`),
      { code: parsed?.code || 'SKG-CHANGE-CANDIDATE-ATTESTATION', sync_envelope: parsed },
    );
  }
  return parsed;
}

function projectSkillsIntoStaging({
  repoRoot,
  host,
  stagingAbsolute,
  attestationMode = 'accepted',
}) {
  const mode = resolveAttestationMode(attestationMode);
  const skillsSrc = path.join(repoRoot, 'plugin/src/skills');
  const skillsStaging = path.join(stagingAbsolute, 'skills');
  requireDir(skillsSrc);
  fs.mkdirSync(skillsStaging, { recursive: true });

  for (const skill of fs.readdirSync(skillsSrc).sort()) {
    if (skill.startsWith('_')) continue;
    if (!fs.statSync(path.join(skillsSrc, skill)).isDirectory()) continue;
    const plan = planSkillProjection({ repoRoot, host, skill });
    if (plan.mode === 'planned') continue;
    const projectionTarget = path.join(skillsStaging, skill);
    applySkillProjection(plan, projectionTarget);
    if (mode === 'candidate-v2' && plan.providerGuidanceContract) {
      const registry = loadProviderGuidanceRegistry(plan.providerGuidanceRegistryPath, repoRoot);
      assertProviderGuidanceAcceptedSap(
        registry,
        plan.providerGuidanceContract.host,
        plan.providerGuidanceContract.skill,
        projectionTarget,
      );
    }
    applyFinalSkillOverlay({
      repoRoot,
      host,
      skill,
      skillTree: projectionTarget,
      stagingRoot: stagingAbsolute,
    });
    if (mode === 'accepted') {
      attestProjectedSkillTree({
        plan,
        projectionTarget,
        repoRoot,
        attestationMode: mode,
      });
    } else if (plan.readOnlyContract) {
      assertPacingRenderedArtifact(
        plan.pacingRegistry,
        plan.readOnlyContract.host,
        plan.pacingRenderedBody,
      );
      assertPacingRuntimeTree(plan.pacingRegistry, plan.readOnlyContract.host, projectionTarget);
    }
  }

  // Codex (and any future skill_entry host): entry pins whose targets are under skills/.
  applySkillsScopedEntryPinsBridge({
    repoRoot,
    host,
    stagingRoot: stagingAbsolute,
    skillsTree: skillsStaging,
  });
}

function projectNonSkillSurfaces({ repoRoot, host, stagingAbsolute }) {
  const src = path.join(repoRoot, 'plugin/src');

  // Manifest directories / kimi root manifest.
  if (host === 'codex') {
    const d = '.codex-plugin';
    requireDir(path.join(src, d));
    copyDir(path.join(src, d), path.join(stagingAbsolute, d));
  } else if (host === 'cursor') {
    const d = '.cursor-plugin';
    requireDir(path.join(src, d));
    copyDir(path.join(src, d), path.join(stagingAbsolute, d));
  } else if (host === 'kimi-code') {
    const manifestSrc = path.join(src, '.kimi-plugin', 'plugin.json');
    if (!fs.existsSync(manifestSrc)) throw new Error(`missing ${manifestSrc}`);
    const manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
    const fragmentPath = path.join(src, 'hooks', '_hosts', 'kimi-code', 'hooks.fragment.json');
    if (fs.existsSync(fragmentPath)) {
      const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
      const hooks = Array.isArray(fragment) ? fragment : fragment.hooks;
      if (!Array.isArray(hooks)) {
        throw new Error(
          `kimi hooks fragment ${fragmentPath} must be a hooks[] array or {hooks:[...]}`,
        );
      }
      manifest.hooks = hooks;
    } else {
      console.warn(
        `sync-plugin-dist: kimi-code hooks fragment ${fragmentPath} missing (K4 not landed); manifest hooks[] omitted`,
      );
      delete manifest.hooks;
    }
    fs.writeFileSync(
      path.join(stagingAbsolute, 'kimi.plugin.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } else {
    const d = '.claude-plugin';
    requireDir(path.join(src, d));
    copyDir(path.join(src, d), path.join(stagingAbsolute, d));
  }

  // Commands.
  const commandsSrc = path.join(src, 'commands');
  const commandsDst = path.join(stagingAbsolute, 'commands');
  const commandsHost = path.join(commandsSrc, '_hosts', host, 'strategy.yaml');
  const commandsManifest = path.join(commandsSrc, '_manifest', 'commands.yaml');
  requireDir(commandsSrc);
  if (!fs.existsSync(commandsHost)) throw new Error(`missing ${commandsHost}`);
  if (!fs.existsSync(commandsManifest)) throw new Error(`missing ${commandsManifest}`);
  fs.mkdirSync(commandsDst, { recursive: true });
  for (const command of fs.readdirSync(commandsSrc).sort()) {
    if (command.startsWith('_')) continue;
    const commandDir = path.join(commandsSrc, command);
    if (!fs.statSync(commandDir).isDirectory()) continue;
    const strategy = path.join(commandDir, 'adapters', host, 'strategy.yaml');
    if (!fs.existsSync(strategy)) throw new Error(`missing ${strategy}`);
    const mode = readStrategyMode(strategy);
    if (mode === 'unsupported' || mode === 'adapter_guidance' || mode === 'planned') continue;
    if (mode !== 'host_native') {
      throw new Error(`unsupported command projection mode "${mode}" in ${strategy}`);
    }
    const sourceRel = readYamlString(strategy, 'source');
    const targetRel = readYamlString(strategy, 'target');
    if (!sourceRel || !targetRel) {
      throw new Error(`missing projection.source or projection.target in ${strategy}`);
    }
    const sourcePath = path.join(commandDir, 'adapters', host, sourceRel);
    const targetPath = path.join(stagingAbsolute, targetRel);
    if (!fs.existsSync(sourcePath)) throw new Error(`missing ${sourcePath}`);
    copyFileWithMode(sourcePath, targetPath);
  }

  // Origin capability adapters.
  const adaptersSrc = path.join(src, 'adapters');
  if (fs.existsSync(adaptersSrc)) {
    for (const capability of fs.readdirSync(adaptersSrc).sort()) {
      if (capability === 'AGENTS.md' || capability.startsWith('_')) continue;
      const capabilityDir = path.join(adaptersSrc, capability);
      if (!fs.statSync(capabilityDir).isDirectory()) continue;
      const hostDir = path.join(capabilityDir, 'adapters', host);
      const strategy = path.join(hostDir, 'strategy.yaml');
      if (!fs.existsSync(strategy)) throw new Error(`missing ${strategy}`);
      const mode = readStrategyMode(strategy);
      if (mode === 'unsupported') continue;
      if (mode !== 'host_native') {
        throw new Error(`unsupported origin adapter projection mode "${mode}" in ${strategy}`);
      }
      const sourceRel = readYamlString(strategy, 'source');
      const targetRel = readYamlString(strategy, 'target');
      if (!sourceRel || !targetRel) {
        throw new Error(`missing projection.source or projection.target in ${strategy}`);
      }
      const sourcePath = path.join(hostDir, sourceRel);
      const targetPath = path.join(stagingAbsolute, targetRel);
      if (!fs.existsSync(sourcePath)) throw new Error(`missing ${sourcePath}`);
      copyFileWithMode(sourcePath, targetPath);
    }
  }

  // Cursor rules.
  if (host === 'cursor') {
    const rulesSrc = path.join(src, 'rules', 'cursor');
    const rulesDst = path.join(stagingAbsolute, 'rules');
    if (fs.existsSync(rulesSrc)) {
      copyDir(rulesSrc, rulesDst);
    }
  }

  // PHIP hooks.
  const hooksSrc = path.join(src, 'hooks');
  const hooksDst = path.join(stagingAbsolute, 'hooks');
  const hooksHost = path.join(hooksSrc, '_hosts', host);

  function copyHookShared() {
    const hookShared = path.join(hooksSrc, '_shared');
    if (!fs.existsSync(hookShared)) return;
    for (const entry of fs.readdirSync(hookShared, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      copyFileWithMode(
        path.join(hookShared, entry.name),
        path.join(hooksDst, '_shared', entry.name),
      );
    }
  }

  if (host === 'kimi-code') {
    if (!fs.existsSync(hooksHost)) {
      console.warn(
        `sync-plugin-dist: kimi-code hooks host ${hooksHost} missing (K4 not landed); skipping hook projection`,
      );
    } else {
      fs.mkdirSync(hooksDst, { recursive: true });
      const launcher = path.join(hooksHost, 'launcher.js');
      if (fs.existsSync(launcher)) {
        copyFileWithMode(launcher, path.join(hooksDst, '_hosts', host, 'launcher.js'));
      } else {
        console.warn(
          `sync-plugin-dist: kimi-code launcher ${launcher} missing (K4 not landed); skipping launcher`,
        );
      }
      copyHookShared();
      for (const hook of fs.readdirSync(hooksSrc).sort()) {
        if (hook.startsWith('_') || hook === 'AGENTS.md' || hook === 'CLAUDE.md') continue;
        const implDir = path.join(hooksSrc, hook, 'implementations', host);
        if (!fs.existsSync(implDir)) continue;
        for (const entry of fs.readdirSync(implDir, { withFileTypes: true })) {
          if (!entry.isFile() || entry.name === 'meta.yaml') continue;
          copyFileWithMode(
            path.join(implDir, entry.name),
            path.join(hooksDst, hook, 'implementations', host, entry.name),
          );
        }
      }
    }
  } else {
    const hookRegistration = path.join(hooksHost, 'hooks.json');
    if (!fs.existsSync(hookRegistration)) throw new Error(`missing ${hookRegistration}`);
    if (host === 'claude-code') fs.mkdirSync(path.join(hooksDst, 'scripts'), { recursive: true });
    else fs.mkdirSync(hooksDst, { recursive: true });
    fs.copyFileSync(hookRegistration, path.join(hooksDst, 'hooks.json'));

    if (host === 'codex' || host === 'cursor') {
      const launcher = path.join(hooksHost, 'launcher.js');
      if (!fs.existsSync(launcher)) throw new Error(`missing ${launcher}`);
      for (const entry of fs.readdirSync(hooksHost, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
        copyFileWithMode(
          path.join(hooksHost, entry.name),
          path.join(hooksDst, '_hosts', host, entry.name),
        );
      }
    }
    copyHookShared();
    for (const hook of fs.readdirSync(hooksSrc).sort()) {
      if (hook.startsWith('_') || hook === 'AGENTS.md' || hook === 'CLAUDE.md') continue;
      const implDir = path.join(hooksSrc, hook, 'implementations', host);
      if (!fs.existsSync(implDir)) continue;
      for (const entry of fs.readdirSync(implDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (entry.name === 'meta.yaml') continue;
        const sourcePath = path.join(implDir, entry.name);
        const targetPath =
          host === 'codex' || host === 'cursor'
            ? path.join(hooksDst, hook, 'implementations', host, entry.name)
            : path.join(hooksDst, 'scripts', entry.name);
        copyFileWithMode(sourcePath, targetPath);
      }
    }
  }
}

/**
 * Project + compile + attest + atomically publish one full host dist tree.
 */
function projectAndPublishHostSurface({
  repoRoot,
  host,
  stamp: stampInput,
  injectLateFault,
  injectPostPublishFault,
  attestationMode = 'accepted',
  candidateGraphSha256 = null,
  warn = (message) => console.warn(`sync-plugin-dist: ${message}`),
}) {
  const root = path.resolve(repoRoot);
  const stamp = assertSafeStamp(stampInput);
  const mode = resolveAttestationMode(attestationMode);
  const integrity = assertHostDistPathIntegrity(root, host);
  const distParent = integrity.distParentAbsolute;
  const liveAbsolute = integrity.liveAbsolute;
  const stagingAbsolute = path.join(distParent, `${host}.write-${stamp}`);
  const backupAbsolute = path.join(distParent, `${host}.bak-${stamp}`);

  if (lstatOrNull(stagingAbsolute) || lstatOrNull(backupAbsolute)) {
    throw new Error(`host staging/backup collision under ${distParent}`);
  }

  fs.mkdirSync(stagingAbsolute);
  const stagingStat = lstatOrNull(stagingAbsolute);
  if (!stagingStat || stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) {
    throw new Error(`invalid host staging directory ${stagingAbsolute}`);
  }

  try {
    projectNonSkillSurfaces({ repoRoot: root, host, stagingAbsolute });
    projectSkillsIntoStaging({
      repoRoot: root,
      host,
      stagingAbsolute,
      attestationMode: mode,
    });
    compileIntoCandidate({
      repoRoot: root,
      host,
      candidateRoot: stagingAbsolute,
    });

    // Post-compile attestation re-check on final skill trees inside candidate.
    const skillsStaging = path.join(stagingAbsolute, 'skills');
    if (fs.existsSync(skillsStaging)) {
      if (mode === 'candidate-v2') {
        const registryPath = path.join(root, 'plugin/src/skills/provider-guidance-runtime.json');
        if (
          typeof candidateGraphSha256 !== 'string' ||
          !/^[0-9a-f]{64}$/u.test(candidateGraphSha256)
        ) {
          throw Object.assign(
            new Error(
              `candidate-v2 requires explicit candidateGraphSha256 (real graph hash); refused staging-path fallback for ${host}`,
            ),
            { code: 'SKG-CHANGE-CANDIDATE-ATTESTATION' },
          );
        }
        runCandidateGuidanceAttestationBridge({
          repoRoot: root,
          host,
          skillsStaging,
          stagingRoot: stagingAbsolute,
          registryPath,
          graphSha256: candidateGraphSha256,
        });
      }
      for (const skill of fs.readdirSync(skillsStaging).sort()) {
        const projectionTarget = path.join(skillsStaging, skill);
        if (!fs.statSync(projectionTarget).isDirectory()) continue;
        const plan = planSkillProjection({ repoRoot: root, host, skill });
        if (plan.mode === 'planned') continue;
        if (mode === 'accepted' && plan.providerGuidanceContract) {
          const registry = loadProviderGuidanceRegistry(
            plan.providerGuidanceRegistryPath,
            root,
          );
          assertProviderGuidanceRuntimeTree(
            registry,
            plan.providerGuidanceContract.host,
            plan.providerGuidanceContract.skill,
            projectionTarget,
          );
        }
        if (plan.readOnlyContract) {
          assertPacingRuntimeTree(
            plan.pacingRegistry,
            plan.readOnlyContract.host,
            projectionTarget,
          );
        }
      }
    }

    if (typeof injectLateFault === 'function') {
      injectLateFault({
        distParentAbsolute: path.resolve(distParent),
        liveAbsolute: path.resolve(liveAbsolute),
        stagingAbsolute: path.resolve(stagingAbsolute),
        backupAbsolute: path.resolve(backupAbsolute),
        stamp,
      });
    }

    const published = publishHostTree({
      distParentAbsolute: path.resolve(distParent),
      liveAbsolute: path.resolve(liveAbsolute),
      stagingAbsolute: path.resolve(stagingAbsolute),
      host,
      stamp,
      warn,
    });

    if (typeof injectPostPublishFault === 'function') {
      injectPostPublishFault({
        distParentAbsolute: path.resolve(distParent),
        liveAbsolute: path.resolve(liveAbsolute),
        stagingAbsolute: path.resolve(stagingAbsolute),
        backupAbsolute: path.resolve(backupAbsolute),
        stamp,
        published,
      });
      const fault = new Error(
        `injected post-publish fault for ${host} after successful publish (residual live dist present)`,
      );
      fault.code = 'SKG-SYNC-POST-PUBLISH-FAULT';
      fault.sync_envelope = {
        schema: 'cc-master/skill-knowledge-sync/v1alpha1',
        ok: false,
        host,
        phase: 'post_publish',
        residual_live_dist: true,
      };
      throw fault;
    }

    return published;
  } catch (error) {
    if (lstatOrNull(stagingAbsolute)) {
      try {
        rmNoFollow(stagingAbsolute, path.resolve(distParent));
      } catch {
        // leave staging for operator inspection
      }
    }
    throw error;
  }
}

module.exports = {
  assertHostDistPathIntegrity,
  assertSafeStamp,
  projectAndPublishHostSurface,
};
