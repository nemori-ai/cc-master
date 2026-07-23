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
    assert.doesNotThrow(() =>
      validateReleaseMetadata(actual, { changelogText: fixture.changelog }),
    );
  }
});

test('stable bodies preserve the complete changelog section while RC bodies stay concise', () => {
  const stableChangelog = [
    '# Changelog',
    '',
    '## [1.2.3] — 2026-07-23',
    '',
    '> Stable plugin release.',
    '',
    '### Added',
    '',
    '- First material capability.',
    '- Second material capability.',
    '',
    '### Compatibility',
    '',
    '- Requires the paired stable ccm release.',
    '',
    '## [1.2.3-rc.1] — 2026-07-22',
    '',
    '> Release candidate.',
    '',
  ].join('\n');
  const stable = planReleaseMetadata({
    tag: 'v1.2.3',
    repository: cases.repository,
    changelogText: stableChangelog,
  });
  assert.match(stable.body, /### Added/u);
  assert.match(stable.body, /Second material capability/u);
  assert.match(stable.body, /### Compatibility/u);
  assert.doesNotMatch(stable.body, /Release candidate/u);

  const rc = planReleaseMetadata({
    tag: 'v1.2.3-rc.1',
    repository: cases.repository,
    changelogText: stableChangelog,
  });
  assert.equal(
    rc.body,
    'Release candidate.\n\nSee [CHANGELOG](https://github.com/example/cc-master/blob/v1.2.3-rc.1/CHANGELOG.md).',
  );
});

test('stable metadata validation rejects a truncated changelog-derived body', () => {
  const changelog = [
    '# ccm',
    '',
    '## 1.2.3',
    '',
    '### Major Changes',
    '',
    '- First stable capability.',
    '- Required compatibility boundary.',
    '',
  ].join('\n');
  const planned = planReleaseMetadata({
    tag: 'ccm-v1.2.3',
    repository: cases.repository,
    changelogText: changelog,
  });
  assert.throws(
    () =>
      validateReleaseMetadata(
        {
          ...planned,
          body: planned.body.replace('- Required compatibility boundary.\n', ''),
        },
        { changelogText: changelog },
      ),
    /body/iu,
  );
});

test('the current plugin and ccm stable tags plan against their real release sections', () => {
  const plugin = planReleaseMetadata({ tag: 'v0.21.0', repository: cases.repository });
  assert.equal(plugin.title, 'cc-master plugin v0.21.0');
  assert.equal(plugin.prerelease, false);
  assert.match(plugin.body, /### Highlights/u);
  assert.match(plugin.body, /### Compatibility and known boundaries/u);
  assert.doesNotMatch(plugin.body, /^## \[0\.21\.0-rc\.4\]/mu);
  assert.match(
    plugin.body,
    /blob\/v0\.21\.0\/CHANGELOG\.md\)\.$/u,
  );

  const ccm = planReleaseMetadata({ tag: 'ccm-v0.22.0', repository: cases.repository });
  assert.equal(ccm.title, 'ccm v0.22.0');
  assert.equal(ccm.prerelease, false);
  assert.match(ccm.body, /### Highlights/u);
  assert.match(ccm.body, /The complete changeset ledger follows/u);
  assert.match(ccm.body, /### Patch Changes/u);
  assert.doesNotMatch(ccm.body, /^## 0\.22\.0-rc\.4$/mu);
  assert.match(
    ccm.body,
    /blob\/ccm-v0\.22\.0\/ccm\/apps\/cli\/CHANGELOG\.md\)\.$/u,
  );
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
      () =>
        validateReleaseMetadata(
          { ...plan, ...fixture.patch },
          { changelogText: source.changelog },
        ),
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

test('CLI plans both current stable tags from the repository changelogs', () => {
  for (const [tag, title] of [
    ['v0.21.0', 'cc-master plugin v0.21.0'],
    ['ccm-v0.22.0', 'ccm v0.22.0'],
  ]) {
    const metadata = JSON.parse(
      execFileSync(
        process.execPath,
        [script, 'plan', '--tag', tag, '--repository', cases.repository],
        { cwd: repoRoot, encoding: 'utf8' },
      ),
    );
    assert.equal(metadata.title, title);
    assert.equal(metadata.prerelease, false);
    assert.doesNotThrow(() => validateReleaseMetadata(metadata));
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
