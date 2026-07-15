import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import pacingAttestation from '../../scripts/pacing-read-only-attestation.cjs';

const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor'];
const HOLDOUTS = [
  '协调记录为空时，先把仲裁结果登记进 inbox；没有历史基线就保存新的 snapshot。',
  '池内份额尚无回执时，先把最新分配结果持久化到通知队列；计划参照尚未留存时，先固化当前状态。',
  '共享容量的裁定尚未留痕时，先归档本板的分配结论；EVM 缺少起始参照时，先落库当前计划。',
  'own row 为空就先发布新分配记录；plan anchor 尚无记录就持久化当前任务集。',
];

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const makeProjectionFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-guidance-mutant-'));
  mkdirSync(join(root, 'plugin/src'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'ccm/apps/cli/src'), { recursive: true });
  cpSync(join(ROOT, 'plugin/src/skills'), join(root, 'plugin/src/skills'), { recursive: true });
  cpSync(
    join(ROOT, 'ccm/apps/cli/src/provider-model-facts.json'),
    join(root, 'ccm/apps/cli/src/provider-model-facts.json'),
  );
  for (const script of [
    'sync-plugin-dist.sh',
    'pacing-read-only-capability.cjs',
    'pacing-read-only-attestation.cjs',
    'provider-guidance-attestation.cjs',
  ]) {
    cpSync(join(ROOT, 'scripts', script), join(root, 'scripts', script));
  }
  return root;
};

const project = (root, host) =>
  spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', host, '--skills-only'], {
    cwd: root,
    encoding: 'utf8',
  });

const assertRejected = (root, host, label) => {
  const result = project(root, host);
  assert.notEqual(
    result.status,
    0,
    `${host}: ${label} must fail production projection\nstdout=${result.stdout}\nstderr=${result.stderr}`,
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /(?:pacing read-only|provider guidance) attestation/iu,
    `${host}: ${label} must fail through an independent production attestor`,
  );
  assert.equal(
    existsSync(join(root, `plugin/dist/${host}/skills/pacing-and-estimation`)),
    false,
    `${host}: a rejected pacing tree must never be published`,
  );
};

test('Cursor IDE and headless CLI guidance keep independent role and evidence boundaries', () => {
  const contract = read('design_docs/harnesses/cursor-dual-surface-contract.md');
  const ideFacts = read('design_docs/harnesses/cursor.md');
  const cliFacts = read('design_docs/harnesses/cursor-agent-cli.md');
  const cursorModelFacts = read(
    'plugin/src/skills/pacing-and-estimation/adapters/cursor/overlays/model-tiers-reference.md',
  );
  assert.match(contract, /`cursor-ide-plugin`/u);
  assert.match(contract, /`cursor-agent-cli`/u);
  assert.match(contract, /master-origin/u);
  assert.match(contract, /worker-target/u);
  assert.match(contract, /auth\(A\)\s*⇏\s*auth\(B\)/u);
  assert.match(contract, /automatic_login\/logout\/account_switch\/session_switch\s*=\s*forbidden/u);
  assert.match(ideFacts, /本页只覆盖 \*\*Cursor IDE Agent\*\*/u);
  assert.match(ideFacts, /Cursor Agent CLI facts\]\(cursor-agent-cli\.md\)/u);
  assert.match(cliFacts, /canonical surface id 是\s*`cursor-agent-cli`/u);
  assert.match(cliFacts, /只能是 `worker-target`，不能是 `master-origin`/u);
  assert.match(cliFacts, /Cursor 与\s*Codex 的自动换号永久禁止/u);
  assert.match(cliFacts, /BYOK、on-demand、API、external-key、shared、unknown、ambiguous/u);
  assert.match(cursorModelFacts, /BYOK/u);
  assert.match(cursorModelFacts, /on-demand/u);
});

test('three-host pacing projection rejects canonical references, overlays, descriptions, and Cursor include drift', () => {
  for (const holdout of HOLDOUTS) {
    const root = makeProjectionFixture();
    try {
      const renderer = join(root, 'scripts/pacing-read-only-capability.cjs');
      const source = readFileSync(renderer, 'utf8');
      writeFileSync(
        renderer,
        source.replace(
          "    '## Pointers',",
          `    ${JSON.stringify(holdout)},\n    '## Pointers',`,
        ),
      );
      for (const host of HOSTS) assertRejected(root, host, 'renderer procedure mutant');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  for (const [index, holdout] of HOLDOUTS.entries()) {
    const root = makeProjectionFixture();
    try {
      const reference = join(
        root,
        'plugin/src/skills/pacing-and-estimation/canonical/references/estimation.md',
      );
      writeFileSync(reference, `${readFileSync(reference, 'utf8')}\n${holdout}\n`);
      for (const host of HOSTS) assertRejected(root, host, `canonical reference mutant ${index + 1}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  for (const [host, overlay, holdout] of [
    ['claude-code', 'model-tiers-reference.md', HOLDOUTS[0]],
    ['codex', 'levers-reference.md', HOLDOUTS[1]],
    ['cursor', 'model-tiers-reference.md', HOLDOUTS[2]],
  ]) {
    const root = makeProjectionFixture();
    try {
      const path = join(root, `plugin/src/skills/pacing-and-estimation/adapters/${host}/overlays/${overlay}`);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n${holdout}\n`);
      assertRejected(root, host, `${host} overlay mutant`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  for (const host of HOSTS) {
    const root = makeProjectionFixture();
    try {
      const path = join(root, `plugin/src/skills/pacing-and-estimation/adapters/${host}/overlays/description.md`);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n${HOLDOUTS[3]}\n`);
      assertRejected(root, host, `${host} description overlay mutant`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const root = makeProjectionFixture();
  try {
    const extra = join(root, 'plugin/src/skills/pacing-and-estimation/adapters/cursor/overlays/runtime-extra.md');
    const strategy = join(root, 'plugin/src/skills/pacing-and-estimation/adapters/cursor/strategy.yaml');
    writeFileSync(extra, HOLDOUTS[0]);
    writeFileSync(
      strategy,
      `${readFileSync(strategy, 'utf8')}\ninclude_adapter:\n  - adapters/cursor/overlays/runtime-extra.md\n`,
    );
    assertRejected(root, 'cursor', 'unexpected Cursor include mutant');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('clean generated pacing trees match the independent three-host manifest', () => {
  const registry = JSON.parse(read('plugin/src/skills/pacing-and-estimation/read-only-capability.json'));
  for (const host of HOSTS) {
    pacingAttestation.assertPacingRuntimeTree(
      registry,
      host,
      join(ROOT, `plugin/dist/${host}/skills/pacing-and-estimation`),
    );
  }
});
