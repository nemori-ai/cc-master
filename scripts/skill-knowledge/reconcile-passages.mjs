#!/usr/bin/env node
/**
 * Record article ⟷ mother reconciliations.
 *
 * A reconciliation asserts "someone checked that this passage and this point
 * say the same thing". A tool that can mint that assertion freely would empty
 * it of meaning, so this one refuses to sign anything it cannot prove:
 *
 *   default mode  — signs only pairs whose passage is byte-identical to the
 *                   mother span. True during the P0 extraction, and only then.
 *   --bless P@F   — signs one named pair regardless. Use after a human (or an
 *                   agent) has actually read the two and found them to agree.
 *
 * Once the articles are rewritten in their own voice, default mode stops being
 * able to sign them, which is the intended friction.
 *
 *   node scripts/skill-knowledge/reconcile-passages.mjs --dry-run
 *   node scripts/skill-knowledge/reconcile-passages.mjs --write
 *   node scripts/skill-knowledge/reconcile-passages.mjs --write --bless point:x@path/to/a.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractMarkers } from './markers.mjs';
import { hashMarkdownSpan } from './hash.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const COMPOSITIONS = path.join(REPO_ROOT, 'plugin/src/knowledge/compositions');
const MODULES = path.join(REPO_ROOT, 'plugin/src/knowledge/graph/modules');

function readSpans(relative) {
  const absolute = path.join(REPO_ROOT, relative);
  if (!fs.existsSync(absolute)) return null;
  const markers = extractMarkers(fs.readFileSync(absolute, 'utf8'));
  return markers?.ok ? markers.spans : null;
}

function main() {
  const write = process.argv.includes('--write');
  const blessed = new Set(
    process.argv
      .filter((arg) => arg.startsWith('--bless='))
      .map((arg) => arg.slice('--bless='.length)),
  );

  // Mother span per point, from the authoritative binding.
  const motherSpan = new Map();
  for (const file of fs.readdirSync(MODULES).sort()) {
    const module = JSON.parse(fs.readFileSync(path.join(MODULES, file), 'utf8'));
    for (const point of module.points ?? []) {
      const spans = readSpans(point.binding.path);
      const span = spans?.find((item) => item.point_id === point.id);
      if (span) motherSpan.set(point.id, span.content);
    }
  }

  let signed = 0;
  let refused = 0;
  const refusals = [];

  for (const file of fs.readdirSync(COMPOSITIONS).sort()) {
    const full = path.join(COMPOSITIONS, file);
    const composition = JSON.parse(fs.readFileSync(full, 'utf8'));
    let dirty = false;

    for (const entry of composition.canonical_source_inventory ?? []) {
      const spans = readSpans(entry.path);
      if (!spans) continue;
      const anchored = new Map();
      for (const span of spans) {
        const list = anchored.get(span.point_id) ?? [];
        list.push(span.content);
        anchored.set(span.point_id, list);
      }
      const records = [];
      for (const [pointId, passages] of [...anchored.entries()].sort()) {
        const mother = motherSpan.get(pointId);
        if (mother === undefined) continue;
        const joined = passages.join('\n');
        const identical = joined === mother;
        const explicit = blessed.has(`${pointId}@${entry.path}`);
        if (!identical && !explicit) {
          refused += 1;
          refusals.push(`${pointId} @ ${entry.path}`);
          // Keep whatever was recorded before; never silently drop a record.
          const previous = (entry.reconciliations ?? []).find((item) => item.point === pointId);
          if (previous) records.push(previous);
          continue;
        }
        records.push({
          point: pointId,
          point_sha256: hashMarkdownSpan(mother),
          passage_sha256: hashMarkdownSpan(joined),
        });
        signed += 1;
      }
      if (records.length > 0) {
        entry.reconciliations = records;
        dirty = true;
      }
    }

    if (dirty && write) fs.writeFileSync(full, `${JSON.stringify(composition, null, 2)}\n`);
  }

  console.log(`signed  : ${signed}`);
  console.log(`refused : ${refused}`);
  for (const item of refusals.slice(0, 20)) console.log(`  REFUSED (not byte-identical) ${item}`);
  if (refusals.length > 20) console.log(`  … and ${refusals.length - 20} more`);
  console.log(write ? 'written' : '(dry run — nothing written)');
}

main();
