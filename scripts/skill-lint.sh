#!/usr/bin/env bash
# skill-lint.sh — out-of-band static prose-lint for cc-master skill files.
#
# This is the *mechanically-checkable subset* of skill review: cheap static
# checks over every SKILL.md (distributed skills/ + project-internal .claude/skills/).
# It is a CHECKER, not a fixer — it never edits any skill file. On a violation it
# prints the offending file:line + reason and exits non-zero.
#
# Checks (see node program below):
#   1. frontmatter quote anti-pattern (Finding #1, AGENTS.md §6) — a `description:`
#      value containing `:` or `"` MUST be wrapped in single quotes as a whole;
#      otherwise the YAML parser misreads it and validation fails non-obviously.
#   2. required frontmatter fields — `name` + `description` both present & non-empty.
#   3. dead relative links — every markdown link `](relpath)` to a repo-relative
#      file (references/x.md, assets/..., DESIGN.md, …) must resolve on disk.
#
# Why node, not bash+jq/python: the repo's content tests are node-based, and node
# is guaranteed present in any Claude Code host (AGENTS.md §3 红线1 / ADR-006).
# This script lives in scripts/ (out-of-band, manual/orchestrated) — never in hooks/.
#
# Usage:  scripts/skill-lint.sh
# Exit:   0 = clean, 1 = at least one violation (or a setup error).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

command -v node >/dev/null 2>&1 || {
  echo "node not found on PATH — required (Claude Code hosts ship node; ADR-006)" >&2
  exit 1
}

REPO="$REPO" node - "$@" <<'NODE'
'use strict';
const { readFileSync, readdirSync, existsSync, statSync } = require('node:fs');
const { join, dirname } = require('node:path');

const ROOT = process.env.REPO;
const SKILL_DIRS = ['skills', '.claude/skills'];

// Collect every <dir>/<name>/SKILL.md that exists.
function skillFiles() {
  const out = [];
  for (const base of SKILL_DIRS) {
    const abs = join(ROOT, base);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const d = join(abs, name);
      if (!statSync(d).isDirectory()) continue;
      const f = join(d, 'SKILL.md');
      if (existsSync(f)) out.push({ rel: `${base}/${name}/SKILL.md`, abs: f, dir: d });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// Split the leading `---\n...\n---` YAML frontmatter block.
// Returns { lines, startLine } where startLine is the 1-based line index of the
// first frontmatter body line (the line right after the opening `---`).
function frontmatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return { lines: lines.slice(1, i), startLine: 2 };
  }
  return null; // unterminated frontmatter
}

const violations = [];
const add = (file, line, msg) => violations.push({ file, line, msg });

for (const s of skillFiles()) {
  const text = readFileSync(s.abs, 'utf8');

  // ---- frontmatter-based checks (1 + 2) ----
  const fm = frontmatter(text);
  if (!fm) {
    add(s.rel, 1, 'no YAML frontmatter block (expected leading `---` … `---`)');
  } else {
    let nameVal = null;
    let descRaw = null;       // raw text after `description:` (before trimming)
    let descLine = null;      // 1-based line number of the `description:` key
    for (let i = 0; i < fm.lines.length; i++) {
      const ln = fm.lines[i];
      let m;
      if ((m = ln.match(/^name:\s*(.*)$/))) nameVal = m[1].trim();
      else if ((m = ln.match(/^description:\s*(.*)$/))) {
        descRaw = m[1];
        descLine = fm.startLine + i;
      }
    }

    // (2) required fields present + non-empty
    if (nameVal === null) add(s.rel, fm.startLine, 'frontmatter missing required field `name`');
    else if (nameVal === '') add(s.rel, fm.startLine, 'frontmatter `name` is empty');

    if (descRaw === null) {
      add(s.rel, fm.startLine, 'frontmatter missing required field `description`');
    } else {
      const desc = descRaw.trim();
      if (desc === '') {
        add(s.rel, descLine, 'frontmatter `description` is empty');
      } else {
        // (1) quote anti-pattern (Finding #1). A description whose value contains
        // `:` or `"` MUST be single-quote-wrapped as a whole. We flag it when the
        // value is NOT already wrapped in matching single quotes AND contains a
        // `:` or a `"`. (Double-quote-wrapped values still break the same way for
        // `"` content and are not the repo convention, so they're flagged too.)
        const singleWrapped = desc.length >= 2 && desc.startsWith("'") && desc.endsWith("'");
        if (!singleWrapped && (desc.includes(':') || desc.includes('"'))) {
          const why = desc.includes(':') && desc.includes('"')
            ? "contains `:` and `\"`"
            : (desc.includes(':') ? 'contains `:`' : 'contains `"`');
          add(s.rel, descLine,
            `description ${why} but is not single-quote-wrapped as a whole ` +
            `(Finding #1 / AGENTS.md §6 — wrap the entire value in '…')`);
        }
      }
    }
  }

  // ---- (3) dead relative links ----
  // Match markdown inline links: ](target). Skip external URLs, absolute paths,
  // mailto/anchors-only. Strip a trailing #anchor before resolving on disk.
  const lines = text.split('\n');
  const linkRe = /\]\(([^)]+)\)/g;
  for (let i = 0; i < lines.length; i++) {
    let m;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(lines[i])) !== null) {
      let target = m[1].trim();
      // drop optional `"title"` after a space (markdown link title syntax)
      const sp = target.search(/\s/);
      if (sp !== -1) target = target.slice(0, sp);
      if (!target) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:, etc.
      if (target.startsWith('#')) continue;              // pure anchor
      if (target.startsWith('/')) continue;              // absolute (not a repo-relative claim)
      const path = target.split('#')[0];                 // strip #anchor
      if (!path) continue;
      const resolved = join(s.dir, path);
      if (!existsSync(resolved)) {
        add(s.rel, i + 1, `dead link → \`${target}\` (no file at ${path} relative to this skill)`);
      }
    }
  }
}

const fileCount = skillFiles().length;
if (violations.length === 0) {
  console.log(`skill-lint: OK — ${fileCount} SKILL.md checked, 0 violations`);
  process.exit(0);
}

for (const v of violations) {
  console.error(`${v.file}:${v.line}: ${v.msg}`);
}
console.error(`\nskill-lint: FAILED — ${violations.length} violation(s) across ${fileCount} SKILL.md`);
process.exit(1);
NODE
