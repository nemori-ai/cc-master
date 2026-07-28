import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function readWorkflow(name) {
  return readFileSync(`.github/workflows/${name}`, 'utf8');
}

function triggerBlock(workflow, id) {
  const marker = `  ${id}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow trigger ${id} must exist`);
  const tail = workflow.slice(start + marker.length);
  const nextTrigger = tail.search(/^  [a-z_][a-z0-9_-]*:\n/m);
  return nextTrigger === -1 ? tail : tail.slice(0, nextTrigger);
}

function uploadBlocks(workflow) {
  const marker = 'uses: actions/upload-artifact@v4';
  const blocks = [];
  let cursor = 0;
  while (true) {
    const start = workflow.indexOf(marker, cursor);
    if (start === -1) break;
    const tail = workflow.slice(start + marker.length);
    const nextStep = tail.search(/^      - (?:name|uses):/m);
    blocks.push(nextStep === -1 ? tail : tail.slice(0, nextStep));
    cursor = start + marker.length;
  }
  return blocks;
}

function assertMainOnlyPush(workflow, name) {
  const push = triggerBlock(workflow, 'push');
  assert.match(push, /^    branches:\n      - 'main'$/m, `${name} push must target main only`);
  assert.match(push, /^    paths:\n/m, `${name} must preserve its path filter`);
  assert.doesNotMatch(push, /^    tags:/m, `${name} must not run on release tags`);
}

function assertPrOnlyCancellation(workflow, name) {
  assert.match(
    workflow,
    /^concurrency:\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}\n  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m,
    `${name} must cancel only superseded pull-request revisions`,
  );
}

test('ordinary CI push triggers are limited to main and never release tags', () => {
  const ccm = readWorkflow('ccm-ci.yml');
  const installer = readWorkflow('installer-portability.yml');
  assertMainOnlyPush(ccm, 'ccm-ci');
  assertMainOnlyPush(installer, 'installer-portability');
});

test('ordinary pull-request workflows cancel only superseded revisions', () => {
  assertPrOnlyCancellation(readWorkflow('ccm-ci.yml'), 'ccm-ci');
  assertPrOnlyCancellation(
    readWorkflow('installer-portability.yml'),
    'installer-portability',
  );
});

test('non-release macOS evidence expires after seven days', () => {
  const uploads = uploadBlocks(readWorkflow('macos-live-qualification.yml'));
  assert.equal(uploads.length, 3, 'macOS qualification must keep its three evidence uploads');
  for (const upload of uploads) {
    assert.match(upload, /^ {10}retention-days: 7$/m);
  }
});

test('release workflow artifacts are short-lived copies of attached release assets', () => {
  const workflow = readWorkflow('ccm-release.yml');
  const uploads = uploadBlocks(workflow);
  assert.equal(uploads.length, 4, 'ccm release must keep its four artifact transfer points');
  for (const upload of uploads) {
    assert.match(upload, /^ {10}retention-days: 14$/m);
  }
  assert.equal(
    (workflow.match(/uses: softprops\/action-gh-release@v2/g) ?? []).length,
    2,
    'formal GitHub Release attachments must remain intact',
  );
});

test('maintainer guidance explains when and how to request live macOS evidence', () => {
  const contributing = readFileSync('CONTRIBUTING.md', 'utf8');
  assert.match(contributing, /`ci:macos-live`/);
  assert.match(contributing, /真实 macOS|live macOS/i);
  assert.match(contributing, /移除后重新添加|remove.*re-add/i);
  assert.match(contributing, /最新.*commit|latest.*commit/i);
});
