import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const require = createRequire(import.meta.url);
const { applySkillProjection, planSkillProjection } = require('../../scripts/project-skill.cjs');

const A_SOURCE =
  'plugin/src/skills/master-orchestrator-guide/canonical/references/worker-routing.md';
const D_SOURCE = 'plugin/src/skills/using-ccm/canonical/references/command-catalog.md';
const H_SOURCE =
  'plugin/src/skills/pacing-and-estimation/canonical/references/cross-harness-target-facts.md';
const CARD =
  'design_docs/harnesses/capabilities/cross-harness-session-bound-worker.md';

const workerSection = (body) => {
  const match = body.match(
    /## namespace worker[\s\S]*?(?=\n## namespace provider)/u,
  );
  assert.ok(match, 'missing worker namespace');
  return match[0];
};

const RAW_HELP =
  /ccm worker help --harness <codex\|claude-code\|cursor-agent\|kimi-code> \[--scope <agent\|root>\]/u;
const RAW_RUN =
  /ccm worker run --harness <codex\|claude-code\|cursor-agent\|kimi-code> \[--cwd <path>\] \[--timeout-ms <n>\] \[--max-output-bytes <n>\] -- <provider argv\.\.\.>/u;
const NORMALIZED_PROVIDER_ADAPTER = [
  /--model\s+composer-2\.5/u,
  /--effort\s+standard/u,
  /ccm\/session-bound-worker-result\/v1/u,
  /live `--list-models`/u,
  /--mode ask --sandbox enabled/u,
];
const PROCESS_FIELDS = [
  'schema',
  'harness',
  'state',
  'executable',
  'argv',
  'cwd',
  'stdout',
  'stderr',
  'stdout_bytes',
  'stderr_bytes',
  'truncated',
  'timed_out',
  'cancelled',
  'signal',
  'exit_code',
  'reaped',
  'duration_ms',
  'cleanup',
  'error',
];

test('the routing hub selects across origins, reads real help first, and retains parent acceptance', () => {
  const source = read(A_SOURCE);

  assert.match(source, /当前 origin.*不是 worker pool 边界/us);
  assert.match(source, /目标 CLI 的真实调用形状/u);
  assert.match(source, /\{\{CROSS_HARNESS_WORKER_HELP_POINTER\}\}/u);
  assert.doesNotMatch(source, /\{\{CROSS_HARNESS_ACTIVE_QUERY_POINTER\}\}/u);
  assert.match(source, /runtime terminal.*父 task.*独立核对/us);
  assert.match(source, /真实[\s\S]{0,120}handle[\s\S]{0,160}`in_flight`/u);
  assert.doesNotMatch(source, /ccm worker (?:help|run)/u);
  for (const pattern of NORMALIZED_PROVIDER_ADAPTER) {
    assert.doesNotMatch(source, pattern);
  }
});

test('D is the only exact syntax SSOT for real help and raw provider argv', () => {
  const catalog = read(D_SOURCE);
  const worker = workerSection(catalog);

  assert.match(worker, RAW_HELP);
  assert.match(worker, RAW_RUN);
  assert.match(worker, /resolver.*最终.*agent command.*真实.*help/isu);
  assert.match(worker, /`--scope`.*`agent`.*默认.*agent command help.*`root`.*root\/global help/isu);
  assert.match(worker, /`ccm worker run --help`.*ccm.*wrapper\s*help/isu);
  assert.match(worker, /help.*stdout.*stderr.*原样.*exit.*mirror/isu);
  assert.match(worker, /`--`.*原样.*provider argv/isu);
  assert.match(worker, /完整 provider argv.*不自动.*prefix/isu);
  assert.match(worker, /stdin.*无条件.*原样.*转发/isu);
  assert.match(worker, /`--cwd`.*绝对.*存在.*目录.*process\.cwd\(\)/isu);
  assert.match(worker, /`--timeout-ms`.*50\.\.7200000.*600000/isu);
  assert.match(worker, /help.*10000.*timeout/isu);
  assert.match(worker, /`--max-output-bytes`.*256\.\.536870912.*536870912/isu);
  assert.match(worker, /ccm\/worker-process-result\/v1/u);
  assert.match(worker, /state.*exited.*timed_out.*cancelled.*failed.*rejected/isu);
  for (const field of PROCESS_FIELDS) {
    assert.match(worker, new RegExp(`\\b${field}\\b`, 'u'), field);
  }
  assert.match(worker, /不解析.*provider.*terminal/isu);
  assert.match(worker, /provider.*非零.*wrapper.*同一.*exit/isu);
  assert.match(worker, /run.*unknown harness.*structured.*rejected envelope/isu);
  assert.match(worker, /help.*unknown harness.*usage error/isu);
  assert.match(worker, /无 `--json`.*例外/isu);
  assert.doesNotMatch(worker, /ccm worker run[^\n]*--json/u);
  for (const pattern of NORMALIZED_PROVIDER_ADAPTER) {
    assert.doesNotMatch(worker, pattern);
  }
});

