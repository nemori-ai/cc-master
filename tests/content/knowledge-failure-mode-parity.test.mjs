/**
 * The failure mode of a knowledge point is written down twice on purpose.
 *
 * The graph module JSON carries it as a machine-readable field; the point's
 * mother file carries it in prose, at the head of its `## 失效类型` section,
 * followed by the reasoning that earned it. Neither copy is redundant — the
 * field is what `check`, `report` and K-I24 consume, and the prose is what a
 * maintainer reads when deciding whether the call was right.
 *
 * Two copies of one fact drift. Deleting the prose copy was considered and
 * rejected: a known defect has ~18 points whose label and adjacent reasoning
 * contradict each other (the label came from the v3 re-judgment, the reasoning
 * was carried over from an earlier pass), and removing the label would not fix
 * those — it would only make them invisible. So both copies stay, and this test
 * is the machine that keeps them honest.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const MODULE_DIR = path.join(repoRoot, 'plugin/src/knowledge/graph/modules');
const POINT_DIR = path.join(repoRoot, 'plugin/src/knowledge/points');

const FAILURE_MODES = new Set([
  'capability_gap',
  'environment_fact',
  'prosthetic',
  'motivation_conflict',
]);

/** The field, keyed by point id, as the graph declares it. */
function fieldByPoint() {
  const byPoint = new Map();
  for (const file of fs.readdirSync(MODULE_DIR).filter((n) => n.endsWith('.json'))) {
    const doc = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, file), 'utf8'));
    for (const point of doc.points ?? []) {
      byPoint.set(point.id, { mode: point.failure_mode, module: doc.id });
    }
  }
  return byPoint;
}

/**
 * The label as the mother file states it: the backticked token opening the
 * first non-empty line under `## 失效类型`. Returns null when the section is
 * absent, and undefined when the section exists but opens with something else —
 * the two are different failures and are reported differently below.
 */
function labelInMotherFile(text) {
  const section = text.split('\n## 失效类型\n')[1];
  if (section === undefined) return null;
  const firstLine = section.split('\n').find((line) => line.trim() !== '');
  const match = firstLine?.match(/^`([a-z_]+)`/);
  return match ? match[1] : undefined;
}

test('every point states one failure mode, and its two copies agree', () => {
  const field = fieldByPoint();
  assert.ok(field.size > 0, 'no points found — module directory moved?');

  const missingSection = [];
  const unparseable = [];
  const disagreeing = [];
  const illegal = [];
  let compared = 0;

  for (const [id, { mode, module }] of field) {
    if (!FAILURE_MODES.has(mode)) {
      illegal.push(`${id} (${module}): field is ${JSON.stringify(mode)}`);
      continue;
    }
    const file = path.join(POINT_DIR, `${id.replace(/^point:/, '')}.md`);
    if (!fs.existsSync(file)) continue; // mother-file coverage is K2's business, not ours
    const label = labelInMotherFile(fs.readFileSync(file, 'utf8'));
    if (label === null) {
      missingSection.push(id);
      continue;
    }
    if (label === undefined) {
      unparseable.push(id);
      continue;
    }
    compared += 1;
    if (label !== mode) {
      disagreeing.push(`${id}: mother file says ${label}, graph field says ${mode}`);
    }
  }

  assert.deepEqual(illegal, [], 'points declare a value outside the enum');
  assert.deepEqual(
    missingSection,
    [],
    'points whose mother file has no 失效类型 section — add one, or the reasoning behind the label is lost',
  );
  assert.deepEqual(
    unparseable,
    [],
    'points whose 失效类型 section does not open with a backticked mode token',
  );
  assert.deepEqual(
    disagreeing,
    [],
    'the field and the prose disagree — fix whichever is wrong, do not silence the check',
  );
  assert.ok(compared > 0, 'compared nothing — the parser stopped matching the authored format');
});
