#!/usr/bin/env bash
# sync-plugin-dist.sh — project paragoge-style plugin source to adapter dist.
#
# Phase 1 ships only the full Claude Code adapter, but the source shape is the
# full paragoge pattern. Skills can be projected per host before the rest of a
# host adapter is ready.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

SRC="plugin/src"
HOST="claude-code"
SURFACE="all"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      HOST="${2:-}"
      [ -n "${HOST}" ] || { echo "sync-plugin-dist: --host requires a value" >&2; exit 2; }
      shift 2
      ;;
    --skills-only)
      SURFACE="skills"
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/sync-plugin-dist.sh [--host <host>] [--skills-only]

Default:
  Generate the full Claude Code adapter at plugin/dist/claude-code.

Examples:
  bash scripts/sync-plugin-dist.sh
  bash scripts/sync-plugin-dist.sh --host codex --skills-only
EOF
      exit 0
      ;;
    *)
      echo "sync-plugin-dist: unknown argument $1" >&2
      exit 2
      ;;
  esac
done

DST="plugin/dist/${HOST}"

[ -d "${SRC}" ] || { echo "sync-plugin-dist: missing ${SRC}" >&2; exit 1; }

if [ "${SURFACE}" = "all" ] && [ "${HOST}" != "claude-code" ] && [ "${HOST}" != "codex" ] && [ "${HOST}" != "cursor" ] && [ "${HOST}" != "kimi-code" ]; then
  echo "sync-plugin-dist: full adapter generation for ${HOST} is not implemented. Use --skills-only for ${HOST}." >&2
  exit 2
fi

if [ "${SURFACE}" = "all" ]; then
  rm -rf "${DST}"
else
  rm -rf "${DST}/skills"
fi
mkdir -p "${DST}"

if [ "${SURFACE}" = "all" ]; then
  if [ "${HOST}" = "codex" ]; then
    manifest_dirs=".codex-plugin"
  elif [ "${HOST}" = "cursor" ]; then
    manifest_dirs=".cursor-plugin"
  elif [ "${HOST}" = "kimi-code" ]; then
    # kimi manifest is a root file (kimi.plugin.json) synthesized in the node block below
    # from .kimi-plugin/plugin.json plus an inlined hooks[] array; no directory copy.
    manifest_dirs=""
  else
    manifest_dirs=".claude-plugin"
  fi
  for d in ${manifest_dirs}; do
    [ -d "${SRC}/${d}" ] || { echo "sync-plugin-dist: missing ${SRC}/${d}" >&2; exit 1; }
    cp -R "${SRC}/${d}" "${DST}/${d}"
  done
fi

SYNC_HOST="${HOST}" SYNC_SURFACE="${SURFACE}" node <<'NODE'
const fs = require('fs');
const path = require('path');
const {
  assertPacingRenderedArtifact,
  assertPacingRuntimeTree,
} = require('./scripts/pacing-read-only-attestation.cjs');
const {
  assertProviderGuidanceRuntimeTree,
  loadProviderGuidanceRegistry,
} = require('./scripts/provider-guidance-attestation.cjs');
// Skill projection (copy / slot render / stub / overlay + attested pacing-slot render) lives in the
// single SSOT project-skill.cjs, shared with update-*-attestations.cjs so a registry regenerated
// from a fresh canonical projection always matches what sync asserts here (issue #163). The module
// owns the projection; sync owns the attestation asserts + the staging→dist rename below.
const {
  applySkillProjection,
  copyDir,
  copyFileWithMode,
  planSkillProjection,
  readStrategyMode,
  readYamlString,
  requireDir,
} = require('./scripts/project-skill.cjs');

const src = 'plugin/src';
const host = process.env.SYNC_HOST || 'claude-code';
const surface = process.env.SYNC_SURFACE || 'all';
const dst = `plugin/dist/${host}`;

