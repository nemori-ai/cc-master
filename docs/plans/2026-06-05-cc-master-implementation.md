# cc-master Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `cc-master`, a ship-anywhere Claude Code plugin that turns any main-session agent into a long-horizon (>24h) "master orchestrator": it picks the right dynamic-workflow paradigm and writes stable/parallel scripts, and it productively advances the main thread (dispatch background work + use idle windows with 主观能动性) while surviving repeated context compaction and cross-session resume.

**Architecture:** A self-contained plugin directory (`.claude-plugin/plugin.json` + `commands/` + `skills/` + `hooks/`) backed by a cwd-keyed `board.json` orchestration archive. Three hooks (UserPromptSubmit/Stop/SessionStart) are always-on but **self-gate** on a marker file, so they no-op until the bootstrap command activates a board. Two skills carry the depth: **Skill A** (`orchestrating-to-completion`) is the orchestration soul (philosophy + decision program + dispatch framework); **Skill B** (`authoring-workflows`) is the workflow-writing manual (templates + examples + the harness-contract it teaches). The only "real programs" (the 3 hook shell scripts) get genuine TDD; markdown content is verified by structural-invariant tests. *(See the post-build amendment below: the originally-planned runnable linter was removed.)*

**Tech Stack:** Markdown (commands/skills/references), POSIX `bash` (hooks, jq-free for portability), Node ≥18 ESM (`node --test` test runner), JSON (plugin.json, hooks.json, board schema). Zero runtime third-party dependencies.

---

> **POST-BUILD AMENDMENT (2026-06-05, dogfood).** The runnable linter (Phase 2 + the bundled-asset
> lint gate in Task 3.1) was **removed** after the build. The Claude Code harness validates workflows
> authoritatively (`meta` at launch; determinism / caps / escape at runtime), so a standalone static
> linter is a redundant, drift-prone heuristic reimplementation — it even false-positived on a doc
> comment during this very build. Skill B now teaches the harness contract instead (see `docs/spec.md`
> §9 and the skill's `SKILL.md` §3). Phase 2 and the lint-gate steps below are kept as historical record.

## Shared Constants & Conventions (pin these FIRST — every component references them)

These are the cross-component contracts. A drift between any two (e.g. the sentinel the command embeds vs. the sentinel the hook greps) is a silent bootstrap failure. They are reproduced in the tasks that need them; this table is the single source of truth.

| Constant | Value | Used by |
|---|---|---|
| `PLUGIN_ROOT` (dev) | `/Users/panqiwei/Dev/repos/nemori-ai/cc-master` | all paths below are relative to this |
| Plugin name / namespace | `cc-master` → commands are `/cc-master:<name>` | plugin.json, commands |
| Board file (in project) | `${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master/board.json` | hooks, commands, Skill A |
| Active marker (in project) | `${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master/active` | hooks self-gate, stop cmd |
| Board schema version | `"cc-master/v1"` (the `schema` field value) | board.template.json, schema |
| Command-name sentinel | literal substring `cc-master:as-master-orchestrator` | bootstrap hook grep (raw-prompt case) |
| Body sentinel | HTML comment `<!-- cc-master:bootstrap:v1 -->` | bootstrap hook grep (expanded-body case) |
| Plugin-root env (hooks) | `${CLAUDE_PLUGIN_ROOT:-<script-relative ../..>}` | hooks resolve bundled template |
| Board template (bundled) | `skills/orchestrating-to-completion/assets/board.template.json` | bootstrap hook reads this (single source) |

**Self-gating rule (all 3 hooks, first line of logic):** if the active marker file does not exist → `exit 0` silently. No marker = plugin dormant.

**jq-free rule:** hooks MUST NOT depend on `jq`, `python`, or any non-coreutils binary. Parse/emit JSON with `grep`/`sed`/`printf` heredocs only. Rationale: ship-anywhere — the target machine may have none of them.

**Dual-sentinel rationale (the one CC unknown):** it is undocumented whether UserPromptSubmit sees the *raw* `/cc-master:...` text or the *expanded* command body. The bootstrap hook greps for **either** the command-name OR the body comment, so it fires in both cases without us knowing which is real. Task in Phase 8 empirically confirms which (the §13 smoke-test) but the plugin is correct either way.

---

## File Structure Map (what each file is responsible for)

```
cc-master/                                   (git root = plugin root; ~/.claude/plugins/cc-master symlinks here)
├── .claude-plugin/plugin.json               manifest: name, version, description, component dirs
├── README.md                                what it is, install (symlink), usage, the 3 background mechanisms
├── LICENSE                                  MIT (ship-anywhere)
├── .gitignore                               ignore test scratch (.tmp-*/), OS cruft
├── run-tests.sh                             top-level runner: bash hook tests + node --test
├── commands/
│   ├── as-master-orchestrator.md            bootstrap prompt; embeds body sentinel; tells agent to fill DAG
│   ├── status.md                            render board summary + validate narrow waist
│   └── stop.md                              set owner.active=false + remove marker (archive, don't delete board)
├── skills/
│   ├── orchestrating-to-completion/         Skill A — orchestration soul
│   │   ├── SKILL.md                         identity creed + 7 lenses + red lines + decision program + board protocol + reference index
│   │   ├── references/
│   │   │   ├── decomposition.md             goal → dependency DAG; CPM/float; T₁/T∞; node contracts
│   │   │   ├── dispatch.md                  3 mechanisms; intra-vs-inter; re-altitude; admission control
│   │   │   ├── board.md                     full board protocol (schema/status/flexible edges/lease/log)
│   │   │   ├── async-hitl.md                in-flight tracking/hedge; integrate completions; HITL-as-async-worker
│   │   │   └── resume-verify.md             content-hash resume; dep-pinning/stale; endpoint verification; loop convergence
│   │   └── assets/
│   │       ├── board.template.json          empty board skeleton (bootstrap hook reads this)
│   │       └── board.example.json           a worked board (teaching reference)
│   └── authoring-workflows/                 Skill B — workflow-writing manual
│       ├── SKILL.md                         honest-test + paradigm decision tree + author flow (validate before run) + reference index
│       ├── references/
│       │   ├── mechanism.md                 confirmed-contract vs unknowns; 7 primitives; parallel(barrier) vs pipeline(stream); determinism; caps
│       │   ├── patterns.md                  fan-out/pipeline/adversarial-verify/judge-panel/loop-*/multimodal/completeness — when + skeleton
│       │   └── api-reference.md             primitive signatures + opts + cache-key + failure semantics
│       ├── scripts/validate-workflow.mjs    RUNNABLE linter (deterministic checks)
│       └── assets/
│           ├── templates/                   5 control-flow skeletons (placeholder prompts)
│           │   ├── fan-out.js
│           │   ├── pipeline.js
│           │   ├── loop-until-budget.js
│           │   ├── loop-until-dry.js
│           │   └── scout-then-fanout.js
│           └── examples/                    4 complete runnable workflows (real prompts + schema + verify)
│           │   ├── review-adversarial-verify.js
│           │   ├── design-judge-panel.js
│           │   ├── research-multimodal-sweep.js
│           │   └── migrate-discover-transform-verify.js
├── hooks/
│   ├── hooks.json                           registers the 3 hooks → ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/*.sh
│   └── scripts/
│       ├── bootstrap-board.sh               UserPromptSubmit: grep sentinel → create board+marker → inject "fill DAG"
│       ├── verify-board.sh                  Stop: backstop (board invalid → block) + ready-work nudge
│       └── reinject.sh                      SessionStart: re-anchor role + instruct re-read board
├── tests/
│   ├── hooks/
│   │   ├── helpers.sh                       assert_* + temp-project fixture
│   │   ├── test_bootstrap-board.sh
│   │   ├── test_verify-board.sh
│   │   └── test_reinject.sh
│   ├── linter/
│   │   ├── validate-workflow.test.mjs       good/bad fixtures → pass/fail + messages
│   │   └── fixtures/{good-*.js,bad-*.js}
│   ├── assets/lint-all-bundled.test.mjs     every template+example passes the linter
│   └── content/structure.test.mjs           plugin.json/hooks.json valid; SKILL.md frontmatter; sentinel consistency
└── docs/   (already populated: research/, spec.md, design-notes.md, plans/<this file>)
```

---

## Testing Strategy (why these tests, what they cover)

- **Hooks** — genuine TDD. A bash harness pipes mock stdin JSON into the script under a temp `CLAUDE_PROJECT_DIR`, then asserts exit code, stdout JSON, and filesystem side effects (board/marker created or not). This directly de-risks the highest-risk feature (the bootstrap guarantee).
- **Linter** — genuine TDD via `node --test`. Good fixtures must pass; each bad fixture must fail with the specific violation. The linter is the only nontrivial algorithm, so it earns the most tests.
- **Bundled-asset self-consistency** — every `templates/*.js` and `examples/*.js` is fed through the linter and must pass. This makes "the scaffolds we ship are themselves valid" a machine-checked invariant, not a hope. It also embodies 镜头6 (trust deterministic endpoint verification, not prose self-check).
- **Content invariants** — a light `node --test` that parses plugin.json + hooks.json (must be valid JSON, required keys present), asserts every `SKILL.md` has YAML frontmatter with `name`+`description`, and asserts the **sentinel consistency contract**: the exact strings `bootstrap-board.sh` greps for are present in `commands/as-master-orchestrator.md`. This catches the single nastiest drift class.
- **No browser/integration harness for prose** — markdown depth is reviewed by humans; we only machine-check structure + cross-file contracts.

Run everything: `./run-tests.sh`. Node ≥18 provides `node --test` with zero deps.

---

## Phase 0 — Repo hygiene & test scaffolding

The repo is already `git init`-ed on `main` with `docs/` populated. This phase adds the project-level files and the test harness skeleton so later phases can be TDD'd.

### Task 0.1: `.gitignore`, `LICENSE`, `README.md`

**Files:**
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `README.md`

- [ ] **Step 1: Write `.gitignore`**

```gitignore
# test scratch (hook tests create temp project dirs)
.tmp-*/
tests/**/.tmp-*/
# OS / editor
.DS_Store
*.swp
# never commit a real runtime board into the plugin repo
.claude/cc-master/
```

- [ ] **Step 2: Write `LICENSE`** (MIT, ship-anywhere). Use the standard MIT text, copyright line:

```
MIT License

Copyright (c) 2026 cc-master contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
... (standard MIT body) ...
```

- [ ] **Step 3: Write `README.md`** — sections: (1) one-paragraph what-it-is (master orchestrator for >24h tasks); (2) **Install** — `git clone` then `ln -s "$(pwd)/cc-master" ~/.claude/plugins/cc-master`, restart Claude Code or `/reload-plugins`; (3) **Usage** — `/cc-master:as-master-orchestrator <goal>`, `/cc-master:status`, `/cc-master:stop`; (4) **The 3 background mechanisms it teaches** — background shell, sub-agent (run_in_background), workflow — and an explicit note that it deliberately does NOT use agent-teams or scheduled routines (not reliably ship-anywhere); (5) link to `docs/spec.md` and `docs/research/`.

- [ ] **Step 4: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add .gitignore LICENSE README.md
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "chore: repo hygiene (gitignore, license, readme)"
```

### Task 0.2: Test harness skeleton

**Files:**
- Create: `run-tests.sh`
- Create: `tests/hooks/helpers.sh`

- [ ] **Step 1: Write `run-tests.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

fail=0
echo "== hook tests (bash) =="
for t in tests/hooks/test_*.sh; do
  [ -e "$t" ] || continue
  echo "--- $t"
  bash "$t" || fail=1
done

echo "== node tests (linter + assets + content) =="
# Node 22+ treats `--test` path args as test files/globs, NOT discovery dirs (a bare dir is
# read as a module to execute and errors). So enumerate explicit test files via find — this
# is version-stable (Node 18-26) and avoids the "all three dirs must exist" fragility of a
# multi-glob `ls`. Our paths contain no spaces, so the unquoted expansion is intentional.
node_tests=$(find tests -name '*.test.mjs' 2>/dev/null | sort)
if [ -n "$node_tests" ]; then
  # shellcheck disable=SC2086
  node --test $node_tests || fail=1
fi

[ "$fail" -eq 0 ] && echo "ALL TESTS PASSED" || { echo "TESTS FAILED"; exit 1; }
```

- [ ] **Step 2: Write `tests/hooks/helpers.sh`** — assertion + fixture helpers sourced by every hook test:

```bash
# shellcheck shell=bash
# Source me: . "$(dirname "$0")/helpers.sh"
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAILED=0

_red()  { printf '\033[31m%s\033[0m\n' "$1"; }
_green(){ printf '\033[32m%s\033[0m\n' "$1"; }

assert_eq() { # $1 expected $2 actual $3 msg
  if [ "$1" = "$2" ]; then PASS=$((PASS+1)); else
    FAILED=$((FAILED+1)); _red "FAIL: $3 (expected [$1] got [$2])"; fi
}
assert_contains() { # $1 haystack $2 needle $3 msg
  case "$1" in *"$2"*) PASS=$((PASS+1));; *) FAILED=$((FAILED+1)); _red "FAIL: $3 (missing [$2])";; esac
}
assert_not_contains() { case "$1" in *"$2"*) FAILED=$((FAILED+1)); _red "FAIL: $3 (unexpected [$2])";; *) PASS=$((PASS+1));; esac; }
assert_file() { [ -f "$1" ] && PASS=$((PASS+1)) || { FAILED=$((FAILED+1)); _red "FAIL: $2 (no file $1)"; }; }
assert_no_file() { [ ! -e "$1" ] && PASS=$((PASS+1)) || { FAILED=$((FAILED+1)); _red "FAIL: $2 (file exists $1)"; }; }