test('H interprets facts without copying volatile provider CLI mechanics', () => {
  const source = read(H_SOURCE);

  assert.match(source, /selected target/u);
  assert.match(source, /cursor-ide-plugin.*cursor-agent-cli/us);
  assert.match(source, /真实.*help.*using-ccm/isu);
  assert.match(source, /不复制.*provider.*flags.*catalog/isu);
  assert.doesNotMatch(source, /ccm worker (?:help|run)/u);
  assert.doesNotMatch(source, /--model|--effort|--sandbox|--list-models/u);
  assert.doesNotMatch(source, /terminal|process envelope|exit_code/iu);

  const capability = JSON.parse(
    read('plugin/src/skills/pacing-and-estimation/read-only-capability.json'),
  );
  assert.ok(capability.references.includes('references/cross-harness-target-facts.md'));
});

test('all host projections carry the same A/D/H raw-wrapper boundary', () => {
  for (const host of HOSTS) {
    const staging = mkdtempSync(join(tmpdir(), `session-worker-${host}-`));
    let a;
    try {
      const plan = planSkillProjection({
        repoRoot: ROOT,
        host,
        skill: 'master-orchestrator-guide',
      });
      applySkillProjection(plan, staging);
      a = readFileSync(join(staging, 'references/worker-routing.md'), 'utf8');
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    const d = workerSection(
      read(`plugin/dist/${host}/skills/using-ccm/references/command-catalog.md`),
    );
    const hPath =
      `plugin/dist/${host}/skills/pacing-and-estimation/references/cross-harness-target-facts.md`;
    assert.equal(existsSync(join(ROOT, hPath)), true, host);
    const h = read(hPath);

    assert.match(a, /目标 CLI 的真实调用形状/u, host);
    const helpPointer = a.match(/\[using-ccm worker help\]\(([^)]+)\)/u);
    assert.ok(helpPointer, `${host}: missing worker-help pointer`);
    assert.equal(helpPointer[1]?.split('#')[1], 'worker-help', host);
    assert.match(d, RAW_HELP, host);
    assert.match(d, RAW_RUN, host);
    assert.match(h, /不复制.*provider.*flags.*catalog/isu, host);
  }
});

