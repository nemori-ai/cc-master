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
#   3. dead relative links — every markdown link in SKILL.md `](relpath)` to a
#      repo-relative file (references/x.md, assets/..., …) must resolve on disk.
#   4. bare cross-skill path references (Finding #50, AGENTS.md §12) — inside any
#      distributed markdown (skills/ commands/ hooks/), a backtick-wrapped path that
#      starts with a sibling *distributed skill name* (authoring-workflows /
#      master-orchestrator-guide / pacing-and-estimation / using-ccm) followed by `/…` is a dead
#      link at install time:
#      it resolves relative to the user's cwd, not the plugin root. Such refs MUST be
#      ${CLAUDE_PLUGIN_ROOT}/skills/<name>/… absolute (or ${CLAUDE_SKILL_DIR}/… for
#      same-skill assets). Bare skill-name mentions WITHOUT a `/` are fine (the name
#      used as a noun), and same-skill self-refs (`references/x.md`) don't start with
#      a skill name so they're never matched. NOTE: dev-only repo-root `scripts/`
#      paths in dev-only files are intentionally NOT flagged — those scripts are not
#      distributed (红线5) and the bare path is correct from repo root.
#   5. terminology drift (design_docs/glossary.md) — delegated to the sibling
#      scripts/glossary-lint.sh: greps the distributed tree + dev docs for any banned
#      variant of a承重 term (canonical spelling SSOT in the glossary). Its exit code
#      is aggregated into this script's overall verdict.
#   6. hooks ⊥ skill scripts/assets (架构红线) — a file under hooks/scripts/ must NEVER
#      reference a skill's scripts/ or assets/ subtree. Hooks own their business logic and
#      never reach sideways into a skill's private payload files (that couples the
#      dormant-until-armed hook layer to distributed skill assets). Grep every hooks/scripts/
#      file for a `skills/<name>/scripts` or `skills/<name>/assets` path → violation. A hook
#      that legitimately points at a skill's SKILL.md is NOT flagged (this check matches only
#      the /scripts and /assets subpaths, never SKILL.md).
#   7. internal-codename + repo-coupling leak in DISTRIBUTED skill prose (AGENTS.md §6 自包含).
#      Distributed skills/ ship to end users with NO access to this repo's dev artifacts, so any
#      cc-master-internal codename — ADR/Finding numbers, charter Cx / hook Hx / 镜头号 / 红线号 /
#      SKILL 字母 — or any reference to a repo-internal location OUTSIDE the distributed skills/ tree
#      (design_docs/, adrs/, hooks/scripts, the @ccm/engine package name, CHANGELOG) is meaningless
#      (even harmful) to that reader and drifts the skill from "apply the substance, not the dev-side
#      code". This check nails that down mechanically. SCOPE = agent-facing prose only: each distributed
#      skill's SKILL.md + references/**/*.md — NOT .claude/skills/ dev meta-skills, and NOT
#      .design/ / evals/ / scripts/ (dev artifacts/code, not shipped prose).
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

# checks (1)-(4) run in the node program below; check (5) runs after it. Disable
# errexit around the node call so a check-(1)-(4) failure doesn't abort before we
# also run check (5) — we aggregate both exit codes into the final verdict.
set +e
REPO="$REPO" node - "$@" <<'NODE'
'use strict';
const { readFileSync, readdirSync, existsSync, statSync } = require('node:fs');
const { join, dirname, relative } = require('node:path');

const ROOT = process.env.REPO;
const SKILL_DIRS = ['skills', '.claude/skills'];

// Distributed-tree roots scanned by the bare-cross-skill-ref check (4). Only the
// dirs that actually ship with the plugin — bare refs in here die at install time.
const DIST_DIRS = ['skills', 'commands', 'hooks'];
// Distributed skill names whose bare `<name>/…` path refs are install-time dead links.
const DIST_SKILL_NAMES = ['authoring-workflows', 'master-orchestrator-guide', 'pacing-and-estimation', 'using-ccm', 'slicing-goals-into-dags', 'dev-as-ml-loop', 'engineering-with-craft'];

// Recursively collect every *.md file under a repo-relative base dir.
// Skip skills/<name>/.design: those are co-located dev docs and are stripped from
// release packages, so distributed-prose checks must not treat them as shipped prose.
function markdownFiles(base) {
  const out = [];
  const abs = join(ROOT, base);
  if (!existsSync(abs)) return out;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === '.design') continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && name.endsWith('.md')) out.push(p);
    }
  };
  walk(abs);
  return out.sort();
}

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

// ---- (4) bare cross-skill path references (Finding #50) ----
// Scan every distributed *.md for a backtick-wrapped path beginning with a sibling
// distributed-skill name + `/`, that is NOT a ${CLAUDE_*} absolute reference.
const crossSkillRe = new RegExp(
  '`(' + DIST_SKILL_NAMES.join('|') + ')/[^`]*`', 'g');
const seenMd = new Set();
for (const base of DIST_DIRS) {
  for (const abs of markdownFiles(base)) {
    if (seenMd.has(abs)) continue; // skills/ overlaps nothing here, but be safe
    seenMd.add(abs);
    const rel = relative(ROOT, abs);
    const lines = readFileSync(abs, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      // No line-level CLAUDE_ skip ON PURPOSE: the regex anchors the skill name *immediately
      // after the backtick*, so a corrected `${CLAUDE_PLUGIN_ROOT}/skills/<name>/…` ref (backtick
      // followed by `$`, not the bare name) never matches in the first place — no skip needed to
      // spare it. A line-level skip would instead be a FALSE-NEGATIVE: a line carrying both a
      // corrected ref and a remaining bare ref would be skipped wholesale, letting the dead link
      // pass (codex round-2 second-endpoint catch). We match per-token, so each bare ref is caught
      // regardless of what else shares its line.
      crossSkillRe.lastIndex = 0;
      let m;
      while ((m = crossSkillRe.exec(ln)) !== null) {
        add(rel, i + 1,
          `bare cross-skill ref \`${m[0].slice(1, -1)}\` — resolves relative to ` +
          `user cwd at install time (dead link). Use ` +
          `\${CLAUDE_PLUGIN_ROOT}/skills/${m[1]}/… (Finding #50 / AGENTS.md §12)`);
      }
    }
  }
}

