#!/usr/bin/env node
/**
 * P0 extraction — lift every knowledge point's canonical prose out of the skill
 * articles into its own maintainer-side file under plugin/src/knowledge/points/.
 *
 * The skill articles keep their markers, but those markers change meaning: they
 * stop being "this passage IS the point" and become "this passage derives from
 * the point". The mother file carries the same marker pair around its
 * `权威陈述` section, so span extraction and hashing keep working unchanged.
 *
 * Byte-identity is the whole point of this pass: the extracted span must equal
 * the original span exactly. Anything else is a later, deliberate edit.
 *
 *   node scripts/skill-knowledge/extract-point-canonicals.mjs --dry-run
 *   node scripts/skill-knowledge/extract-point-canonicals.mjs --write
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SKILLS_ROOT = path.join(REPO_ROOT, 'plugin/src/skills');
const MODULES_ROOT = path.join(REPO_ROOT, 'plugin/src/knowledge/graph/modules');
const POINTS_ROOT = path.join(REPO_ROOT, 'plugin/src/knowledge/points');

const AUTHORITATIVE_HEADING = '## 权威陈述';

function walkMarkdown(root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) walkMarkdown(absolute, out);
    else if (entry.name.endsWith('.md')) out.push(absolute);
  }
  return out;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Collect every ccm:k span currently living in the skill articles.
 *
 * Spans may nest: today exactly one does, because the only way to say "this
 * sentence restates knowledge owned elsewhere" under byte-identity semantics is
 * to mint a point and nest its marker inside another span. An outer span keeps
 * the inner prose (it is genuinely part of its text) but drops the inner marker
 * lines, so the mother namespace keeps one marker pair per point.
 */
function collectSpans() {
  const spans = new Map();
  const duplicates = [];
  const nested = [];
  for (const skill of fs.readdirSync(SKILLS_ROOT).sort()) {
    const canonical = path.join(SKILLS_ROOT, skill, 'canonical');
    for (const file of walkMarkdown(canonical)) {
      const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const stack = [];
      lines.forEach((line, index) => {
        const start = line.match(/<!--\s*ccm:k:start\s+(point:[^\s]+)\s*-->/);
        const end = line.match(/<!--\s*ccm:k:end\s+(point:[^\s]+)\s*-->/);
        if (start) {
          if (stack.length > 0) {
            nested.push({ outer: stack[stack.length - 1].id, inner: start[1], at: `${relative}:${index + 1}` });
          }
          stack.push({ id: start[1], body: [] });
          return;
        }
        if (end && stack.length > 0) {
          const frame = stack.pop();
          const record = {
            id: frame.id,
            path: relative,
            line: index + 1,
            body: frame.body.join('\n'),
          };
          if (spans.has(frame.id)) duplicates.push(record);
          else spans.set(frame.id, record);
          return;
        }
        // Every enclosing frame already receives the line as it is scanned, so
        // inner prose reaches the outer span without a second copy on close;
        // only the inner marker lines are dropped.
        for (const frame of stack) frame.body.push(line);
      });
    }
  }
  return { spans, duplicates, nested };
}

function motherFile(id, body) {
  return [
    '---',
    `point: ${id.replace(/^point:/, '')}`,
    '---',
    '',
    AUTHORITATIVE_HEADING,
    '',
    `<!-- ccm:k:start ${id} -->`,
    body,
    `<!-- ccm:k:end ${id} -->`,
    '',
  ].join('\n');
}

/** Re-extract the span from a generated mother file, to prove byte identity. */
function spanOf(text, id) {
  const lines = text.split('\n');
  let open = false;
  const body = [];
  for (const line of lines) {
    if (line.includes(`ccm:k:start ${id} `) || line.includes(`ccm:k:start ${id}-->`)) {
      open = true;
      continue;
    }
    if (open && /ccm:k:end/.test(line)) return body.join('\n');
    if (open) body.push(line);
  }
  return null;
}

function main() {
  const write = process.argv.includes('--write');
  const { spans, duplicates, nested } = collectSpans();

  const declared = new Set();
  for (const file of fs.readdirSync(MODULES_ROOT).sort()) {
    const module = JSON.parse(fs.readFileSync(path.join(MODULES_ROOT, file), 'utf8'));
    for (const point of module.points ?? []) declared.add(point.id);
  }

  const missingProse = [...declared].filter((id) => !spans.has(id)).sort();
  const orphanSpans = [...spans.keys()].filter((id) => !declared.has(id)).sort();

  console.log(`declared points : ${declared.size}`);
  console.log(`spans found     : ${spans.size}`);
  console.log(`duplicate spans : ${duplicates.length}`);
  console.log(`declared w/o prose: ${missingProse.length}${missingProse.length ? ` -> ${missingProse.join(', ')}` : ''}`);
  console.log(`prose w/o declaration: ${orphanSpans.length}${orphanSpans.length ? ` -> ${orphanSpans.join(', ')}` : ''}`);
  for (const duplicate of duplicates) {
    console.log(`  DUPLICATE ${duplicate.id} at ${duplicate.path}:${duplicate.line}`);
  }
  console.log(`nested spans    : ${nested.length}`);
  for (const item of nested) {
    console.log(`  NESTED outer=${item.outer} inner=${item.inner} @ ${item.at}`);
    console.log('         (outer mother keeps the inner prose, drops the inner marker lines)');
  }

  let identical = 0;
  const failures = [];
  if (write) fs.mkdirSync(POINTS_ROOT, { recursive: true });

  for (const [id, span] of [...spans].sort((a, b) => a[0].localeCompare(b[0]))) {
    const slug = id.replace(/^point:/, '');
    const target = path.join(POINTS_ROOT, `${slug}.md`);
    const content = motherFile(id, span.body);
    const roundTrip = spanOf(content, id);
    if (roundTrip !== span.body) {
      failures.push({ id, reason: 'round-trip mismatch' });
      continue;
    }
    identical += 1;
    if (write) fs.writeFileSync(target, content);
  }

  console.log(`byte-identical round trips: ${identical}/${spans.size}`);
  if (failures.length > 0) {
    console.log('FAILURES:');
    for (const failure of failures) console.log(`  ${failure.id}: ${failure.reason}`);
  }
  console.log(write ? `wrote ${identical} mother files to plugin/src/knowledge/points/` : '(dry run — nothing written)');

  if (failures.length > 0 || duplicates.length > 0 || missingProse.length > 0) process.exit(1);
}

main();
