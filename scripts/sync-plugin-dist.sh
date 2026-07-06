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

if [ "${SURFACE}" = "all" ] && [ "${HOST}" != "claude-code" ] && [ "${HOST}" != "codex" ]; then
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

const src = 'plugin/src';
const host = process.env.SYNC_HOST || 'claude-code';
const surface = process.env.SYNC_SURFACE || 'all';
const dst = `plugin/dist/${host}`;
const SKILL_DIST_EXCLUDES = ['AGENTS.md', 'CLAUDE.md', '.design', 'evals'];

function copyDir(from, to, options = {}) {
  const exclude = new Set(options.exclude || []);
  const replacements = options.replacements || new Map();
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    if (entry.name === '.DS_Store' || entry.name === '.gitkeep') continue;
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath, options);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      if (replacements.size > 0 && entry.name.endsWith('.md')) {
        let text = fs.readFileSync(sourcePath, 'utf8');
        for (const [token, replacement] of replacements.entries()) {
          text = text.split(token).join(replacement);
        }
        const unresolved = text.match(/\{\{[A-Z0-9_]+\}\}/);
        if (unresolved) {
          throw new Error(`unresolved adapter slot ${unresolved[0]} in ${sourcePath}`);
        }
        fs.writeFileSync(targetPath, text);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
      fs.chmodSync(targetPath, fs.statSync(sourcePath).mode);
    }
  }
}

function requireDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`missing ${dir}`);
  }
}

function readStrategyMode(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^\s*mode:\s*([A-Za-z0-9_-]+)\s*$/m);
  return match ? match[1] : 'copy';
}

function readSlotReplacements(file, baseDir) {
  const text = fs.readFileSync(file, 'utf8');
  const replacements = new Map();
  let inSection = false;
  let sectionIndent = 0;
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^(\s*)slot_replacements:\s*$/);
    if (section) {
      inSection = true;
      sectionIndent = section[1].length;
      continue;
    }
    if (!inSection) continue;
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= sectionIndent) break;
    const match = line.match(/^\s*["']?(\{\{[A-Z0-9_]+\}\})["']?\s*:\s*["']?([^"'\n]+)["']?\s*$/);
    if (!match) continue;
    const token = match[1];
    const rel = match[2].trim();
    const replacementPath = path.join(baseDir, rel);
    if (!fs.existsSync(replacementPath)) {
      throw new Error(`missing slot replacement ${replacementPath} for ${token} in ${file}`);
    }
    replacements.set(token, fs.readFileSync(replacementPath, 'utf8').replace(/\s+$/u, ''));
  }
  return replacements;
}

function readYamlString(file, key) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm'));
  return match ? match[1].trim() : null;
}

function readYamlList(file, key) {
  const text = fs.readFileSync(file, 'utf8');
  const values = [];
  let inSection = false;
  let sectionIndent = 0;
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(new RegExp(`^(\\s*)${key}:\\s*$`));
    if (section) {
      inSection = true;
      sectionIndent = section[1].length;
      continue;
    }
    if (!inSection) continue;
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= sectionIndent) break;
    const item = line.match(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/);
    if (!item) continue;
    values.push(item[1].trim());
  }
  return values;
}

function projectText(text, replacements, sourcePath) {
  let projected = text;
  for (const [token, replacement] of replacements.entries()) {
    projected = projected.split(token).join(replacement);
  }
  const unresolved = projected.match(/\{\{[A-Z0-9_]+\}\}/);
  if (unresolved) {
    throw new Error(`unresolved adapter slot ${unresolved[0]} in ${sourcePath}`);
  }
  return projected;
}

function copyFileWithMode(from, to, replacements = new Map()) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (replacements.size > 0 && from.endsWith('.md')) {
    fs.writeFileSync(to, projectText(fs.readFileSync(from, 'utf8'), replacements, from));
  } else {
    fs.copyFileSync(from, to);
  }
  fs.chmodSync(to, fs.statSync(from).mode);
}

function copyCanonicalIncludes(canonical, target, includes, replacements) {
  for (const rel of includes) {
    const sourcePath = path.join(canonical, rel);
    const targetPath = path.join(target, rel);
    if (!fs.existsSync(sourcePath)) throw new Error(`missing include ${sourcePath}`);
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      copyDir(sourcePath, targetPath, {
        exclude: ['AGENTS.md', 'CLAUDE.md'],
        replacements,
      });
    } else if (stat.isFile()) {
      copyFileWithMode(sourcePath, targetPath, replacements);
    } else {
      throw new Error(`unsupported include type ${sourcePath}`);
    }
  }
}