test('capability and gap surfaces make raw wrapper current only with its runtime', () => {
  const card = read(CARD);
  assert.match(card, /raw wrapper/u);
  assert.match(card, /claude-code \| current/u);
  assert.match(card, /codex \| current/u);
  assert.match(card, /cursor \| current/u);
  assert.match(card, /kimi-code \| current/u);
  assert.match(card, /D.*only.*exact command grammar/isu);
  assert.match(card, /process terminal.*parent acceptance/isu);
  assert.match(card, /current.*same runtime PR/isu);
  assert.match(card, /hermetic raw-wrapper contract.*current.*all four harness/isu);
  assert.match(card, /first-party live probes passed.*Codex.*Claude Code/isu);
  assert.match(card, /Cursor.*resolver.*binary.*real help.*launch.*technically callable/isu);
  assert.match(card, /launcher exited 0.*same-PGID.*helper.*LSP.*remained alive/isu);
  assert.match(card, /wrapper exit 1.*state:failed.*owned_tree_survived/isu);
  assert.match(card, /reaped:true.*whole owned process.*group gone/isu);
  assert.match(card, /no OK output.*exact model.*payer.*live task success.*unproven/isu);
  assert.match(card, /Cursor.*live canary.*exact host\/version.*partial.*external provider-compatibility/isu);
  assert.match(card, /does not transfer.*another OS.*kernel.*Cursor version/isu);
  assert.match(card, /post-MVP.*no-daemon.*await-helper.*natural-drain grace/isu);
  assert.match(card, /must not relax.*whole owned process group.*gone/isu);
  for (const pattern of [RAW_HELP, RAW_RUN, ...NORMALIZED_PROVIDER_ADAPTER]) {
    assert.doesNotMatch(card, pattern);
  }

  const matrix = read('design_docs/capability-parity-matrix.md');
  assert.match(matrix, /cross-harness-session-bound-worker \| current \| current \| current/u);

  const gap = read('design_docs/cross-harness-orchestration-capability-model.md');
  assert.match(gap, /Provider execution \|[^\n]*raw wrapper[^\n]*current/iu);
  assert.match(gap, /Provider execution \|[^\n]*Codex[^\n]*Claude Code[^\n]*live probe[^\n]*pass/iu);
  assert.match(gap, /Provider execution \|[^\n]*Cursor[^\n]*owned_tree_survived[^\n]*partial/iu);
  assert.match(gap, /Provider execution \|[^\n]*whole group gone[^\n]*(?:no|无) OK output/iu);
  assert.match(gap, /normalized.*provider adapter[^\n]*target/iu);
});

test('cached shadow routing does not disable or authorize the explicit wrapper', () => {
  const contract = read('plugin/src/hooks/orchestrator-context/CONTRACT.md');
  assert.match(contract, /dispatch_enabled:false.*automatic.*shadow.*route/isu);
  assert.match(contract, /not.*explicit.*ccm worker.*raw wrapper/isu);
  assert.match(contract, /cannot authorize.*worker/isu);
});

test('roadmap keeps real help in R0 and normalized routing adapters post-MVP', () => {
  const roadmap = read('design_docs/cross-harness-post-mvp-roadmap.md');
  assert.match(roadmap, RAW_HELP);
  assert.match(roadmap, RAW_RUN);
  assert.match(roadmap, /raw argv.*stdin/isu);
  assert.match(roadmap, /run.*完整 provider argv.*不自动.*prefix/isu);
  assert.match(roadmap, /help.*scope.*agent.*root\/global help/isu);
  assert.match(roadmap, /真实 agent-command help.*R0/isu);
  assert.match(roadmap, /R0.*runtime.*PR.*current/isu);
  assert.doesNotMatch(roadmap, /ccm worker inspect/u);
  assert.match(roadmap, /normalized.*provider adapter.*post-MVP/isu);
  assert.match(roadmap, /help.*agent.*观测.*操作入口/isu);
  assert.match(roadmap, /不.*safe.*automatic eligibility/isu);
  assert.match(roadmap, /ccm.*不主动注入.*API\/BYOK env/isu);
  assert.match(roadmap, /R0.*不声明.*provider.*credential\/account.*side-effect safety/isu);
  assert.doesNotMatch(roadmap, /API\/BYOK env 不转发；账号 mutation=0/u);
  assert.match(roadmap, /Cursor.*resolver.*binary.*真实 help.*launch.*technically callable/isu);
  assert.match(roadmap, /launcher exit 0.*同 PGID.*helper.*LSP.*仍存活/isu);
  assert.match(roadmap, /wrapper exit 1.*state:failed.*owned_tree_survived/isu);
  assert.match(roadmap, /TERM\/KILL.*reaped:true.*process group.*消失/isu);
  assert.match(roadmap, /没有 OK output.*exact model.*payer.*live task success/isu);
  assert.match(roadmap, /hermetic contract.*current.*Codex.*Claude Code.*live probe.*pass/isu);
  assert.match(roadmap, /Cursor.*当前 host\/version.*live canary.*partial.*external provider compatibility/isu);
  assert.match(roadmap, /证据不外推.*其他 OS.*kernel.*Cursor version/isu);
  assert.match(roadmap, /post-MVP.*no-daemon.*await-helper.*natural-drain grace/isu);
  assert.match(roadmap, /whole owned group gone.*不变量.*不放宽/isu);
});