// kimi-code manifest: synthesize root kimi.plugin.json from .kimi-plugin/plugin.json plus an
// inlined hooks[] array read from _hosts/kimi-code/hooks.fragment.json (K4-owned). kimi does not
// use a hooks.json file; hook registration lives inline in the manifest. Tolerate the fragment
// being absent (K4 not yet landed) by omitting the hooks[] key with a warning.
if (surface === 'all' && host === 'kimi-code') {
  const manifestSrc = path.join(src, '.kimi-plugin', 'plugin.json');
  if (!fs.existsSync(manifestSrc)) throw new Error(`missing ${manifestSrc}`);
  const manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
  const fragmentPath = path.join(src, 'hooks', '_hosts', 'kimi-code', 'hooks.fragment.json');
  if (fs.existsSync(fragmentPath)) {
    const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
    const hooks = Array.isArray(fragment) ? fragment : fragment.hooks;
    if (!Array.isArray(hooks)) {
      throw new Error(`kimi hooks fragment ${fragmentPath} must be a hooks[] array or {hooks:[...]}`);
    }
    manifest.hooks = hooks;
  } else {
    console.warn(`sync-plugin-dist: kimi-code hooks fragment ${fragmentPath} missing (K4 not landed); manifest hooks[] omitted`);
    delete manifest.hooks;
  }
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(dst, 'kimi.plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

// Commands: project host-native command bodies through adapter strategies.
if (surface === 'all') {
  const commandsSrc = path.join(src, 'commands');
  const commandsDst = path.join(dst, 'commands');
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
    const targetPath = path.join(dst, targetRel);
    if (!fs.existsSync(sourcePath)) throw new Error(`missing ${sourcePath}`);
    copyFileWithMode(sourcePath, targetPath);
  }
}

// Origin capability adapters: host-native tool invocation mappings only. Each capability must
// declare an explicit per-host strategy; unsupported hosts project no payload.
if (surface === 'all') {
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
      const targetPath = path.join(dst, targetRel);
      if (!fs.existsSync(sourcePath)) throw new Error(`missing ${sourcePath}`);
      copyFileWithMode(sourcePath, targetPath);
    }
  }
}

