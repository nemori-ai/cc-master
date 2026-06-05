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

for (const f of findings) console.log(`${f.level} ${file}:${f.line}  ${f.rule}  ${f.msg}`);
process.exit(findings.some((f) => f.level === 'ERROR') ? 1 : 0);
