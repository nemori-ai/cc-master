import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  planReleaseMetadata,
  validateReleaseMetadata,
} from '../../scripts/release-metadata.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const script = path.join(repoRoot, 'scripts/release-metadata.mjs');
const cases = JSON.parse(
  readFileSync(path.join(repoRoot, 'tests/fixtures/release-metadata-cases.json'), 'utf8'),
);

test('deterministic cases derive exact metadata for plugin and ccm RC/stable tags', () => {
  assert.equal(cases.schema, 'cc-master/release-metadata-cases/v1');
  for (const fixture of cases.valid) {
    const actual = planReleaseMetadata({
      tag: fixture.tag,
      repository: cases.repository,
      changelogText: fixture.changelog,
    });
    assert.deepEqual(actual, { tag: fixture.tag, ...fixture.expected }, fixture.name);
    assert.doesNotThrow(() => validateReleaseMetadata(actual));
  }
});

test('invalid title, prerelease, and body combinations fail loudly', () => {
  const byName = new Map(cases.valid.map((fixture) => [fixture.name, fixture]));
  for (const fixture of cases.invalid) {
    const source = byName.get(fixture.from);
    assert.ok(source, `${fixture.name}: missing source fixture`);
    const plan = planReleaseMetadata({
      tag: source.tag,
      repository: cases.repository,
      changelogText: source.changelog,
    });
    assert.throws(
      () => validateReleaseMetadata({ ...plan, ...fixture.patch }),
      new RegExp(fixture.error, 'iu'),
      fixture.name,
    );
  }
});

test('unknown or malformed tag families fail loudly', () => {
  for (const tag of cases.invalidTags) {
    assert.throws(
      () => planReleaseMetadata({ tag, repository: cases.repository, changelogText: '# empty' }),
      /tag/iu,
      tag,
    );
  }
});

test('CLI emits GitHub outputs without contacting GitHub', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'release-metadata-test-'));
  const output = path.join(work, 'github-output.txt');
  try {
    execFileSync(
      process.execPath,
      [script, 'plan', '--tag', 'v0.21.0-rc.3', '--repository', cases.repository, '--github-output', output],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const text = await readFile(output, 'utf8');
    assert.match(text, /^title=cc-master plugin v0\.21\.0-rc\.3$/mu);
    assert.match(text, /^prerelease=true$/mu);
    assert.match(text, /^body<<CC_MASTER_RELEASE_BODY_[0-9a-f]{16}$/mu);
    assert.match(text, /See \[CHANGELOG\]\(https:\/\/github\.com\/example\/cc-master\/blob\/v0\.21\.0-rc\.3\/CHANGELOG\.md\)\./u);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('CLI rejects an invalid candidate with nonzero status and a useful error', () => {
  const fixture = cases.valid.find(({ name }) => name === 'plugin rc');
  const candidate = JSON.stringify({ tag: fixture.tag, ...fixture.expected, prerelease: false });
  const result = spawnSync(process.execPath, [script, 'validate', '--metadata-json', candidate], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release-metadata:.*prerelease/iu);
});

test('every tag-gated release attachment consumes planner-owned metadata', () => {
  for (const relative of ['.github/workflows/plugin-release.yml', '.github/workflows/ccm-release.yml']) {
    const workflow = readFileSync(path.join(repoRoot, relative), 'utf8');
    const attachBlocks = workflow.split(/(?=      - name: Attach .*GitHub release)/u).slice(1);
    assert.ok(attachBlocks.length > 0, `${relative}: no release attach blocks found`);
    for (const block of attachBlocks) {
      const step = block.split(/\n      - name: /u, 1)[0];
      assert.match(step, /name: \$\{\{ steps\.release_meta\.outputs\.title \}\}/u, relative);
      assert.match(step, /prerelease: \$\{\{ steps\.release_meta\.outputs\.prerelease \}\}/u, relative);
      assert.match(step, /body: \$\{\{ steps\.release_meta\.outputs\.body \}\}/u, relative);
    }
    assert.match(workflow, /node scripts\/release-metadata\.mjs plan/u, relative);
  }
});
