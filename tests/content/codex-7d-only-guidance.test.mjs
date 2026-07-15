import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const SOURCE_REF = process.env.CC_MASTER_PACING_SOURCE_REF || '';

const read = (path) => {
  if (!SOURCE_REF) return readFileSync(join(ROOT, path), 'utf8');
  const result = spawnSync('git', ['show', `${SOURCE_REF}:${path}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `cannot read ${path} from ${SOURCE_REF}: ${result.stderr || result.stdout}`,
  );
  return result.stdout;
};

const CODEX_GUIDANCE_PATHS = [
  'plugin/src/skills/pacing-and-estimation/adapters/codex/overlays/description.md',
  'plugin/src/skills/pacing-and-estimation/adapters/codex/overlays/usage-signals-reference.md',
  'plugin/src/skills/pacing-and-estimation/adapters/codex/overlays/levers-reference.md',
  'plugin/src/skills/pacing-and-estimation/adapters/codex/overlays/model-tiers-reference.md',
  'plugin/src/skills/master-orchestrator-guide/adapters/codex/overlays/capacity-account-guidance.md',
  'plugin/dist/codex/skills/pacing-and-estimation/SKILL.md',
  'plugin/dist/codex/skills/pacing-and-estimation/references/usage-signals.md',
  'plugin/dist/codex/skills/pacing-and-estimation/references/pacing-levers.md',
  'plugin/dist/codex/skills/pacing-and-estimation/references/model-tiers.md',
  'plugin/dist/codex/skills/master-orchestrator-guide/SKILL.md',
];

const STALE_AUTHORITY_PATTERNS = [
  /codex-5h-7d/u,
  /读取(?:当前账号)?\s*5h\s*\/\s*7d/u,
  /感知\s*5h\s*\/\s*7d/u,
  /5h\s*窗口\s*`used%`/u,
  /primary[^\n]*映射为\s*5h/u,
  /`stop_5h`[^\n]*当前\s*5h/u,
  /`switch`[^\n]*表示强节流压力/u,
  /按\s*5h\s*\/\s*7d[^\n]*配额/u,
  /烧穿\s*5h\s*窗口/u,
  /逼近\s*5h\s*上界/u,
  /usage show[^\n]*备号\s*5h\s*\/\s*7d/u,
  /messages\s*\/\s*5h/iu,
];

test('Codex pacing is 7d-only and treats every five-hour input as ignored provenance', () => {
  const registryPath =
    'plugin/src/skills/pacing-and-estimation/read-only-capability.json';
  const registry = JSON.parse(read(registryPath));
  assert.equal(registry.hosts['claude-code'].profile, 'claude-5h-7d');
  assert.equal(registry.hosts.codex.profile, 'codex-7d-rolling24h');
  assert.equal(registry.hosts.cursor.profile, 'cursor-billing-period');

  const renderer = read('scripts/pacing-read-only-capability.cjs');
  assert.match(renderer, /codex:\s*'codex-7d-rolling24h'/u);
  assert.doesNotMatch(renderer, /codex-5h-7d/u);

  const codexGuidance = CODEX_GUIDANCE_PATHS.map(read).join('\n');
  assert.match(codexGuidance, /7d[^\n]*(?:唯一|only)[^\n]*(?:硬|hard)/iu);
  assert.match(codexGuidance, /rolling[- ]24h[^\n]*(?:advisory|只作 advisory|仅作 advisory)/iu);
  assert.match(codexGuidance, /(?:five_hour|5h)[^\n]*ignored provenance/iu);
  assert.match(
    codexGuidance,
    /(?:five_hour|5h)[^\n]*(?:不得|不能)[^\n]*throttle[^\n]*switch[^\n]*stop_5h[^\n]*reset[^\n]*wakeup/iu,
  );
  for (const pattern of STALE_AUTHORITY_PATTERNS) assert.doesNotMatch(codexGuidance, pattern);

  const claudeGuidance = [
    read('plugin/src/skills/pacing-and-estimation/adapters/claude-code/overlays/usage-signals-reference.md'),
    read('plugin/dist/claude-code/skills/pacing-and-estimation/references/pacing-levers.md'),
  ].join('\n');
  assert.match(claudeGuidance, /5h/u);
  assert.match(claudeGuidance, /stop_5h/u);

  const cursorGuidance = [
    read('plugin/src/skills/pacing-and-estimation/adapters/cursor/overlays/usage-signals-reference.md'),
    read('plugin/dist/cursor/skills/pacing-and-estimation/SKILL.md'),
  ].join('\n');
  assert.match(cursorGuidance, /billing_period/u);
  assert.doesNotMatch(cursorGuidance, /codex-7d-rolling24h|codex-5h-7d/u);
});

test('design contracts keep Codex 5h non-authoritative without weakening other hosts', () => {
  const design = read('plugin/src/skills/pacing-and-estimation/.design/DESIGN.md');
  assert.match(design, /Codex[^\n]*7d[^\n]*(?:rolling[- ]24h|24h)/iu);
  assert.match(design, /Codex[^\n]*(?:five_hour|5h)[^\n]*(?:ignored|忽略)/iu);
  assert.doesNotMatch(design, /Claude\/Codex\s+5h\/7d/u);

  const capability = read('design_docs/harnesses/capabilities/usage-pacing-midflight.md');
  assert.match(capability, /7d-only hard ceiling \+ rolling-24h advisory, never 5h pacing/u);
  assert.match(capability, /historical\/extra\s+5h fields are ignored provenance/u);

  const cursorFacts = read('design_docs/harnesses/cursor-agent-cli.md');
  assert.match(cursorFacts, /first-party/iu);
  assert.match(cursorFacts, /Codex[^\n]*自动换号永久禁止/u);
});