function removeProjectedPaths(target, rels) {
  for (const rel of rels) {
    const targetPath = path.join(target, rel);
    if (!fs.existsSync(targetPath)) continue;
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
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
    if (mode === 'unsupported' || mode === 'adapter_guidance') continue;
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

// SAP: project every skill canonical tree to dist/<host>/skills/<skill>.
const skillsSrc = path.join(src, 'skills');
const skillsDst = path.join(dst, 'skills');
requireDir(skillsSrc);
fs.mkdirSync(skillsDst, { recursive: true });
for (const skill of fs.readdirSync(skillsSrc).sort()) {
  if (skill.startsWith('_')) continue;
  const skillDir = path.join(skillsSrc, skill);
  if (!fs.statSync(skillDir).isDirectory()) continue;
  const canonical = path.join(skillDir, 'canonical');
  const strategy = path.join(skillDir, 'adapters', host, 'strategy.yaml');
  requireDir(canonical);
  if (!fs.existsSync(strategy)) throw new Error(`missing ${strategy}`);
  const mode = readStrategyMode(strategy);
  const slotReplacements = readSlotReplacements(strategy, skillDir);
  const target = path.join(skillsDst, skill);
  if (mode === 'copy') {
    copyDir(canonical, target, {
      exclude: SKILL_DIST_EXCLUDES,
      replacements: slotReplacements,
    });
    removeProjectedPaths(target, readYamlList(strategy, 'exclude_canonical'));
    copyCanonicalIncludes(skillDir, target, readYamlList(strategy, 'include_adapter'), slotReplacements);
  } else if (mode === 'unsupported_stub') {
    const stub = path.join(skillDir, 'adapters', host, 'stub');
    requireDir(stub);
    copyDir(stub, target, {
      exclude: SKILL_DIST_EXCLUDES,
    });
  } else if (mode === 'partial_overlay') {
    const sourceRel = readYamlString(strategy, 'source') || path.join('adapters', host, 'partial');
    const partial = path.join(skillDir, sourceRel);
    requireDir(partial);
    copyDir(partial, target, {
      exclude: SKILL_DIST_EXCLUDES,
    });
    copyCanonicalIncludes(canonical, target, readYamlList(strategy, 'include_canonical'), slotReplacements);
  } else {
    throw new Error(`unsupported projection mode "${mode}" in ${strategy}`);
  }
}

if (surface === 'skills') process.exit(0);

// PHIP: project Claude Code host registration and per-hook native scripts.
const hooksDst = path.join(dst, 'hooks');
const hooksHost = path.join(src, 'hooks', '_hosts', host);
const hookRegistration = path.join(hooksHost, 'hooks.json');
if (!fs.existsSync(hookRegistration)) throw new Error(`missing ${hookRegistration}`);
if (host === 'claude-code') fs.mkdirSync(path.join(hooksDst, 'scripts'), { recursive: true });
else fs.mkdirSync(hooksDst, { recursive: true });
fs.copyFileSync(hookRegistration, path.join(hooksDst, 'hooks.json'));

const hooksSrc = path.join(src, 'hooks');
if (host === 'codex') {
  const launcher = path.join(hooksHost, 'launcher.js');
  if (!fs.existsSync(launcher)) throw new Error(`missing ${launcher}`);
  copyFileWithMode(launcher, path.join(hooksDst, '_hosts', 'codex', 'launcher.js'));
}
for (const hook of fs.readdirSync(hooksSrc).sort()) {
  if (hook.startsWith('_') || hook === 'AGENTS.md' || hook === 'CLAUDE.md') continue;
  const implDir = path.join(hooksSrc, hook, 'implementations', host);
  if (!fs.existsSync(implDir)) continue;
  for (const entry of fs.readdirSync(implDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === 'meta.yaml') continue;
    const sourcePath = path.join(implDir, entry.name);
    const targetPath = host === 'codex'
      ? path.join(hooksDst, hook, 'implementations', host, entry.name)
      : path.join(hooksDst, 'scripts', entry.name);
    copyFileWithMode(sourcePath, targetPath);
  }
}
NODE

echo "sync-plugin-dist: ${SRC} --adapt ${HOST}${SURFACE:+ (${SURFACE})} -> ${DST}"
