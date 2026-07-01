#!/usr/bin/env bash
# glossary-lint.sh — out-of-band static terminology-drift lint for cc-master.
#
# Reads the "禁用变体（lint 卡）" column of design_docs/glossary.md (the dev-side
# terminology SSOT), then greps the distributed tree (skills/ commands/ hooks/) +
# dev docs (AGENTS.md adrs/ .claude/skills/) for every banned variant. A hit means
# a承重 term drifted from its canonical spelling — the script prints the offending
# file:line + which banned variant + its canonical form, and exits non-zero.
#
# It is a CHECKER, not a fixer — it never edits any file.
#
# The glossary is dev-side single-copy (NOT distributed): design_docs/ is not in the
# plugin zip, but this lint *checks* distributed files. AGENTS.md §12 self-contain only
# forbids "a distributed file *referencing* a non-distributed dir", not "a dev-lint
# *checking* distributed files" — so one dev-side glossary suffices, zero dead links.
#
# Why node, not bash+jq/python: the repo's content tests are node-based, and node is
# guaranteed present in any Claude Code host (AGENTS.md §3 红线1 / ADR-006). This
# script lives in scripts/ (out-of-band, dev-only, repo-root-invoked) — never in hooks/.
#
# Excludes: .claude/worktrees/ (isolated agent worktrees) and glossary.md itself
# (its 禁用变体 column literally contains every banned variant by design).
#
# Usage:  scripts/glossary-lint.sh
# Exit:   0 = clean, 1 = at least one drift hit (or a setup error).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

command -v node >/dev/null 2>&1 || {
  echo "node not found on PATH — required (Claude Code hosts ship node; ADR-006)" >&2
  exit 1
}

REPO="$REPO" node - "$@" <<'NODE'
'use strict';
const { readFileSync, readdirSync, existsSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const ROOT = process.env.REPO;
const GLOSSARY_REL = 'design_docs/glossary.md';
const GLOSSARY_ABS = join(ROOT, GLOSSARY_REL);

// Scan targets: distributed tree + dev docs. Each entry is a repo-relative path
// that may be a file (AGENTS.md) or a directory (recursively walked).
const SCAN = ['skills', 'commands', 'hooks', 'AGENTS.md', 'adrs', '.claude/skills'];

if (!existsSync(GLOSSARY_ABS)) {
  console.error(`glossary-lint: ${GLOSSARY_REL} not found — cannot lint`);
  process.exit(1);
}

// ---- parse the 禁用变体 column of the markdown table ----
// The承重 table header row contains the column labels; we locate the 0-based index
// of the column whose header includes "禁用变体", then read each backtick-wrapped
// token in that cell of every data row → { variant, canonical } (canonical = col 0).
function parseBanned(text) {
  const lines = text.split('\n');
  let headerIdx = -1;
  let bannedCol = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim().startsWith('|')) continue;
    if (ln.includes('禁用变体')) {
      const cols = splitRow(ln);
      bannedCol = cols.findIndex((c) => c.includes('禁用变体'));
      if (bannedCol !== -1) { headerIdx = i; break; }
    }
  }
  if (headerIdx === -1) {
    console.error('glossary-lint: could not find a table column labelled 禁用变体 in glossary.md');
    process.exit(1);
  }
  const out = [];
  // data rows start 2 lines after header (skip the |---|---| separator row)
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim().startsWith('|')) break; // table ended
    const cols = splitRow(ln);
    if (cols.length <= bannedCol) continue;
    const canonical = (cols[0] || '').replace(/`/g, '').trim();
    const cell = cols[bannedCol];
    // extract every `backtick-wrapped` token
    const re = /`([^`]+)`/g;
    let m;
    while ((m = re.exec(cell)) !== null) {
      const v = m[1].trim();
      if (v) out.push({ variant: v, canonical });
    }
  }
  return out;
}

// Split a markdown table row into cell strings (drop leading/trailing pipe cells).
function splitRow(row) {
  const t = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

// ---- collect scan files ----
function collectFiles(base) {
  const out = [];
  const abs = join(ROOT, base);
  if (!existsSync(abs)) return out;
  const st = statSync(abs);
  if (st.isFile()) { out.push(abs); return out; }
  // Exclude isolated agent worktrees. Match on the path *relative to ROOT* — an
  // absolute-substring check would self-nuke when this lint is itself run from
  // inside a `.claude/worktrees/<name>/` worktree (ROOT already ends in that path,
  // so every child would spuriously match).
  const excluded = (p) => relative(ROOT, p).split(/[\\/]/).join('/').includes('.claude/worktrees/');
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) {
        if (excluded(p)) continue; // exclude isolated worktrees
        walk(p);
      } else if (s.isFile()) {
        out.push(p);
      }
    }
  };
  walk(abs);
  return out;
}

const banned = parseBanned(readFileSync(GLOSSARY_ABS, 'utf8'));
if (banned.length === 0) {
  console.log('glossary-lint: OK — 0 banned variants declared, nothing to check');
  process.exit(0);
}

const seen = new Set();
const files = [];
for (const base of SCAN) {
  for (const f of collectFiles(base)) {
    if (f === GLOSSARY_ABS) continue;        // never lint the glossary itself
    if (relative(ROOT, f).split(/[\\/]/).join('/').includes('.claude/worktrees/')) continue;
    if (seen.has(f)) continue;
    seen.add(f);
    files.push(f);
  }
}

const violations = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); }
  catch { continue; } // unreadable / binary — skip
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    for (const { variant, canonical } of banned) {
      if (ln.includes(variant)) {
        violations.push({
          file: relative(ROOT, f),
          line: i + 1,
          variant,
          canonical,
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`glossary-lint: OK — ${files.length} file(s) scanned, ${banned.length} banned variant(s), 0 drift hits`);
  process.exit(0);
}

for (const v of violations) {
  console.error(`${v.file}:${v.line}: banned term drift \`${v.variant}\` → use canonical \`${v.canonical}\` (design_docs/glossary.md)`);
}
console.error(`\nglossary-lint: FAILED — ${violations.length} drift hit(s) across ${files.length} file(s)`);
process.exit(1);
NODE
