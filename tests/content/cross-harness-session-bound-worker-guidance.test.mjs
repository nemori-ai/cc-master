import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor'];
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const A_SOURCE =
  'plugin/src/skills/master-orchestrator-guide/canonical/references/dispatch.md';
const D_SOURCE = 'plugin/src/skills/using-ccm/canonical/references/command-catalog.md';
const H_TARGET_FACTS =
  'plugin/src/skills/pacing-and-estimation/canonical/references/cross-harness-target-facts.md';

const D_ONLY_MECHANICS = [
  /ccm worker run/u,
  /--harness\s+cursor-agent/u,
  /--model\s+composer-2\.5/u,
  /--effort\s+standard/u,
  /ccm\/session-bound-worker-result\/v1/u,
  /live `--list-models`/u,
  /HOME\/XDG/u,
];

test('A makes target facts actively discoverable without becoming a CLI SSOT', () => {
  const source = read(A_SOURCE);

  assert.match(source, /origin facts.*target-worker facts/us);
  assert.match(source, /主动查询目标事实/u);
  assert.match(source, /using-ccm\/references\/command-catalog\.md#跨-harness-主动查询目标事实/u);
  assert.match(
    source,
    /pacing-and-estimation\/references\/cross-harness-target-facts\.md/u,
  );
  assert.match(source, /unknown.*stale.*conflicting.*tight/us);
  assert.match(source, /accountable handle[\s\S]{0,100}`in_flight`/u);
  assert.match(source, /worker\s+终态只触发\s+parent\s+端点验收/u);
  for (const pattern of D_ONLY_MECHANICS) assert.doesNotMatch(source, pattern);

  for (const host of HOSTS) {
    const projected = read(
      `plugin/dist/${host}/skills/master-orchestrator-guide/references/dispatch.md`,
    );
    assert.match(projected, /主动查询目标事实/u, host);
    assert.match(projected, /cross-harness-target-facts\.md/u, host);
  }
});

test('D alone owns the executable active-query and worker contracts', () => {
  const catalog = read(D_SOURCE);
  assert.match(catalog, /## 跨 harness 主动查询目标事实/u);
  assert.match(catalog, /ccm harness list --machine-wide --json/u);
  assert.match(catalog, /ccm provider facts <target-provider> --json/u);
  assert.match(catalog, /ccm quota status --json/u);
  assert.match(catalog, /ccm quota preflight --input <json\|@file\|-> --json/u);
  assert.match(catalog, /available:true.*不等于.*headroom/us);
  for (const pattern of D_ONLY_MECHANICS) assert.match(catalog, pattern);
});

test('H registers one provider-neutral target-fact interpreter and no execution mechanics', () => {
  assert.equal(existsSync(join(ROOT, H_TARGET_FACTS)), true);
  const targetFacts = read(H_TARGET_FACTS);
  assert.match(targetFacts, /selected target/u);
  assert.match(targetFacts, /cursor-ide-plugin.*cursor-agent-cli/us);
  assert.match(targetFacts, /(?:static|静态) provider facts.*live entitlement/us);
  assert.match(targetFacts, /available:true.*headroom/us);
  assert.match(targetFacts, /unknown.*tight.*fail closed/us);
  for (const pattern of D_ONLY_MECHANICS) assert.doesNotMatch(targetFacts, pattern);
  assert.doesNotMatch(targetFacts, /terminal|result schema|process group|workspace binding/iu);

  const capability = JSON.parse(
    read('plugin/src/skills/pacing-and-estimation/read-only-capability.json'),
  );
  assert.ok(capability.references.includes('references/cross-harness-target-facts.md'));

  for (const host of HOSTS) {
    const projectedPath =
      `plugin/dist/${host}/skills/pacing-and-estimation/references/cross-harness-target-facts.md`;
    assert.equal(existsSync(join(ROOT, projectedPath)), true, host);
    assert.equal(read(projectedPath), targetFacts, host);
    assert.ok(
      Object.hasOwn(
        capability.hosts[host].rendered_runtime_manifest.files,
        'references/cross-harness-target-facts.md',
      ),
      host,
    );
  }
});

test('Capability Card records current partial parity without copying runtime mechanics', () => {
  const card = read(
    'design_docs/harnesses/capabilities/cross-harness-session-bound-worker.md',
  );
  assert.match(card, /current\/partial/u);
  assert.match(card, /D.*only runtime owner/u);
  assert.match(card, /active-query/u);
  assert.match(card, /cross-harness-target-facts\.md/u);
  assert.match(card, /unknown.*tight.*no spawn/isu);
  for (const pattern of D_ONLY_MECHANICS) assert.doesNotMatch(card, pattern);
});