// ---- (6) hooks ⊥ skill scripts/assets (架构红线) ----
// A hook (hooks/scripts/*) must NEVER reference a skill's scripts/ or assets/ subtree — hooks own
// their business logic and never reach sideways into a skill's private files (that would couple the
// dormant-until-armed hook layer to distributed skill payloads; e.g. bootstrap building a board
// skeleton by cp'ing skills/.../assets/board.template.json — now built via ccm). The skill-name
// segment is matched as a kebab-case token ([a-z][a-z0-9-]*) so prose ellipses (skills/.../assets)
// in comments do NOT false-positive. Only /scripts and /assets subpaths match — a hook pointing at a
// skill's SKILL.md (reinject's soul re-injection) is never touched.
const hookSkillRe = /skills\/[a-z][a-z0-9-]*\/(scripts|assets)\b/;
const HOOK_DIR = join(ROOT, 'hooks', 'scripts');
if (existsSync(HOOK_DIR)) {
  for (const name of readdirSync(HOOK_DIR).sort()) {
    const p = join(HOOK_DIR, name);
    if (!statSync(p).isFile()) continue;
    const lines = readFileSync(p, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const mm = lines[i].match(hookSkillRe);
      if (mm) {
        add(`hooks/scripts/${name}`, i + 1,
          `hook references a skill scripts/assets path \`${mm[0]}\` — hooks ⊥ skill scripts/assets: ` +
          `a hook must never reach into a skill's private files (keep hook business logic self-contained; ` +
          `build board skeletons via ccm). AGENTS.md §2 关键不变式`);
      }
    }
  }
}

// ---- (7) internal-codename + repo-coupling leak in DISTRIBUTED skill prose (AGENTS.md §6 自包含) ----
// Each check carries a fix hint in the style of checks (4)/(6). SCOPE = distributed skills/ agent-facing
// prose only: a *.md is in-scope iff its basename is SKILL.md OR it sits under a references/ dir. This
// allowlist naturally excludes .design/ (co-located dev docs), evals/ + scripts/ +
// assets/ (dev artifacts/code), and — because we only walk 'skills/' — the whole .claude/skills/ dev
// meta-skill tree. Future dev artifacts under a skill are auto-excluded (allowlist, not blocklist).
const codeLeakChecks = [
  { re: /ADR-[0-9]/g,       fix: 'ADR 编号(dev 决策记录)——删号留实质' },
  { re: /Finding #/g,       fix: 'Finding 台账编号——删号留实质' },
  { re: /\bC[1-6]\b/g,      fix: 'charter 能力代号 Cx——删(讲能力实质，不引编号)' },
  { re: /\bH[0-9]\b/g,      fix: 'hook 内部编号 Hx——用 hook 名/行为，不引编号' },
  { re: /镜头 ?[0-9]/g,     fix: '镜头号——用镜头名(如「量力而行」)' },
  { re: /红线 ?[0-9]/g,     fix: '红线号——用红线实质(如「指挥不演奏」)' },
  { re: /\bSKILL [A-H]\b/g, fix: 'skill 字母代号——用 skill 名(如 using-ccm)' },
  { re: /design_docs\//g,   fix: '指向 dev 文档树(不随 plugin 分发)——删或概念化' },
  { re: /adrs\//g,          fix: '指向 ADR 树(不随 plugin 分发)——删或概念化' },
  { re: /hooks\/scripts/g,  fix: '指向 hook 源路径(repo 内部)——概念提及即可，别给路径' },
  { re: /@ccm\/engine/g,    fix: 'repo 内部 npm 包名(用户不可见)——改「ccm 引擎」' },
  { re: /\bCHANGELOG\b/g,   fix: '指向 changelog(不随 plugin 分发)——删' },
];
function inScopeDistSkillMd() {
  return markdownFiles('skills').filter((abs) => {
    const parts = relative(ROOT, abs).split(/[\\/]/);
    return parts[parts.length - 1] === 'SKILL.md' || parts.includes('references');
  });
}
for (const abs of inScopeDistSkillMd()) {
  const rel = relative(ROOT, abs);
  const lines = readFileSync(abs, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const c of codeLeakChecks) {
      c.re.lastIndex = 0;
      let m;
      while ((m = c.re.exec(lines[i])) !== null) {
        add(rel, i + 1,
          `internal-codename/repo-coupling leak \`${m[0]}\` in distributed skill prose — ${c.fix} ` +
          `(AGENTS.md §6 自包含: 分发 skills/ 无 cc-master 内部代号 + repo-无关)`);
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
node_rc=$?

# ---- check (5): terminology drift (delegated to glossary-lint.sh) ----
echo "--- check (5): terminology drift (design_docs/glossary.md)"
bash "$REPO/scripts/glossary-lint.sh"
glossary_rc=$?

# Aggregate: fail if either checks (1)-(4) or check (5) failed.
if [ "$node_rc" -ne 0 ] || [ "$glossary_rc" -ne 0 ]; then
  exit 1
fi
exit 0