# make_project: create an isolated fake project dir, echo its path
make_project() { local d; d="$(mktemp -d "${TMPDIR:-/tmp}/.tmp-ccm.XXXXXX")"; echo "$d"; }

# run_hook SCRIPT STDIN_JSON PROJECT_DIR -> sets HOOK_OUT / HOOK_RC
run_hook() {
  HOOK_OUT="$(CLAUDE_PROJECT_DIR="$3" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
             printf '%s' "$2" | bash "$PLUGIN_ROOT/$1" 2>/dev/null)"; HOOK_RC=$?
}

finish() { echo "passed=$PASS failed=$FAILED"; [ "$FAILED" -eq 0 ] || exit 1; }
```

- [ ] **Step 3: Verify the runner executes with no tests yet**

Run: `chmod +x run-tests.sh && ./run-tests.sh`
Expected: prints headers, "ALL TESTS PASSED" (no test files yet → loops skip).

- [ ] **Step 4: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add run-tests.sh tests/hooks/helpers.sh
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "test: add bash+node test harness skeleton"
```

---

## Phase 1 — Plugin manifest

### Task 1.1: `.claude-plugin/plugin.json` + content-structure test

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `tests/content/structure.test.mjs`

- [ ] **Step 1: Write the failing test** `tests/content/structure.test.mjs`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('plugin.json is valid and well-formed', () => {
  const j = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(j.name, 'cc-master');
  assert.ok(typeof j.version === 'string' && j.version.length > 0);
  assert.ok(typeof j.description === 'string' && j.description.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/content/structure.test.mjs`
Expected: FAIL (ENOENT on `.claude-plugin/plugin.json`).

- [ ] **Step 3: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "cc-master",
  "version": "0.1.0",
  "description": "Turn any Claude Code session into a long-horizon master orchestrator: pick the right dynamic-workflow paradigm and keep the main thread productively advancing across compaction and sessions.",
  "author": { "name": "cc-master contributors" },
  "keywords": ["orchestration", "workflow", "long-horizon", "agent", "parallel"]
}
```

Note: `commands/`, `skills/`, `hooks/hooks.json` are auto-discovered by Claude Code from the conventional directories; no explicit path keys are required in plugin.json. (Confirm during Phase 8 smoke-test; if a manifest version key is needed, add it then.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/content/structure.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add .claude-plugin/plugin.json tests/content/structure.test.mjs
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat: plugin manifest + structure test"
```

---

## Phase 2 — The workflow linter (highest-value standalone program)

`validate-workflow.mjs` deterministically rejects the failure modes documented in research report 1 + the Workflow tool contract. Build it first because Phase 3's templates/examples must pass it.

**Linter contract (the checks it enforces):**
1. **meta-first**: first non-comment statement is `export const meta = { ... }`.
2. **meta is a pure literal**: the `meta` object has no identifiers/calls/template-interpolation/spreads (only string/number/array/object literals).
3. **meta required keys**: `name` (string), `description` (string).
4. **determinism三禁**: no `Date.now`, no `Math.random`, no arg-less `new Date()`.
5. **no escape hatches**: no `require(`, no `import ` from node builtins (`fs`/`child_process`/`process`), no bare `process.`.
6. **parallel-thunk**: every `parallel(` argument is an array of thunks (`() =>`), never bare promises (heuristic: `parallel(` not immediately followed by `[...]` of `()=>`/function args → warn).
7. **size**: file ≤ 512 KB.

Exit code: `0` = clean, `1` = ≥1 ERROR. Emits one line per finding: `LEVEL path:line  rule  message`. (Adapted from ray-amjad/claude-code-workflow-creator's `validate-workflow.mjs` — **credit in the file header**.)

### Task 2.1: Linter skeleton + meta-first/required checks (TDD)

**Files:**
- Create: `tests/linter/fixtures/good-minimal.js`
- Create: `tests/linter/fixtures/bad-no-meta.js`
- Create: `tests/linter/validate-workflow.test.mjs`
- Create: `skills/authoring-workflows/scripts/validate-workflow.mjs`

- [ ] **Step 1: Write fixtures**

`tests/linter/fixtures/good-minimal.js`:
```javascript
export const meta = { name: 'x', description: 'y', phases: [{ title: 'A' }] }
const r = await agent('do A')
return r
```

`tests/linter/fixtures/bad-no-meta.js`:
```javascript
const r = await agent('no meta here')
return r
```

- [ ] **Step 2: Write the failing test** `tests/linter/validate-workflow.test.mjs`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LINTER = join(HERE, '..', '..', 'skills', 'authoring-workflows', 'scripts', 'validate-workflow.mjs');
const fix = (n) => join(HERE, 'fixtures', n);

// returns {code, out}
function lint(file) {
  try {
    const out = execFileSync('node', [LINTER, file], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') }; }
}

test('good-minimal passes', () => {
  const { code } = lint(fix('good-minimal.js'));
  assert.equal(code, 0);
});

test('bad-no-meta fails with meta-first rule', () => {
  const { code, out } = lint(fix('bad-no-meta.js'));
  assert.equal(code, 1);
  assert.match(out, /meta/i);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/linter/validate-workflow.test.mjs`
Expected: FAIL (linter file missing).

- [ ] **Step 4: Write minimal `validate-workflow.mjs`** covering meta-first + required keys

```javascript
#!/usr/bin/env node
// validate-workflow.mjs — deterministic linter for Claude Code dynamic-workflow scripts.
// Adapted from ray-amjad/claude-code-workflow-creator (validate-workflow.mjs); extended for
// the cc-master skill. Credit: original determinism/meta checks by ray-amjad.
import { readFileSync, statSync } from 'node:fs';

const MAX_BYTES = 512 * 1024;
const file = process.argv[2];
if (!file) { console.error('usage: validate-workflow.mjs <script.js>'); process.exit(2); }

const findings = [];
const add = (level, line, rule, msg) => findings.push({ level, line, rule, msg });
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

const src = readFileSync(file, 'utf8');

// rule: size
if (statSync(file).size > MAX_BYTES) add('ERROR', 1, 'size', `file exceeds ${MAX_BYTES} bytes`);

// rule: meta-first — first non-comment, non-blank statement must start `export const meta`
const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n');
let firstCode = '';
for (const ln of stripped) {
  const t = ln.trim();
  if (!t || t.startsWith('//')) continue;
  firstCode = t; break;
}
if (!/^export\s+const\s+meta\s*=/.test(firstCode)) {
  add('ERROR', 1, 'meta-first', 'first statement must be `export const meta = {...}`');
}

// rule: meta required keys (name, description) — shallow regex on the meta block
const metaMatch = src.match(/export\s+const\s+meta\s*=\s*({[\s\S]*?})\s*\n/);
const metaBlock = metaMatch ? metaMatch[1] : '';
for (const key of ['name', 'description']) {
  if (!new RegExp(`['"\`]?${key}['"\`]?\\s*:`).test(metaBlock)) {
    add('ERROR', 1, 'meta-keys', `meta is missing required key '${key}'`);
  }
}

for (const f of findings) console.log(`${f.level} ${file}:${f.line}  ${f.rule}  ${f.msg}`);
process.exit(findings.some((f) => f.level === 'ERROR') ? 1 : 0);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/linter/validate-workflow.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add skills/authoring-workflows/scripts/validate-workflow.mjs tests/linter/
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(linter): meta-first + required-keys checks (TDD)"
```

### Task 2.2: Determinism三禁 + escape-hatch + pure-literal + parallel-thunk checks (TDD)

**Files:**
- Create: `tests/linter/fixtures/bad-determinism.js`
- Create: `tests/linter/fixtures/bad-require.js`
- Create: `tests/linter/fixtures/bad-meta-computed.js`
- Create: `tests/linter/fixtures/bad-parallel-bare.js`
- Create: `tests/linter/fixtures/good-full.js`
- Modify: `tests/linter/validate-workflow.test.mjs` (append cases)
- Modify: `skills/authoring-workflows/scripts/validate-workflow.mjs` (append rules)

- [ ] **Step 1: Write bad fixtures**

`bad-determinism.js`:
```javascript
export const meta = { name: 'x', description: 'y' }
const t = Date.now()
return t
```
`bad-require.js`:
```javascript
export const meta = { name: 'x', description: 'y' }
const fs = require('fs')
return fs
```
`bad-meta-computed.js`:
```javascript
const NAME = 'x'
export const meta = { name: NAME, description: 'y' }
return 1
```
`bad-parallel-bare.js`:
```javascript
export const meta = { name: 'x', description: 'y' }
const r = await parallel([agent('a'), agent('b')])
return r
```
`good-full.js`:
```javascript
export const meta = {
  name: 'full', description: 'exercises all clean paths',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}
const items = args ?? []
const out = await pipeline(items,
  (it) => agent(`find in ${it}`, { phase: 'Find' }),
  (r) => parallel((r.hits ?? []).map((h) => () => agent(`verify ${h}`, { phase: 'Verify' }))),
)
log(`done ${out.length}`)
return out
```

- [ ] **Step 2: Append failing test cases** to `validate-workflow.test.mjs`

```javascript
const CASES = [
  ['bad-determinism.js', /determinism|Date\.now/i],
  ['bad-require.js', /require|escape/i],
  ['bad-meta-computed.js', /literal/i],
  ['bad-parallel-bare.js', /thunk|parallel/i],
];
for (const [f, re] of CASES) {
  test(`${f} fails`, () => {
    const { code, out } = lint(fix(f));
    assert.equal(code, 1, `${f} should fail`);
    assert.match(out, re);
  });
}
test('good-full passes', () => assert.equal(lint(fix('good-full.js')).code, 0));
```

- [ ] **Step 3: Run to verify new cases fail**

Run: `node --test tests/linter/validate-workflow.test.mjs`
Expected: FAIL on the 4 bad cases + good-full (rules not yet implemented).

- [ ] **Step 4: Append rules** to `validate-workflow.mjs` (before the print/exit block)

```javascript
// rule: determinism三禁
const DET = [[/\bDate\.now\s*\(/, 'Date.now()'], [/\bMath\.random\s*\(/, 'Math.random()'],
             [/\bnew\s+Date\s*\(\s*\)/, 'arg-less new Date()']];
for (const [re, name] of DET) {
  const m = src.match(re);
  if (m) add('ERROR', lineOf(src, m.index), 'determinism', `non-deterministic ${name} breaks resume`);
}

// rule: escape hatches
const ESC = [[/\brequire\s*\(/, 'require()'], [/\bfrom\s+['"`](?:node:)?(?:fs|child_process|os|process)['"`]/, 'node-builtin import'],
             [/\bprocess\.(?!argv\b)/, 'process.* access']];
for (const [re, name] of ESC) {
  const m = src.match(re);
  if (m) add('ERROR', lineOf(src, m.index), 'escape-hatch', `disallowed ${name} (scripts run sandboxed)`);
}

// rule: meta pure-literal — the meta block must not contain bare identifiers as values,
// calls, template literals, or spreads. Heuristic: scan values after ':' inside metaBlock.
if (metaBlock) {
  if (/\.\.\./.test(metaBlock)) add('ERROR', 1, 'meta-literal', 'meta must not use spread');
  if (/`/.test(metaBlock)) add('ERROR', 1, 'meta-literal', 'meta must not use template literals');
  // value tokens that look like identifiers/calls (not quoted, not number, not {/[)
  const valRe = /:\s*([A-Za-z_$][\w$]*)\s*[,}\]]/g;
  let mm;
  while ((mm = valRe.exec(metaBlock))) {
    if (!['true', 'false', 'null', 'undefined'].includes(mm[1])) {
      add('ERROR', 1, 'meta-literal', `meta value '${mm[1]}' is not a literal`);
    }
  }
  if (/:\s*[A-Za-z_$][\w$.]*\s*\(/.test(metaBlock)) add('ERROR', 1, 'meta-literal', 'meta must not call functions');
}

// rule: parallel-thunk — parallel( must be followed by an array of thunks, not bare promises
const parRe = /\bparallel\s*\(\s*\[([^\]]*)\]/g;
let pm;
while ((pm = parRe.exec(src))) {
  const inner = pm[1].trim();
  if (inner && !/=>|\bfunction\b/.test(inner)) {
    add('ERROR', lineOf(src, pm.index), 'parallel-thunk', 'parallel() needs thunks (() => ...), not bare promises');
  }
}
```

- [ ] **Step 5: Run to verify all pass**

Run: `node --test tests/linter/validate-workflow.test.mjs`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add skills/authoring-workflows/scripts/validate-workflow.mjs tests/linter/
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(linter): determinism/escape-hatch/pure-literal/parallel-thunk checks (TDD)"
```

---

## Phase 3 — Skill B: `authoring-workflows` (manual + linter-gated assets)

Content authority: `docs/research/01-claude-code-dynamic-workflow-mechanism.md` (→ mechanism.md), the Workflow tool contract (→ api-reference.md + patterns.md), and `docs/spec.md` §9. Every bundled `.js` must pass the Phase-2 linter.

### Task 3.1: Bundled-asset lint gate (TDD — write the gate before the assets)

**Files:**
- Create: `tests/assets/lint-all-bundled.test.mjs`

- [ ] **Step 1: Write the gate test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINTER = join(ROOT, 'skills/authoring-workflows/scripts/validate-workflow.mjs');
const dirs = ['skills/authoring-workflows/assets/templates', 'skills/authoring-workflows/assets/examples'];

for (const d of dirs) {
  let files = [];
  try { files = readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.js')); } catch { /* dir not yet created */ }
  for (const f of files) {
    test(`bundled ${d}/${f} passes the linter`, () => {
      execFileSync('node', [LINTER, join(ROOT, d, f)]); // throws on non-zero exit
    });
  }
}
```

- [ ] **Step 2: Run — passes vacuously (no .js yet)**

Run: `node --test tests/assets/lint-all-bundled.test.mjs`
Expected: PASS (0 sub-tests; dirs absent → skipped).

- [ ] **Step 3: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add tests/assets/lint-all-bundled.test.mjs
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "test(assets): lint-gate for all bundled workflow .js"
```

### Task 3.2: Templates (5 control-flow skeletons)

Each template: top docstring with `用途 / 结构 / 填什么 / 对应决策树分支`, then a minimal valid workflow skeleton with **placeholder** prompts. Must pass the linter (so: meta-first, pure-literal meta, no determinism/escape, parallel uses thunks).

**Files:** Create all five under `skills/authoring-workflows/assets/templates/`.

- [ ] **Step 1: Write `fan-out.js`**

```javascript
export const meta = {
  name: 'fan-out',
  description: 'Run N independent tasks concurrently and collect all results (barrier).',
  phases: [{ title: 'Fan out' }],
}
// USE WHEN: tasks are independent AND you need ALL results before the next step.
// SHAPE: parallel([...thunks]) — a BARRIER: awaits every thunk; a thrown thunk → null.
// FILL: the work list + the per-item prompt + (optional) schema.
// DECISION-TREE: "independent tasks, need all results together" → fan-out.
const items = args ?? ['ITEM_A', 'ITEM_B', 'ITEM_C']
const results = await parallel(items.map((it) => () =>
  agent(`TODO: do the work for ${it}`, { phase: 'Fan out' })
))
return results.filter(Boolean)
```

- [ ] **Step 2: Write `pipeline.js`**

```javascript
export const meta = {
  name: 'pipeline',
  description: 'Stream each item through multiple stages independently (no barrier — the default).',
  phases: [{ title: 'Stage 1' }, { title: 'Stage 2' }],
}
// USE WHEN: multi-stage work where item A can reach stage 2 while item B is still in stage 1.
// SHAPE: pipeline(items, stage1, stage2, ...) — NO barrier between stages.
// FILL: items + each stage's prompt; later stages receive (prevResult, originalItem, index).
// DECISION-TREE: "multi-stage, stages need not synchronize" → pipeline (prefer this by default).
const items = args ?? ['ITEM_A', 'ITEM_B']
const out = await pipeline(items,
  (it) => agent(`TODO stage 1 for ${it}`, { phase: 'Stage 1' }),
  (prev, it) => agent(`TODO stage 2 for ${it} using ${JSON.stringify(prev)}`, { phase: 'Stage 2' }),
)
return out.filter(Boolean)
```

- [ ] **Step 3: Write `loop-until-budget.js`**

```javascript
export const meta = {
  name: 'loop-until-budget',
  description: 'Keep spawning work until the turn token budget is nearly spent.',
  phases: [{ title: 'Accumulate' }],
}
// USE WHEN: depth should scale to the user's "+Nk" budget directive (unknown ideal count).
// SHAPE: while (budget.total && budget.remaining() > RESERVE) { ... }
// GUARD: budget.total is null when no target set → loop would never end; the guard prevents that.
// FILL: the per-round prompt + schema + the RESERVE headroom.
const RESERVE = 50_000
const found = []
while (budget.total && budget.remaining() > RESERVE) {
  const r = await agent('TODO: produce the next batch of findings', { phase: 'Accumulate' })
  found.push(r)
  log(`${found.length} batches, ${Math.round(budget.remaining() / 1000)}k left`)
}
return found
```

- [ ] **Step 4: Write `loop-until-dry.js`**

```javascript
export const meta = {
  name: 'loop-until-dry',
  description: 'Discovery loop: keep finding until K consecutive rounds surface nothing new.',
  phases: [{ title: 'Discover' }],
}
// USE WHEN: unknown-size discovery (find all bugs / all call sites). Counters miss the tail; dry-rounds don't.
// SHAPE: dedup against a `seen` set; stop after DRY_LIMIT empty rounds.
// FILL: the finder prompt + the key() that identifies a unique item.
const DRY_LIMIT = 2
const seen = new Set(), all = []
let dry = 0
while (dry < DRY_LIMIT) {
  const r = await agent('TODO: find items not yet in the seen set', { phase: 'Discover', schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] } })
  const fresh = (r.items ?? []).filter((x) => !seen.has(x))
  if (fresh.length === 0) { dry++; continue }
  dry = 0
  fresh.forEach((x) => { seen.add(x); all.push(x) })
  log(`+${fresh.length} (total ${all.length})`)
}
return all
```

- [ ] **Step 5: Write `scout-then-fanout.js`**

```javascript
export const meta = {
  name: 'scout-then-fanout',
  description: 'Discover the work-list with one scout agent, then fan out / pipeline over it.',
  phases: [{ title: 'Scout' }, { title: 'Process' }],
}
// USE WHEN: you do not know the work-list before the task — the most common real entry shape.
// SHAPE: one scout returns the list → pipeline/parallel over it. (Often you scout inline in the
//        main thread instead; this template is the in-workflow version.)
// FILL: the scout prompt + schema (must return a list) + the per-item processing prompt.
const scout = await agent('TODO: enumerate the work items as a JSON list', {
  phase: 'Scout',
  schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] },
})
const out = await pipeline(scout.items ?? [],
  (it) => agent(`TODO: process ${it}`, { phase: 'Process' }),
)
return out.filter(Boolean)
```

- [ ] **Step 6: Run the lint gate**

Run: `node --test tests/assets/lint-all-bundled.test.mjs`
Expected: PASS (5 template sub-tests).

- [ ] **Step 7: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add skills/authoring-workflows/assets/templates/
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(skill-b): 5 control-flow templates (linter-passing)"
```

### Task 3.3: Examples (4 complete runnable workflows)

Each is a single self-contained `.js` with **real** prompts + schemas + verification, embodying one task archetype. Must pass the linter.

**Files:** Create all four under `skills/authoring-workflows/assets/examples/`.

- [ ] **Step 1: Write `review-adversarial-verify.js`** — dimensions → find → per-finding adversarial verify (pipeline + per-finding fan-out). Mirror the canonical Workflow-tool review pattern.

```javascript
export const meta = {
  name: 'review-adversarial-verify',
  description: 'Review changed code across dimensions; adversarially verify each finding before reporting.',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}
const DIMENSIONS = [
  { key: 'bugs', prompt: 'Find correctness bugs in the changed files. Return findings[].' },
  { key: 'security', prompt: 'Find security issues in the changed files. Return findings[].' },
  { key: 'perf', prompt: 'Find performance regressions in the changed files. Return findings[].' },
]
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object',
  properties: { title: { type: 'string' }, file: { type: 'string' }, detail: { type: 'string' } },
  required: ['title', 'file'] } } }, required: ['findings'] }
const VERDICT = { type: 'object', properties: { isReal: { type: 'boolean' }, why: { type: 'string' } }, required: ['isReal'] }

const results = await pipeline(DIMENSIONS,
  (d) => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS }),
  (review, d) => parallel((review.findings ?? []).map((f) => () =>
    agent(`Adversarially verify this ${d.key} finding — try to REFUTE it. Default isReal=false if unsure:\n${JSON.stringify(f)}`,
      { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT })
      .then((v) => ({ ...f, dimension: d.key, verdict: v })))),
)
return results.flat().filter(Boolean).filter((f) => f.verdict?.isReal)
```

- [ ] **Step 2: Write `design-judge-panel.js`** — N independent approaches → parallel judges → synthesize from winner.

```javascript
export const meta = {
  name: 'design-judge-panel',
  description: 'Generate N independent design approaches, score with a judge panel, synthesize from the winner.',
  phases: [{ title: 'Propose' }, { title: 'Judge' }, { title: 'Synthesize' }],
}
const ANGLES = ['MVP-first (smallest shippable)', 'risk-first (de-risk the unknowns)', 'user-first (best UX regardless of cost)']
const PROPOSAL = { type: 'object', properties: { summary: { type: 'string' }, tradeoffs: { type: 'string' } }, required: ['summary'] }
const SCORE = { type: 'object', properties: { score: { type: 'number' }, rationale: { type: 'string' } }, required: ['score'] }

const proposals = await parallel(ANGLES.map((a) => () =>
  agent(`Design an approach to <GOAL> from this angle: ${a}. Return summary + tradeoffs.`, { phase: 'Propose', schema: PROPOSAL })
    .then((p) => ({ angle: a, ...p }))))
const scored = await parallel(proposals.filter(Boolean).map((p) => () =>
  agent(`Score this approach 0-10 for <GOAL>:\n${JSON.stringify(p)}`, { phase: 'Judge', schema: SCORE })
    .then((s) => ({ ...p, score: s.score }))))
const ranked = scored.filter(Boolean).sort((a, b) => b.score - a.score)
const winner = ranked[0]
const synthesis = await agent(
  `Synthesize a final design for <GOAL> based primarily on the winner, grafting the best ideas from runners-up.\nWINNER:\n${JSON.stringify(winner)}\nOTHERS:\n${JSON.stringify(ranked.slice(1))}`,
  { phase: 'Synthesize' })
return { winner, synthesis }
```

- [ ] **Step 3: Write `research-multimodal-sweep.js`** — N search angles → dedup barrier → deep-read → completeness critic.

```javascript
export const meta = {
  name: 'research-multimodal-sweep',
  description: 'Sweep a question from several search angles, dedup, deep-read, then critique for completeness.',
  phases: [{ title: 'Sweep' }, { title: 'Deep-read' }, { title: 'Critique' }],
}
const ANGLES = ['by keyword/grep', 'by entity/symbol', 'by structure/architecture', 'by history/changelog']
const HITS = { type: 'object', properties: { hits: { type: 'array', items: { type: 'string' } } }, required: ['hits'] }

// barrier IS correct here: we must dedup across ALL angles before the expensive deep-read.
const swept = await parallel(ANGLES.map((a) => () =>
  agent(`Research <QUESTION> ${a}. Return concrete source refs as hits[].`, { phase: 'Sweep', schema: HITS })))
const deduped = [...new Set(swept.filter(Boolean).flatMap((r) => r.hits ?? []))]
const reads = await pipeline(deduped,
  (ref) => agent(`Deep-read ${ref} and extract what answers <QUESTION>.`, { phase: 'Deep-read' }))
const critique = await agent(
  `Given these findings for <QUESTION>, what is MISSING — an angle not swept, a claim unverified, a source unread?\n${JSON.stringify(reads.filter(Boolean))}`,
  { phase: 'Critique' })
return { findings: reads.filter(Boolean), gaps: critique }
```

- [ ] **Step 4: Write `migrate-discover-transform-verify.js`** — discover sites → worktree-isolated transform → gate verify. The only example using `isolation: 'worktree'`.

```javascript
export const meta = {
  name: 'migrate-discover-transform-verify',
  description: 'Discover every migration site, transform each in an isolated worktree, verify with a gate.',
  phases: [{ title: 'Discover' }, { title: 'Transform' }, { title: 'Verify' }],
}
const SITES = { type: 'object', properties: { sites: { type: 'array', items: { type: 'string' } } }, required: ['sites'] }
const VERIFY = { type: 'object', properties: { pass: { type: 'boolean' }, notes: { type: 'string' } }, required: ['pass'] }

const found = await agent('Enumerate every file/site that needs the <MIGRATION>. Return sites[].', { phase: 'Discover', schema: SITES })
// pipeline: each site transforms in its OWN worktree (parallel edits won't conflict), then verifies.
const out = await pipeline(found.sites ?? [],
  (site) => agent(`Apply <MIGRATION> to ${site}. Commit in your worktree.`, { phase: 'Transform', isolation: 'worktree' }),
  (prev, site) => agent(`Verify the <MIGRATION> at ${site} (run the gate). Return pass.\n${JSON.stringify(prev)}`,
    { phase: 'Verify', schema: VERIFY }).then((v) => ({ site, ...v })))
return out.filter(Boolean)
```

- [ ] **Step 5: Run the lint gate**

Run: `node --test tests/assets/lint-all-bundled.test.mjs`
Expected: PASS (5 templates + 4 examples = 9 sub-tests).

- [ ] **Step 6: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add skills/authoring-workflows/assets/examples/
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(skill-b): 4 complete workflow examples (linter-passing)"
```

### Task 3.4: Skill B references + SKILL.md

Content is authored prose, not code. Authority sources are cited per file; render each with the stated structure + acceptance.

**Files:**
- Create: `skills/authoring-workflows/references/mechanism.md`
- Create: `skills/authoring-workflows/references/patterns.md`
- Create: `skills/authoring-workflows/references/api-reference.md`
- Create: `skills/authoring-workflows/SKILL.md`

- [ ] **Step 1: Write `references/mechanism.md`** — adapt `docs/research/01-claude-code-dynamic-workflow-mechanism.md` into a skill reference. Required content: the **confirmed-contract vs internal-unknowns** split; the 7 primitives' true semantics (`agent`/`parallel`/`pipeline`/`phase`/`log`/`budget`/`workflow`/`args`); **`parallel`(barrier) vs `pipeline`(streaming)** with the smell-test; determinism三禁 + why (resume journal); resume = "longest unchanged prefix"; hard caps (16 concurrent / 1000 total / 4096 per call / 512 KB). Acceptance: a reader can answer "will this run in parallel?" and "why did my Date.now() break resume?" without guessing.

- [ ] **Step 2: Write `references/patterns.md`** — one section per pattern: fan-out+synthesize, pipeline-by-default, adversarial-verify, perspective-diverse-verify, judge-panel, loop-until-{count,budget,dry}, multi-modal-sweep, completeness-critic, and the deferred niche shapes (tournament-bracket / self-repair-loop / staged-escalation) **as prose only**. Each: *when to use* + a minimal skeleton + which `assets/` template or example demonstrates it. Acceptance: every bundled template/example is referenced from here; the 4 deferred niche shapes appear as prose with no separate file.

- [ ] **Step 3: Write `references/api-reference.md`** — signature quick-ref for every primitive: `agent(prompt, opts)` (opts: label/phase/schema/model/isolation/agentType; returns string or validated object; null on skip), `parallel`/`pipeline`/`phase`/`log`/`budget`/`workflow`/`args`; the **cache-key四要素** (prompt + opts determine resume identity); failure semantics (thunk throw → null; stage throw → drops item). Acceptance: matches the Workflow tool contract; no invented options.

- [ ] **Step 4: Write `SKILL.md`** with YAML frontmatter:

```markdown
---
name: authoring-workflows
description: Use when writing a Claude Code dynamic-workflow script — picks the right paradigm (fan-out/pipeline/loop), validates the script with a runnable linter before running, and points to mechanism/patterns/api references plus templates and examples.
---
```

Body (concise, always-resident): (1) **honest test** — does this task even need a workflow? (a two-line bugfix doesn't need a five-agent panel); (2) **paradigm decision tree** — independent+need-all → fan-out; multi-stage → pipeline (default); unknown count → loop-until-{budget,dry}; unknown work-list → scout-then-fanout; (3) **author flow** — draft from a `assets/templates/` skeleton → **run `scripts/validate-workflow.mjs <file>` and fix all ERRORs before launching** (deterministic gate, not prose self-check); (4) **index** — "read `references/mechanism.md` before trusting any belief about the engine; `patterns.md` for the shape; `api-reference.md` for signatures; copy from `assets/templates/` or `assets/examples/`." Acceptance: frontmatter `name`+`description` present; mentions the linter command; the structure test (Phase 8) passes.

- [ ] **Step 5: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add skills/authoring-workflows/SKILL.md skills/authoring-workflows/references/
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "docs(skill-b): SKILL.md + mechanism/patterns/api references"
```

---

## Phase 4 — Board protocol (schema + template + worked example)

The board is the orchestration archive. The bootstrap hook (Phase 5) reads `board.template.json`, so it must exist first.

### Task 4.1: `board.template.json` + `board.example.json` + validity test

**Files:**
- Create: `skills/orchestrating-to-completion/assets/board.template.json`
- Create: `skills/orchestrating-to-completion/assets/board.example.json`
- Create: `tests/content/board.test.mjs`

- [ ] **Step 1: Write the failing test** `tests/content/board.test.mjs`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const A = 'skills/orchestrating-to-completion/assets';
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('board.template.json is the empty skeleton with the pinned schema + empty goal', () => {
  const b = read(`${A}/board.template.json`);
  assert.equal(b.schema, 'cc-master/v1');
  assert.equal(b.goal, '');            // bootstrap leaves goal empty; agent fills it
  assert.equal(b.owner.active, true);
  assert.deepEqual(b.tasks, []);
  assert.ok('git' in b && 'log' in b);
});

test('board.example.json is a valid worked board with ≥1 task carrying id/status/deps', () => {
  const b = read(`${A}/board.example.json`);
  assert.equal(b.schema, 'cc-master/v1');
  assert.ok(b.tasks.length >= 1);
  for (const t of b.tasks) { assert.ok(t.id && t.status); assert.ok(Array.isArray(t.deps)); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/content/board.test.mjs`
Expected: FAIL (files missing).

- [ ] **Step 3: Write `board.template.json`** (the skeleton the bootstrap hook writes — goal empty, no tasks)

```json
{
  "schema": "cc-master/v1",
  "goal": "",
  "owner": { "active": true, "session_id": "", "heartbeat": "" },
  "git": { "worktree": "", "branch": "" },
  "wip_limit": 4,
  "tasks": [],
  "log": []
}
```

- [ ] **Step 4: Write `board.example.json`** (worked teaching board — mirrors spec §3 example)

```json
{
  "schema": "cc-master/v1",
  "goal": "Migrate user_cognition's 9 domains to the new CognitionRecord schema",
  "owner": { "active": true, "session_id": "abc123", "heartbeat": "2026-06-05T12:30Z" },
  "git": { "worktree": "/repo/.worktrees/cog-migrate", "branch": "feat/cog-migrate" },
  "wip_limit": 4,
  "tasks": [
    { "id": "T0", "status": "done", "deps": [], "artifact": "commit a1b2c3", "verified": true },
    { "id": "T1", "status": "in_flight", "deps": ["T0"], "mechanism": "sub-agent", "handle": "bg-7a", "dispatched_at": "12:18Z" },
    { "id": "T3", "status": "ready", "deps": ["T0"] },
    { "id": "T9", "status": "blocked", "deps": ["T1"], "blocked_on": "T1" },
    { "id": "D1", "status": "blocked", "deps": [], "blocked_on": "user", "title": "Split the PR into two?" },
    { "id": "F1", "status": "ready", "deps": [], "kind": "fill-work", "justification": "produces-reusable-artifact", "title": "Pre-draft the PR description skeleton" }
  ],
  "log": []
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/content/board.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add skills/orchestrating-to-completion/assets/ tests/content/board.test.mjs
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(board): template skeleton + worked example + validity test"
```

---

## Phase 5 — Hooks (the bootstrap guarantee; full bash TDD)

All three hooks self-gate on the marker. Paths resolve `CLAUDE_PROJECT_DIR` with a `pwd` fallback and `CLAUDE_PLUGIN_ROOT` with a script-relative fallback.

### Task 5.1: `bootstrap-board.sh` (UserPromptSubmit) — TDD

**Files:**
- Create: `tests/hooks/test_bootstrap-board.sh`
- Create: `hooks/scripts/bootstrap-board.sh`

- [ ] **Step 1: Write the failing test** `tests/hooks/test_bootstrap-board.sh`

```bash
#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# Case A: prompt contains the command-name sentinel → board + marker created, context injected, rc 0
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"/cc-master:as-master-orchestrator migrate the thing"}' "$P"
assert_eq 0 "$HOOK_RC" "bootstrap exits 0"
assert_file "$P/.claude/cc-master/board.json" "board created"
assert_file "$P/.claude/cc-master/active" "marker created"
assert_contains "$HOOK_OUT" "board" "injects context mentioning board"
rm -rf "$P"

# Case B: prompt contains the body sentinel (expanded-body case) → also fires
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"...\n<!-- cc-master:bootstrap:v1 -->\n..."}' "$P"
assert_file "$P/.claude/cc-master/board.json" "board created via body sentinel"
rm -rf "$P"

# Case C: unrelated prompt → no board, no marker, rc 0 (silent no-op)
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"what files changed today?"}' "$P"
assert_eq 0 "$HOOK_RC" "no-op exits 0"
assert_no_file "$P/.claude/cc-master/board.json" "no board for unrelated prompt"
rm -rf "$P"

# Case D: already-active board is NOT clobbered (idempotent)
P="$(make_project)"; mkdir -p "$P/.claude/cc-master"
printf '{"schema":"cc-master/v1","goal":"EXISTING","owner":{"active":true},"tasks":[{"id":"T0","status":"ready","deps":[]}]}' > "$P/.claude/cc-master/board.json"
touch "$P/.claude/cc-master/active"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"/cc-master:as-master-orchestrator again"}' "$P"
assert_contains "$(cat "$P/.claude/cc-master/board.json")" "EXISTING" "existing board preserved"
rm -rf "$P"

finish
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tests/hooks/test_bootstrap-board.sh`
Expected: FAIL (script missing).

- [ ] **Step 3: Write `hooks/scripts/bootstrap-board.sh`**

```bash
#!/usr/bin/env bash
# UserPromptSubmit hook: when the as-master-orchestrator command is invoked, deterministically
# create the board skeleton + active marker, then inject context telling the agent to fill the DAG.
# Self-gating note: this hook is the ONE that activates the plugin, so it does NOT gate on the marker.
set -uo pipefail

stdin="$(cat)"
# Dual-sentinel: match either the raw command name OR the expanded-body comment (we don't know which we see).
case "$stdin" in
  *cc-master:as-master-orchestrator*|*"cc-master:bootstrap:v1"*) : ;;
  *) exit 0 ;;   # unrelated prompt → silent no-op
esac

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
BOARD_DIR="$PROJECT_DIR/.claude/cc-master"
BOARD="$BOARD_DIR/board.json"
MARKER="$BOARD_DIR/active"
TEMPLATE="$PLUGIN_ROOT/skills/orchestrating-to-completion/assets/board.template.json"

mkdir -p "$BOARD_DIR"
# Idempotent: never clobber an existing active board.
if [ ! -f "$BOARD" ]; then
  if [ -f "$TEMPLATE" ]; then cp "$TEMPLATE" "$BOARD"; else
    printf '{"schema":"cc-master/v1","goal":"","owner":{"active":true,"session_id":"","heartbeat":""},"git":{"worktree":"","branch":""},"wip_limit":4,"tasks":[],"log":[]}\n' > "$BOARD"
  fi
fi
touch "$MARKER"

# Inject context (UserPromptSubmit additionalContext form). The agent fills goal + DAG.
ctx='cc-master board is ready at .claude/cc-master/board.json. You are now the master orchestrator. Decompose the goal into a dependency DAG and write the tasks[] into the board, then invoke the orchestrating-to-completion skill and run the decision program.'
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed 's/^/"/; s/$/"/')"
exit 0
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tests/hooks/test_bootstrap-board.sh`
Expected: `passed=N failed=0`.

- [ ] **Step 5: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add hooks/scripts/bootstrap-board.sh tests/hooks/test_bootstrap-board.sh
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(hooks): bootstrap-board UserPromptSubmit (dual-sentinel, idempotent, TDD)"
```

### Task 5.2: `verify-board.sh` (Stop) — TDD

Behavior: self-gate on marker; if board missing/empty → **hard block** (bootstrap backstop, the sanctioned exception); if a `ready` task exists → **one-shot permissive nudge** block (reason explicitly authorizes stopping after the agent confirms all paths are waiting); else (all in_flight/blocked/done) → exit 0 (legitimate waiting must NOT be blocked — 镜头4).

**Files:**
- Create: `tests/hooks/test_verify-board.sh`
- Create: `hooks/scripts/verify-board.sh`

- [ ] **Step 1: Write the failing test** `tests/hooks/test_verify-board.sh`

```bash
#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"
mkboard() { mkdir -p "$1/.claude/cc-master"; printf '%s' "$3" > "$1/.claude/cc-master/board.json"; [ "$2" = active ] && touch "$1/.claude/cc-master/active" || true; }

# Case A: no marker → silent allow (exit 0, no block)
P="$(make_project)"
run_hook "hooks/scripts/verify-board.sh" '{}' "$P"
assert_eq 0 "$HOOK_RC" "no marker → rc 0"
assert_not_contains "$HOOK_OUT" "block" "no marker → no block"
rm -rf "$P"

# Case B: active but board missing → hard block (bootstrap backstop)
P="$(make_project)"; mkdir -p "$P/.claude/cc-master"; touch "$P/.claude/cc-master/active"
run_hook "hooks/scripts/verify-board.sh" '{}' "$P"
assert_contains "$HOOK_OUT" "block" "missing board → block"
rm -rf "$P"

# Case C: active, board has a ready task → permissive nudge block
P="$(make_project)"
mkboard "$P" active '{"schema":"cc-master/v1","tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_hook "hooks/scripts/verify-board.sh" '{}' "$P"
assert_contains "$HOOK_OUT" "block" "ready task → nudge block"
assert_contains "$HOOK_OUT" "decision" "nudge emits decision json"
rm -rf "$P"

# Case D: active, all tasks in_flight/blocked → allow (legitimate waiting)
P="$(make_project)"
mkboard "$P" active '{"schema":"cc-master/v1","tasks":[{"id":"T1","status":"in_flight","deps":[]},{"id":"T2","status":"blocked","deps":["T1"]}]}'
run_hook "hooks/scripts/verify-board.sh" '{}' "$P"
assert_eq 0 "$HOOK_RC" "all-waiting → rc 0"
assert_not_contains "$HOOK_OUT" "\"block\"" "all-waiting → no block"
rm -rf "$P"

finish
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tests/hooks/test_verify-board.sh`
Expected: FAIL (script missing).

- [ ] **Step 3: Write `hooks/scripts/verify-board.sh`**

```bash
#!/usr/bin/env bash
# Stop hook: backstop the bootstrap guarantee and nudge against abandoning actionable work.
# Soft by design: the ONLY hard block is "board missing/invalid right after bootstrap".
# Legitimate waiting (all tasks in_flight/blocked) is NEVER blocked (镜头4).
set -uo pipefail
cat >/dev/null  # drain stdin

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
BOARD_DIR="$PROJECT_DIR/.claude/cc-master"
MARKER="$BOARD_DIR/active"
BOARD="$BOARD_DIR/board.json"

[ -f "$MARKER" ] || exit 0   # self-gate: plugin dormant

emit_block() { # $1 reason
  printf '{"decision":"block","reason":%s}\n' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed 's/^/"/; s/$/"/')"
  exit 0
}

# Bootstrap backstop: active marker but no board, or a board with zero tasks → hard block.
task_count=0
[ -f "$BOARD" ] && task_count="$(grep -cE '"status"[[:space:]]*:' "$BOARD" 2>/dev/null || echo 0)"
if [ ! -f "$BOARD" ] || [ "$task_count" -eq 0 ]; then
  emit_block 'cc-master board is active but has no tasks. Decompose the goal into a dependency DAG and write tasks[] into .claude/cc-master/board.json before ending.'
fi

# Permissive nudge: a ready (actionable, un-dispatched) task remains.
if grep -qE '"status"[[:space:]]*:[[:space:]]*"ready"' "$BOARD" 2>/dev/null; then
  emit_block 'You still have ready (actionable) tasks on the board. Run the decision program: dispatch them within the WIP limit, surface any user-decisions, or pick legitimate fill-work. If you have genuinely confirmed every remaining path is waiting on in-flight work or the user, end again to proceed.'
fi

exit 0   # all remaining work is in_flight/blocked/done → legitimate waiting, allow stop
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tests/hooks/test_verify-board.sh`
Expected: `passed=N failed=0`.

- [ ] **Step 5: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add hooks/scripts/verify-board.sh tests/hooks/test_verify-board.sh
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(hooks): verify-board Stop backstop + permissive ready-work nudge (TDD)"
```

### Task 5.3: `reinject.sh` (SessionStart) — TDD

Behavior: self-gate; if active → emit context re-anchoring the orchestrator role + best-effort goal grep + instruction to re-read the board and resume the decision program.

**Files:**
- Create: `tests/hooks/test_reinject.sh`
- Create: `hooks/scripts/reinject.sh`

- [ ] **Step 1: Write the failing test** `tests/hooks/test_reinject.sh`

```bash
#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# Case A: no marker → silent no-op
P="$(make_project)"
run_hook "hooks/scripts/reinject.sh" '{"source":"compact"}' "$P"
assert_eq 0 "$HOOK_RC" "no marker → rc 0"
assert_eq "" "$HOOK_OUT" "no marker → no output"
rm -rf "$P"

# Case B: active → re-injects role + goal + board path
P="$(make_project)"; mkdir -p "$P/.claude/cc-master"; touch "$P/.claude/cc-master/active"
printf '{"schema":"cc-master/v1","goal":"MIGRATE THE COGNITION SCHEMA","tasks":[{"id":"T1","status":"ready","deps":[]}]}' > "$P/.claude/cc-master/board.json"
run_hook "hooks/scripts/reinject.sh" '{"source":"compact"}' "$P"
assert_contains "$HOOK_OUT" "MIGRATE THE COGNITION SCHEMA" "re-injects the goal"
assert_contains "$HOOK_OUT" "board.json" "points at the board"
assert_contains "$HOOK_OUT" "orchestrator" "re-anchors the role"
rm -rf "$P"

finish
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash tests/hooks/test_reinject.sh`
Expected: FAIL (script missing).

- [ ] **Step 3: Write `hooks/scripts/reinject.sh`**

```bash
#!/usr/bin/env bash
# SessionStart hook (startup|resume|compact): re-anchor the orchestrator role after compaction/resume.
set -uo pipefail
cat >/dev/null  # drain stdin

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
BOARD_DIR="$PROJECT_DIR/.claude/cc-master"
MARKER="$BOARD_DIR/active"
BOARD="$BOARD_DIR/board.json"

[ -f "$MARKER" ] || exit 0   # self-gate

# Best-effort goal extraction (jq-free): pull the first "goal":"..." value.
goal=""
[ -f "$BOARD" ] && goal="$(sed -n 's/.*"goal"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BOARD" | head -1)"
[ -n "$goal" ] || goal="(see board)"

ctx="You are the cc-master master orchestrator for: ${goal}. Your board is at .claude/cc-master/board.json — re-read it now to recover task state, then invoke the orchestrating-to-completion skill and continue the decision program. Do not restart work that is already done/verified; integrate any completed background results first."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed 's/^/"/; s/$/"/')"
exit 0
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash tests/hooks/test_reinject.sh`
Expected: `passed=N failed=0`.

- [ ] **Step 5: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add hooks/scripts/reinject.sh tests/hooks/test_reinject.sh
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(hooks): reinject SessionStart role re-anchor (TDD)"
```

### Task 5.4: `hooks.json` registration + content test

**Files:**
- Create: `hooks/hooks.json`
- Modify: `tests/content/structure.test.mjs` (append hooks.json checks)

- [ ] **Step 1: Append failing test** to `tests/content/structure.test.mjs`

```javascript
test('hooks.json registers all 3 hooks via plugin-root paths', () => {
  const h = JSON.parse(read('hooks/hooks.json'));
  assert.ok(h.hooks.UserPromptSubmit, 'UserPromptSubmit registered');
  assert.ok(h.hooks.Stop, 'Stop registered');
  assert.ok(h.hooks.SessionStart, 'SessionStart registered');
  const all = JSON.stringify(h);
  for (const s of ['bootstrap-board.sh', 'verify-board.sh', 'reinject.sh']) assert.match(all, new RegExp(s));
  assert.match(all, /CLAUDE_PLUGIN_ROOT/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/content/structure.test.mjs`
Expected: FAIL (hooks.json missing).

- [ ] **Step 3: Write `hooks/hooks.json`**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/bootstrap-board.sh" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/verify-board.sh" }] }
    ],
    "SessionStart": [
      { "matcher": "startup|resume|compact", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/reinject.sh" }] }
    ]
  }
}
```

- [ ] **Step 4: Run to verify it passes + make scripts executable**

Run: `chmod +x hooks/scripts/*.sh && node --test tests/content/structure.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add hooks/hooks.json tests/content/structure.test.mjs
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master update-index --chmod=+x hooks/scripts/bootstrap-board.sh hooks/scripts/verify-board.sh hooks/scripts/reinject.sh
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(hooks): register 3 hooks in hooks.json + content test"
```

---

## Phase 6 — Commands (sentinel-bearing bootstrap + status + stop)

### Task 6.1: `as-master-orchestrator.md` + sentinel-consistency test

The command body MUST contain the body sentinel `<!-- cc-master:bootstrap:v1 -->` (the exact string `bootstrap-board.sh` greps). A test pins this contract.

**Files:**
- Create: `commands/as-master-orchestrator.md`
- Modify: `tests/content/structure.test.mjs` (append sentinel-consistency check)

- [ ] **Step 1: Append failing test** to `tests/content/structure.test.mjs`

```javascript
test('sentinel consistency: command body carries the exact string the bootstrap hook greps', () => {
  const cmd = read('commands/as-master-orchestrator.md');
  const hook = read('hooks/scripts/bootstrap-board.sh');
  assert.match(cmd, /<!-- cc-master:bootstrap:v1 -->/, 'command embeds body sentinel');
  assert.match(hook, /cc-master:bootstrap:v1/, 'hook greps body sentinel');
  assert.match(hook, /cc-master:as-master-orchestrator/, 'hook also greps command-name sentinel');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/content/structure.test.mjs`
Expected: FAIL (command missing).

- [ ] **Step 3: Write `commands/as-master-orchestrator.md`**

```markdown
---
description: Initialize this session as a cc-master long-horizon orchestrator for the given goal.
argument-hint: <goal>
---
<!-- cc-master:bootstrap:v1 -->

You are being initialized as a **master orchestrator** for a long-horizon goal:

**$ARGUMENTS**

A board has been (or will be) created at `.claude/cc-master/board.json` by the bootstrap hook. Do this now, in order:

1. **Invoke the `orchestrating-to-completion` skill** — it carries your identity, the seven lenses, the red lines, the decision program, and the board protocol. Internalize it before acting.
2. **Decompose the goal into a dependency DAG** and write it into the board's `tasks[]` (each task: `id`, `status`, `deps`, plus a `title`). Set `owner.session_id` and `git` from your environment, and fill `goal`.
3. **Run the decision program** every turn: reconcile the board, surface anything the user must decide, dispatch ready tasks within the WIP limit using the three background mechanisms (shell / sub-agent / workflow), do legitimate fill-work in waiting windows, verify completed nodes at their endpoints, and flush the board before yielding.

You orchestrate; you do not play every instrument yourself. Dispatch implementation and review to sub-agents and workflows. Keep the front-of-house conversation with the user alive in parallel with background execution.
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/content/structure.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add commands/as-master-orchestrator.md tests/content/structure.test.mjs
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(cmd): as-master-orchestrator bootstrap command + sentinel-consistency test"
```

### Task 6.2: `status.md` + `stop.md`

**Files:**
- Create: `commands/status.md`
- Create: `commands/stop.md`

- [ ] **Step 1: Write `commands/status.md`**

```markdown
---
description: Render a cc-master board summary — progress, blockers, critical path, decisions awaiting the user.
---

Read `.claude/cc-master/board.json` and render a concise status report:

- **Progress**: done / total tasks; list any `done` tasks with their `artifact`.
- **In flight**: each `in_flight` task with its `mechanism`, `handle`, and `dispatched_at`; flag any past the p95 duration for its kind as a hedge candidate.
- **Blocked**: tasks blocked on other tasks vs. blocked on the user (`blocked_on:"user"`) — surface the latter prominently.
- **Critical path**: the chain of `deps` with zero float (longest dependency chain to the goal).
- **Health check**: validate the board's narrow waist — `schema`, `goal`, `owner`, and every task has `id`/`status`/`deps`. Report any violation.

Do not modify the board; this is read-only.
```

- [ ] **Step 2: Write `commands/stop.md`**

```markdown
---
description: Archive the cc-master board and deactivate the orchestrator (does not delete the board).
---

Wind down cc-master orchestration cleanly:

1. Set `owner.active` to `false` in `.claude/cc-master/board.json` (keep the file — it is the audit record; do not delete it).
2. Remove the active marker so the hooks go dormant:

   ```bash
   rm -f .claude/cc-master/active
   ```

3. Give the user a one-paragraph closeout: what finished (with artifacts), what is still in flight, and what remains blocked on them.
```

- [ ] **Step 3: Verify commands are valid markdown with frontmatter** (manual read; the structure test already requires command files to exist for the sentinel test — these two have no machine contract beyond being present).

Run: `ls commands/ && head -3 commands/status.md commands/stop.md`
Expected: both files present with `---` frontmatter.

- [ ] **Step 4: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add commands/status.md commands/stop.md
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "feat(cmd): status + stop commands"
```

---

## Phase 7 — Skill A: `orchestrating-to-completion` (the soul)

Content authority: `docs/spec.md` §6 (philosophy), §7 (decision program), §11 (dispatch framework), §8 (reference outlines), §3 (board). This is prose; render each file with the stated structure + acceptance.

### Task 7.1: `SKILL.md` (always-resident soul — the compaction reload target)

**Files:**
- Create: `skills/orchestrating-to-completion/SKILL.md`

- [ ] **Step 1: Write `SKILL.md`** with frontmatter:

```markdown
---
name: orchestrating-to-completion
description: Use when running a long-horizon (>24h) goal as a master orchestrator — decompose into a dependency DAG, dispatch background work across shell/sub-agent/workflow, keep the main thread productive in waiting windows, verify at endpoints, and survive compaction via a cwd-keyed board.
---
```

Body (transcribe from spec, concise — this is what the SessionStart hook reloads): (1) **Identity creed** (spec §6 信条, verbatim); (2) **Seven lenses** (spec §6 七镜头, all seven, one line each); (3) **Red lines** (spec §6 红线); (4) **Decision program** (spec §7, the 7-step program + the fill-work admission test); (5) **Board protocol essentials** (path, narrow waist, status enum, flush discipline — pointer to `references/board.md` for full); (6) **Reference index** — when to read decomposition / dispatch / board / async-hitl / resume-verify. Acceptance: frontmatter present; all 7 lenses + all 7 decision steps present; the structure test (Phase 8) passes.

- [ ] **Step 2: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add skills/orchestrating-to-completion/SKILL.md
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "docs(skill-a): SKILL.md — identity, lenses, red lines, decision program"
```

### Task 7.2: The 5 references

**Files:**
- Create: `skills/orchestrating-to-completion/references/decomposition.md`
- Create: `skills/orchestrating-to-completion/references/dispatch.md`
- Create: `skills/orchestrating-to-completion/references/board.md`
- Create: `skills/orchestrating-to-completion/references/async-hitl.md`
- Create: `skills/orchestrating-to-completion/references/resume-verify.md`

- [ ] **Step 1: Write `decomposition.md`** — from spec §8 decomposition.md outline + `docs/research/04-*.md` (CPM/work-span/Brent). Required content: goal → task nodes → dependency edges → DAG → topological order; CPM forward/backward pass for ES/EF/LS/LF + float; **float=0 chain = critical path**; parallelism = T₁/T∞ → how many lanes are worth it; granularity tradeoff; **per-node contract** (input deps with pinned upstream artifact / output schema / success predicate / timeout+budget / escalation condition). Acceptance: a reader can turn a goal into a DAG with a critical path and per-node contracts.

- [ ] **Step 2: Write `dispatch.md`** — from spec §11 (the full dispatch framework). Required content: the fractal three altitudes; the **three** background mechanisms only (shell / sub-agent / workflow) with selection criteria (control/synthesis/context, NOT count); intra-vs-inter workflow (axis = lifecycle coupling); re-altitude via escalation (sub-agents don't self-promote — STOP + return escalation result → orchestrator supersedes with a workflow); hybrid + admission control (reserve-on-launch, WIP includes integration burden, concurrency cap = min of the listed limits); node-status routing. **Must not mention agent-teams or scheduled routines** (spec §12). Acceptance: matches spec §11; only the 3 mechanisms appear.

- [ ] **Step 3: Write `board.md`** — from spec §3 (full board protocol). Required content: narrow-waist schema (pinned header + tasks{id,status,deps}); status enum (`ready/in_flight/blocked/done/escalated/failed/stale/uncertain`) and how each routes; flexible edges (agent-shaped, hook-ignored); snapshot storage (Write whole file each turn); cwd-keying; read/write/flush discipline (decision-program step 7); single source of truth (built-in Task* is non-authoritative); supersession as explicit state; the `log` segment for lightweight audit. Acceptance: matches spec §3; the `board.template.json`/`board.example.json` field names are consistent with this doc.

- [ ] **Step 4: Write `async-hitl.md`** — from spec §8 async-hitl.md outline + §6 lenses 4/7. Required content: in-flight tracking via `dispatched_at` → p95 → hedge/degrade; integrate completions on `<task-notification>` → reconcile → unlock newly-ready → dispatch within WIP; the HITL model (user = special async worker; surface user-decisions immediately; user input is an async dependency `blocked_on:"user"`; ready work not depending on the user dispatches anyway; don't自专 on irreversible/outward/directional/final-approval). Acceptance: front-of-house dialogue ∥ background execution is explicit; matches lenses 4 and 7.

- [ ] **Step 5: Write `resume-verify.md`** — from spec §8 resume-verify.md outline + `docs/research/03-*.md` (Joiner loop) + `04-*.md` (content-addressable cache / end-to-end argument). Required content: per-node content-hash = build-system action key → cache hit → reuse artifact → resume = O(changeset); dependency pinning / stale detection → re-run; endpoint verification (orchestrator independently runs the gate + reads the diff; agent self-report is untrustworthy; gate-green is necessary-not-sufficient; null/empty review = not passed); loop convergence (structured FinalResponse vs Replan + max-rounds fuse + dedup-against-seen). Acceptance: matches lenses 6; mirrors the OMNE review discipline.

- [ ] **Step 6: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add skills/orchestrating-to-completion/references/
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "docs(skill-a): decomposition/dispatch/board/async-hitl/resume-verify references"
```

### Task 7.3: SKILL.md frontmatter coverage test (both skills)

**Files:**
- Modify: `tests/content/structure.test.mjs` (append SKILL.md frontmatter checks)

- [ ] **Step 1: Append test**

```javascript
import { readdirSync } from 'node:fs';
test('every SKILL.md has YAML frontmatter with name + description', () => {
  const skillDirs = readdirSync(join(ROOT, 'skills'));
  for (const d of skillDirs) {
    const md = read(`skills/${d}/SKILL.md`);
    assert.match(md, /^---\n[\s\S]*?^name:\s*\S+/m, `${d}/SKILL.md has name`);  // ^name: (m-flag): name: may sit directly under --- with no blank line
    assert.match(md, /\ndescription:\s*\S+/m, `${d}/SKILL.md has description`);
  }
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `node --test tests/content/structure.test.mjs`
Expected: PASS (both SKILL.md files exist with frontmatter).

- [ ] **Step 3: Commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add tests/content/structure.test.mjs
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "test(content): SKILL.md frontmatter coverage for both skills"
```

---

## Phase 8 — Integration, install, and the empirical smoke-test

### Task 8.1: Full test run + install symlink

**Files:** none (verification + local install)

- [ ] **Step 1: Run the whole suite**

Run: `./run-tests.sh`
Expected: "ALL TESTS PASSED" — every hook test + linter + bundled-asset lint + content/board tests green.

- [ ] **Step 2: Install for live testing (symlink)**

```bash
ln -s /Users/panqiwei/Dev/repos/nemori-ai/cc-master ~/.claude/plugins/cc-master
```
Then restart Claude Code (or run `/reload-plugins` if available). Confirm `/cc-master:as-master-orchestrator`, `/cc-master:status`, `/cc-master:stop` appear.

### Task 8.2: The §13 bootstrap smoke-test (resolve the one CC unknown)

This empirically resolves what `bootstrap-board.sh` actually receives. The dual-sentinel design means the plugin already works either way; this confirms which branch fires and that `CLAUDE_PROJECT_DIR` is set.

- [ ] **Step 1: Add a temporary debug line** to `bootstrap-board.sh` (first line after `stdin="$(cat)"`):

```bash
printf '%s\n' "SMOKE stdin=[$stdin] pwd=[$(pwd)] CPD=[${CLAUDE_PROJECT_DIR:-UNSET}] CPR=[${CLAUDE_PLUGIN_ROOT:-UNSET}]" >> /tmp/cc-master-smoke.log
```

- [ ] **Step 2: In a real Claude Code session**, run `/cc-master:as-master-orchestrator test goal` in some project dir.

- [ ] **Step 3: Inspect** `/tmp/cc-master-smoke.log`:
  - Does `stdin` contain the **raw** `/cc-master:as-master-orchestrator` text, or the **expanded body** (with `<!-- cc-master:bootstrap:v1 -->`)? Record which.
  - Is `CLAUDE_PROJECT_DIR` set, and does it equal the project cwd?
  - Is `CLAUDE_PLUGIN_ROOT` set to the plugin dir?

- [ ] **Step 4: If `CLAUDE_PROJECT_DIR` is UNSET**, confirm the `pwd` fallback wrote the board to the right place; if `pwd` is wrong in hook context, document the corrected resolution and adjust all three hooks + re-run `./run-tests.sh`.

- [ ] **Step 5: Remove the debug line** and commit any correction:

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add -A
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "test: resolve bootstrap smoke-test (prompt format / cwd / plugin-root)"
```

### Task 8.3: End-to-end manual acceptance (against spec §14)

- [ ] **Step 1:** Verify the spec §14 acceptance criteria manually:
  - The 3 commands work; `as-master-orchestrator` deterministically creates the board (even if the agent doesn't cooperate — the hook builds the skeleton; the Stop backstop blocks an empty board).
  - After a `/compact`, the SessionStart hook re-injects role + board and the agent resumes without losing the role or idling.
  - The two skills are complete, self-contained, non-overlapping (Skill A = main-thread orchestration; Skill B = inside-the-script authoring).
  - Philosophy + decision program + dispatch framework are present as specified.
  - Closing and re-opening the session resumes from the cwd-keyed board.

- [ ] **Step 2: Final commit**

```bash
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master add -A
git -C /Users/panqiwei/Dev/repos/nemori-ai/cc-master commit -m "docs: v0.1.0 acceptance pass"
```

---

## Self-Review (run against the spec with fresh eyes)

**1. Spec coverage** — every spec section maps to a task:
- §2 architecture → Phase 0/1 (structure, manifest); §3 board → Phase 4 + Skill A board.md (Task 7.2-3); §4 commands → Phase 6; §5 hooks → Phase 5; §6 philosophy + §7 decision program → Task 7.1; §8 Skill A references → Task 7.2; §9 Skill B → Phase 3; §10 verified CC mechanisms → encoded in hook design + Task 8.2 smoke-test; §11 dispatch framework → Task 7.2 dispatch.md; §12 exclusions → enforced as negative acceptance in Task 7.2 (no teams/routines); §13 deferred items → Task 8.2 smoke-test + noted in plugin.json (auto-discovery confirm); §14 acceptance → Task 8.3.
- Gap check: **none** — the only spec "open" items (§13) are explicitly handled by the smoke-test task.

**2. Placeholder scan** — the only `TODO`/`<GOAL>`/`<MIGRATION>` strings are **intentional placeholders inside template/example workflow scaffolds** (that is their purpose — the user fills them). They are NOT plan placeholders. All scripts/configs/tests contain complete, runnable code. Prose-content tasks specify the authoritative source + structure + acceptance rather than reproducing 300-line skill bodies verbatim (which would be the implementation, not a plan) — this is content-by-reference to `docs/spec.md`, not a placeholder.

**3. Type/contract consistency** — the cross-component contracts hold: board path `.claude/cc-master/board.json` + marker `.claude/cc-master/active` are identical across all hooks, commands, and tests; the dual sentinel (`cc-master:as-master-orchestrator` + `<!-- cc-master:bootstrap:v1 -->`) is grepped by `bootstrap-board.sh` and pinned-present in `as-master-orchestrator.md` by the Task 6.1 test; schema version `cc-master/v1` is identical in `board.template.json`, `board.example.json`, and the board test; the linter path `skills/authoring-workflows/scripts/validate-workflow.mjs` is identical in the linter test and the bundled-asset gate; the status enum in `verify-board.sh` (`ready`) matches the enum documented in `board.md` and used in `board.example.json`.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-06-05-cc-master-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Fits this plan well: Phases 2/5 (linter + hooks) are TDD'd and independently verifiable; Phases 3/7 (skill content) are prose-heavy and benefit from a focused agent per file.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