// SAP: project every skill canonical tree to dist/<host>/skills/<skill>.
// planSkillProjection + applySkillProjection (project-skill.cjs) are the shared projection SSOT;
// sync owns the attestation asserts + the staging→dist rename. An attested skill is projected into
// a scratch staging dir first, asserted against its committed registry, and only renamed into dist
// on a clean assert — so a stale registry can never publish a mismatched tree.
const skillsSrc = path.join(src, 'skills');
const skillsDst = path.join(dst, 'skills');
requireDir(skillsSrc);
fs.mkdirSync(skillsDst, { recursive: true });
for (const skill of fs.readdirSync(skillsSrc).sort()) {
  if (skill.startsWith('_')) continue;
  if (!fs.statSync(path.join(skillsSrc, skill)).isDirectory()) continue;
  const plan = planSkillProjection({ repoRoot: process.cwd(), host, skill });
  if (plan.mode === 'planned') {
    // Phase B: cursor (and future hosts) may declare planned until overlays exist.
    continue;
  }
  const target = path.join(skillsDst, skill);
  const staging = plan.attested
    ? fs.mkdtempSync(path.join(skillsDst, `.${skill}-stage-`))
    : null;
  const projectionTarget = staging || target;
  try {
    applySkillProjection(plan, projectionTarget);
    if (plan.providerGuidanceContract) {
      const registry = loadProviderGuidanceRegistry(
        plan.providerGuidanceRegistryPath,
        process.cwd(),
      );
      assertProviderGuidanceRuntimeTree(
        registry,
        plan.providerGuidanceContract.host,
        plan.providerGuidanceContract.skill,
        projectionTarget,
      );
    }
    if (plan.readOnlyContract) {
      assertPacingRenderedArtifact(
        plan.pacingRegistry,
        plan.readOnlyContract.host,
        plan.pacingRenderedBody,
      );
      assertPacingRuntimeTree(plan.pacingRegistry, plan.readOnlyContract.host, projectionTarget);
    }
    if (plan.attested) {
      if (fs.existsSync(target)) throw new Error(`refusing to replace existing attested target ${target}`);
      fs.renameSync(projectionTarget, target);
    }
  } finally {
    if (staging && fs.existsSync(staging)) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

if (surface === 'skills') process.exit(0);

// Cursor rules (Track B reinject substrate): plugin/src/rules/cursor/ → dist/cursor/rules/
if (host === 'cursor') {
  const rulesSrc = path.join(src, 'rules', 'cursor');
  const rulesDst = path.join(dst, 'rules');
  if (fs.existsSync(rulesSrc)) {
    copyDir(rulesSrc, rulesDst);
  }
}

// PHIP: project host registration and per-hook native scripts.
const hooksSrc = path.join(src, 'hooks');
const hooksDst = path.join(dst, 'hooks');
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
  // kimi registers hooks inline in the manifest (synthesized above from hooks.fragment.json),
  // not via a hooks.json file. Tolerate the kimi hooks host dir being absent (K4 not yet landed):
  // skip hook projection with a warning so the skills/commands/manifest surfaces still generate.
  if (!fs.existsSync(hooksHost)) {
    console.warn(`sync-plugin-dist: kimi-code hooks host ${hooksHost} missing (K4 not landed); skipping hook projection`);
  } else {
    fs.mkdirSync(hooksDst, { recursive: true });
    const launcher = path.join(hooksHost, 'launcher.js');
    if (fs.existsSync(launcher)) {
      copyFileWithMode(launcher, path.join(hooksDst, '_hosts', host, 'launcher.js'));
    } else {
      console.warn(`sync-plugin-dist: kimi-code launcher ${launcher} missing (K4 not landed); skipping launcher`);
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
  // Claude Code / Codex / Cursor register hooks via a hooks.json file.
  const hookRegistration = path.join(hooksHost, 'hooks.json');
  if (!fs.existsSync(hookRegistration)) throw new Error(`missing ${hookRegistration}`);
  if (host === 'claude-code') fs.mkdirSync(path.join(hooksDst, 'scripts'), { recursive: true });
  else fs.mkdirSync(hooksDst, { recursive: true });
  fs.copyFileSync(hookRegistration, path.join(hooksDst, 'hooks.json'));

  if (host === 'codex' || host === 'cursor') {
    const launcher = path.join(hooksHost, 'launcher.js');
    if (!fs.existsSync(launcher)) throw new Error(`missing ${launcher}`);
    copyFileWithMode(launcher, path.join(hooksDst, '_hosts', host, 'launcher.js'));
  }
  // PHIP runtime helpers are host-neutral implementation code. Maintainer prose in _shared stays
  // source-only; only JS helpers cross the projection boundary.
  copyHookShared();
  for (const hook of fs.readdirSync(hooksSrc).sort()) {
    if (hook.startsWith('_') || hook === 'AGENTS.md' || hook === 'CLAUDE.md') continue;
    const implDir = path.join(hooksSrc, hook, 'implementations', host);
    if (!fs.existsSync(implDir)) continue;
    for (const entry of fs.readdirSync(implDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (entry.name === 'meta.yaml') continue;
      const sourcePath = path.join(implDir, entry.name);
      const targetPath = (host === 'codex' || host === 'cursor')
        ? path.join(hooksDst, hook, 'implementations', host, entry.name)
        : path.join(hooksDst, 'scripts', entry.name);
      copyFileWithMode(sourcePath, targetPath);
    }
  }
}
NODE

echo "sync-plugin-dist: ${SRC} --adapt ${HOST}${SURFACE:+ (${SURFACE})} -> ${DST}"
