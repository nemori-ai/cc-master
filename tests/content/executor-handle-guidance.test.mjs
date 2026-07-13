import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const HOSTS = ['codex', 'cursor'];
const STALE_POST_DISPATCH_EXECUTOR_GUIDANCE = [
  /只有在[^\n]*真实启动[^\n]*才写/,
  /(?:spawn|Task)[^\n]*后才写\s*`executor=subagent`/,
];

test('Codex/Cursor executor guidance separates future planning from real dispatch evidence', () => {
  for (const host of HOSTS) {
    const sourceRoot = `plugin/src/skills/using-ccm/adapters/${host}/overlays`;
    const source = [
      read(`${sourceRoot}/executor-table-rows.md`),
      read(`${sourceRoot}/executor-decision-tail.md`),
    ].join('\n');
    const rendered = read(`plugin/dist/${host}/skills/using-ccm/references/board-model-guide.md`);

    for (const [label, prose] of [['source', source], ['rendered', rendered]]) {
      assert.match(
        prose,
        /`ready`\s*\/\s*`blocked`[^\n]*可先[^\n]*`executor=subagent`/,
        `${host} ${label}: future tasks may declare executor=subagent before dispatch`,
      );
      assert.match(
        prose,
        /真实[^\n]*(?:spawn|Task)[^\n]*(?:handle|句柄)|(?:spawn|Task)[^\n]*真实[^\n]*(?:handle|句柄)/,
        `${host} ${label}: only a real host-native dispatch result supplies the handle`,
      );
      assert.match(
        prose,
        /(?:handle|句柄)[^\n]*再[^\n]*`in_flight`/,
        `${host} ${label}: record the real handle before entering in_flight`,
      );
      assert.match(
        prose,
        /(?:当前主会话|主会话)[^\n]*(?:不得|不能|禁止)[^\n]*(?:冒充|代替)|(?:不得|不能|禁止)[^\n]*(?:当前主会话|主会话)[^\n]*(?:冒充|代替)/,
        `${host} ${label}: a current-session id cannot substitute for a worker handle`,
      );
      assert.match(
        prose,
        /未验证[^\n]*(?:派发原语|等价物)[^\n]*(?:不得|不能|禁止)|(?:不得|不能|禁止)[^\n]*未验证[^\n]*(?:派发原语|等价物)/,
        `${host} ${label}: an unverified host primitive cannot substitute for dispatch evidence`,
      );
      for (const stale of STALE_POST_DISPATCH_EXECUTOR_GUIDANCE) {
        assert.doesNotMatch(
          prose,
          stale,
          `${host} ${label}: executor is a future execution plan, not a post-dispatch field`,
        );
      }
    }
  }
});

test('board-v2 blueprint scopes the executor-handle warning to in-flight work and defers authority to the engine', () => {
  const spec = read('design_docs/2026-06-23-board-v2-spec.md');
  assert.match(spec, /历史实现蓝图/);
  assert.match(spec, /@ccm\/engine[^\n]*board-model/);
  assert.match(
    spec,
    /status\s*=\s*`?in_flight`?[^\n]*executor[^\n]*\{subagent,\s*workflow\}[^\n]*(?:handle|句柄)/,
  );
  assert.doesNotMatch(
    spec,
    /^\|\s*`executor`∈\{subagent,\s*workflow\}\s*⇒\s*handle 存在/m,
    'the historical blueprint must not present the retired state-blind invariant as current',
  );
});
