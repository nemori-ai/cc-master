import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor'];
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const GUIDE_PATH = 'plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md';
const INIT_SURFACES = [
  'plugin/src/commands/as-master-orchestrator/adapters/claude-code/body.md',
  'plugin/src/skills/cc-master-as-master-orchestrator/canonical/SKILL.md',
  'plugin/src/commands/as-master-orchestrator/adapters/cursor/body.md',
  'plugin/src/rules/cursor/cc-master-orchestrator.mdc',
];

const section = (body, start, end) => {
  const from = body.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = body.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section boundary: ${end}`);
  return body.slice(from, to);
};

test('master identity and continuity are not bounded by the origin harness', () => {
  const guide = read(GUIDE_PATH);
  const identity = section(guide, '### 身份信条', '### 你手里握着什么');

  assert.match(identity, /origin harness[^\n]*不是[^\n]*(?:身份|生命周期|边界)/u);
  assert.match(identity, /board[^\n]*`ccm`[^\n]*连续性/u);
  assert.match(identity, /handoff\s*\/\s*resume[^\n]*支持的 origin/u);
  assert.match(identity, /本机[^\n]*harness[^\n]*worker pool/u);
});

test('master identity separates task, runtime agent, and execution attempt', () => {
  const guide = read(GUIDE_PATH);
  const identity = section(guide, '### 身份信条', '### 你手里握着什么');

  assert.match(identity, /task[^\n]*(?:规划|交付)[^\n]*单元/iu);
  assert.match(identity, /agent[^\n]*(?:运行时行动者|runtime actor)/iu);
  assert.match(identity, /attempt[^\n]*(?:执行证据|execution evidence)/iu);
  assert.match(identity, /三层[^\n]*(?:不可合并|不能混为一谈)/u);
});

test('dispatch registers the runtime actor before task in-flight and closes spawn failures', () => {
  const guide = read(GUIDE_PATH);
  const hotPath = section(guide, '### Cross-harness 调派热路径', '### 4.0 决策程序');
  const actions = [
    '`ccm agent create`',
    '真实 handle',
    '`ccm agent bind`',
    '`ccm agent link`',
    '`ccm task start`',
  ];
  const positions = actions.map((action) => {
    const position = hotPath.indexOf(action);
    assert.notEqual(position, -1, `missing registered dispatch action: ${action}`);
    return position;
  });

  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(hotPath, /没有真实 handle[^\n]*不得[^\n]*`in_flight`/u);
  assert.match(hotPath, /spawn[^\n]*失败[^\n]*`ccm agent terminal`/iu);
  assert.match(hotPath, /native attempt[^\n]*(?:专属|dedicated)[^\n]*writer/iu);
  assert.match(hotPath, /精确[^\n]*(?:flag|语法)[^\n]*`using-ccm`/iu);
});

test('recon, wait, resume, and handoff consume registry evidence without inventing agent attach', () => {
  const guide = read(GUIDE_PATH);
  const asyncHitl = read(
    'plugin/src/skills/master-orchestrator-guide/canonical/references/async-hitl.md',
  );
  const resume = read(
    'plugin/src/skills/master-orchestrator-guide/canonical/references/resume-verify.md',
  );
  const handoff = read(
    'plugin/src/skills/master-orchestrator-guide/canonical/references/handoff.md',
  );
  const recovery = `${guide}\n${asyncHitl}\n${resume}\n${handoff}`;

  for (const action of ['ccm agent list', 'ccm agent show', 'ccm agent probe']) {
    assert.match(recovery, new RegExp(action, 'u'), `missing recovery action: ${action}`);
  }
  assert.match(recovery, /`ccm agent show`[^\n]*(?:stored|已存|返回)[^\n]*attach[^\n]*command/iu);
  assert.doesNotMatch(recovery, /ccm agent attach/u);
  assert.match(recovery, /agent[^\n]*terminal[^\n]*(?:≠|不等于)[^\n]*task[^\n]*done/iu);
  assert.match(recovery, /父 task[^\n]*独立[^\n]*验收/u);
});

test('initialization surfaces carry only the task-agent-attempt identity anchor', () => {
  for (const path of INIT_SURFACES) {
    const source = read(path);
    assert.match(source, /task[^\n]*(?:规划|交付)[^\n]*单元/iu, `${path}: task`);
    assert.match(source, /agent[^\n]*(?:运行时行动者|runtime actor)/iu, `${path}: agent`);
    assert.match(source, /attempt[^\n]*(?:执行证据|execution evidence)/iu, `${path}: attempt`);
    assert.match(source, /没有真实 handle[^\n]*不得[^\n]*`in_flight`/u, `${path}: handle gate`);
    assert.match(source, /terminal[^\n]*(?:≠|不等于)[^\n]*task[^\n]*done/iu, `${path}: terminal`);
    assert.doesNotMatch(
      source,
      /ccm agent (?:create|bind|link|terminal|probe|list|show)/u,
      `${path}: command grammar belongs to using-ccm`,
    );
  }
});

test('cross-harness worker choice pervades responsibilities, lenses, aesthetics, and executor choice', () => {
  const guide = read(GUIDE_PATH);
  const responsibilities = section(guide, '### 你的职责', '### 你的底线');
  const lenses = section(guide, '### 七镜头', '### 好编排长什么样');
  const aesthetics = section(guide, '### 好编排长什么样', '### 红线');
  const executors = section(guide, '### 4.2 executor 选择', '### 4.3 用量检查');

  assert.match(responsibilities, /全部本机可用 harness[^\n]*worker/u);
  assert.match(lenses, /origin harness[^\n]*不是[^\n]*候选边界/u);
  assert.match(lenses, /目标 harness[^\n]*模型[^\n]*(?:能力|成本|配额)/u);
  assert.match(aesthetics, /harness\s*×\s*模型\s*×\s*executor/u);
  assert.match(executors, /`executor`[^\n]*不等于[^\n]*target harness/u);
  assert.match(executors, /planning\s*\/\s*routing[^\n]*target harness/u);
  assert.match(executors, /origin harness[^\n]*默认/u);
});

test('every host adapter source exposes local and cross-harness dispatch as one worker pool', () => {
  for (const host of HOSTS) {
    const root = `plugin/src/skills/master-orchestrator-guide/adapters/${host}/overlays`;
    const summary = read(`${root}/background-dispatch-summary.md`);
    const lens = read(`${root}/background-dispatch-lens.md`);
    const reference = read(`${root}/dispatch-reference-summary.md`);
    const mapping = read(`${root}/background-dispatch-executor-mapping.md`);
    const executor = read(`${root}/executor-value-guidance.md`);

    assert.match(summary, /本 host[^\n]*cross-harness/iu, `${host}: summary`);
    assert.match(lens, /target harness[^\n]*origin harness/iu, `${host}: lens`);
    assert.match(reference, /跨 harness[^\n]*worker/u, `${host}: reference`);
    assert.match(mapping, /target harness[^\n]*本 host/iu, `${host}: mapping`);
    assert.match(mapping, /其他本机 harness[^\n]*`ccm` worker/iu, `${host}: mapping cross-harness`);
    assert.match(executor, /worker pool[^\n]*target harness/iu, `${host}: executor`);
    assert.match(executor, /origin harness[^\n]*默认/iu, `${host}: executor default`);
  }
});

test('the hot path orders stable ccm actions and exposes only the high-frequency model-policy grammar', () => {
  const guide = read(GUIDE_PATH);
  const hotPath = section(guide, '### Cross-harness 调派热路径', '### 4.0 决策程序');

  const actions = [
    'ccm harness list',
    'ccm worker help',
    'ccm provider facts',
    'ccm quota status --machine-wide',
    'ccm --harness <target> usage show|advise',
    'ccm quota preflight',
    'ccm route advise',
    'ccm worker run',
  ];
  const positions = actions.map((action) => {
    const position = hotPath.indexOf(action);
    assert.notEqual(position, -1, `missing hot-path action: ${action}`);
    return position;
  });
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(hotPath, /spawned=false/u);
  assert.match(hotPath, /全机缓存读面[^\n]+不触发 provider refresh/u);
  assert.match(hotPath, /unknown[^\n]+不推断为 ample/u);
  assert.match(hotPath, /using-ccm/u);
  for (const command of [
    'ccm model-policy show --task <task-taxonomy> --json',
    'ccm model-policy advise --input <json|@file|-> --json',
    'ccm model-policy <verb> --help',
  ]) assert.match(hotPath, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  const commandTokensWithGrammar = [...hotPath.matchAll(/`(ccm[^`]*(?:--|<)[^`]*)`/gu)].map(
    (match) => match[1],
  );
  assert.deepEqual(commandTokensWithGrammar, [
    'ccm model-policy show --task <task-taxonomy> --json',
    'ccm quota status --machine-wide --json',
    'ccm --harness <target> usage show|advise --json',
    'ccm model-policy advise --input <json|@file|-> --json',
    'ccm model-policy <verb> --help',
  ]);
  assert.doesNotMatch(hotPath, /stdout_bytes|exit_code|automatic_spawn_limit/u);
});

test('ccm worker dispatch requires an outer tracked background handle, never the synchronous wrapper result', () => {
  const guide = read(GUIDE_PATH);
  const discipline = section(guide, '### Rationalization Table', '### 哲学是动机');

  assert.match(discipline, /真实 agent 或 background process\/session handle/u);
  assert.match(discipline, /`ccm` worker[^\n]*当前 origin[^\n]*后台/u);
  assert.match(discipline, /handle[^\n]*后台机制[^\n]*不是[^\n]*同步 wrapper/u);
  assert.doesNotMatch(discipline, /Agent\s*\/\s*Bash|agentId\s*\/\s*shell handle/u);

  for (const host of HOSTS) {
    const root = `plugin/src/skills/master-orchestrator-guide/adapters/${host}/overlays`;
    for (const file of ['background-dispatch-executor-mapping.md', 'executor-value-guidance.md']) {
      const source = read(`${root}/${file}`);
      assert.match(
        source,
        /(?:`ccm` worker[^\n]*后台|后台[^\n]*`ccm` worker)/u,
        `${host}: ${file}`,
      );
      assert.match(source, /handle[^\n]*后台机制[^\n]*不是[^\n]*wrapper/iu, `${host}: ${file}`);
      assert.doesNotMatch(
        source,
        /`ccm` worker wrapper[^\n]*(?:process handle|均必给 handle)/u,
        `${host}: ${file}`,
      );
    }
  }
});

test('identity guidance does not duplicate provider flags or the full worker grammar', () => {
  const guide = read(GUIDE_PATH);
  assert.doesNotMatch(guide, /--model|--effort|--sandbox|--ask-for-approval|--list-models/u);
  assert.doesNotMatch(guide, /--cwd|--timeout-ms|--max-output-bytes/u);

  const sources = [];
  for (const host of HOSTS) {
    const root = `plugin/src/skills/master-orchestrator-guide/adapters/${host}/overlays`;
    for (const file of [
      'background-dispatch-summary.md',
      'background-dispatch-lens.md',
      'dispatch-reference-summary.md',
      'background-dispatch-executor-mapping.md',
      'executor-value-guidance.md',
    ]) {
      sources.push(read(`${root}/${file}`));
    }
  }

  for (const source of sources) {
    assert.doesNotMatch(source, /ccm worker (?:help|run)/u);
    assert.doesNotMatch(source, /--model|--effort|--sandbox|--ask-for-approval|--list-models/u);
  }
});
