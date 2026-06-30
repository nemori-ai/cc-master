import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('plugin.json is valid and well-formed', () => {
  const j = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(j.name, 'cc-master');
  assert.ok(typeof j.version === 'string' && j.version.length > 0);
  assert.ok(typeof j.description === 'string' && j.description.length > 0);
});

test('hooks.json registers all 7 hook scripts across 5 events via plugin-root paths', () => {
  const h = JSON.parse(read('hooks/hooks.json'));
  assert.ok(h.hooks.UserPromptSubmit, 'UserPromptSubmit registered');
  assert.ok(h.hooks.Stop, 'Stop registered');
  assert.ok(h.hooks.SessionStart, 'SessionStart registered');
  assert.ok(h.hooks.PostToolBatch, 'PostToolBatch registered');
  assert.ok(h.hooks.PostToolUse, 'PostToolUse registered (board-lint, T9)');
  // Stop carries three hooks: goal-hook (verify-board) + usage-pacing + identity-nudge (IDNUDGE·ADR-020).
  assert.equal(h.hooks.Stop.length, 3, 'Stop has verify-board, usage-pacing, identity-nudge');
  // PostToolUse carries the board-lint hook, matcher-scoped to edit tools.
  assert.match(JSON.stringify(h.hooks.PostToolUse), /Write\|Edit\|MultiEdit/, 'PostToolUse matcher scopes to edit tools');
  const all = JSON.stringify(h);
  // v2 收编（ADR-013 §2.4）：reinject / posttool-batch / verify-board 从 bash 收编为 node。
  // T4-1b 解耦（ADR-014）：board-lint / verify-board 改为优先经进程边界 shell 调 ccm 二进制读 board，旧
  //   require(board-lint-core/board-model) 降为 fallback（保留·stage3 才删）。bootstrap-board.sh 仍为 bash
  //   （唯一豁免的 ARM 动作）；usage-pacing.js / identity-nudge.js 本就是 node。
  // ADR-020：identity-nudge.js（IDNUDGE·Stop 周期身份提示·首个写 board 的 hook·经 ccm board set-param 写 runtime.*）。
  //   本断言只验 7 个 hook 都在 hooks.json 里注册。
  for (const s of ['bootstrap-board.sh', 'verify-board.js', 'reinject.js', 'posttool-batch.js', 'usage-pacing.js', 'board-lint.js', 'identity-nudge.js']) assert.match(all, new RegExp(s.replace(/\./g, '\\.')));
  assert.match(all, /CLAUDE_PLUGIN_ROOT/);
});

test('sentinel consistency: command body carries the exact string the bootstrap hook greps', () => {
  const cmd = read('commands/as-master-orchestrator.md');
  const hook = read('hooks/scripts/bootstrap-board.sh');
  assert.match(cmd, /<!-- cc-master:bootstrap:v1 -->/, 'command embeds body sentinel');
  assert.match(hook, /cc-master:bootstrap:v1/, 'hook greps body sentinel');
  assert.match(hook, /cc-master:as-master-orchestrator/, 'hook also greps command-name sentinel');
});

// ── ADR-018 标签注入防回潮 lint（AGENTS.md §13）──────────────────────────────────────────────────────
// 所有 hook 往 agent context 注入的 transient 文本都须按 ADR-018 标签写（ambient/advisory/directive·closed
//   set·source 必填）。reinject（魂重注）与 bootstrap（ARM 角色注入）是 agent 的操作 substrate（ADR-018 §2.5）
//   ——**豁免**，不该被包成任一标签。这道 lint 防「裸 prose 注入」回潮：非-substrate hook 凡注入（emit
//   additionalContext / Stop block reason），其文本必经共享标签包装器（hook-common 的 ambient/advisory/
//   directive，语法 `<ambient|advisory|directive source="...">`）。
test('ADR-018: non-substrate hooks tag-wrap their agent-context injection (anti-regression)', () => {
  // 非-substrate 注入 hook：每个都必须用至少一个标签包装器（确凿引用 ADR-018 标签体系）。
  const nonSubstrate = ['usage-pacing.js', 'posttool-batch.js', 'board-lint.js', 'verify-board.js', 'identity-nudge.js'];
  // 标签包装器调用（hook-common 暴露的三个）。匹配 `advisory(` / `ambient(` / `directive(` 或字面标签语法。
  const TAG_CALL = /\b(ambient|advisory|directive)\s*\(/;
  const TAG_LITERAL = /<(ambient|advisory|directive)\s+source=/;
  for (const f of nonSubstrate) {
    const src = read(`hooks/scripts/${f}`);
    // 该 hook 确实会注入（emit additionalContext 或 Stop block reason）——否则这条断言不适用。
    const injects = /additionalContext|"reason"|decision":"block/.test(src);
    assert.ok(injects, `${f} is expected to inject into agent context (additionalContext / block reason)`);
    assert.ok(
      TAG_CALL.test(src) || TAG_LITERAL.test(src),
      `${f} injects into agent context but does NOT tag-wrap it (ADR-018 §13: must use <ambient|advisory|directive>). ` +
        `Raw-prose injection is forbidden — wrap via hook-common's ambient/advisory/directive.`,
    );
  }
  // hook-common 的三个标签包装器：每个都必须带 source=（P6 source 必填）+ closed set（不膨胀）。
  const common = read('hooks/scripts/hook-common.js');
  for (const tag of ['ambient', 'advisory', 'directive']) {
    assert.match(common, new RegExp(`function ${tag}\\(`), `hook-common exposes ${tag}() wrapper`);
    assert.match(common, new RegExp(`<${tag} source=`), `hook-common ${tag}() emits source= attr (P6)`);
  }
  // strength 只给 advisory（ADR-018 §2.2 closed set：ambient 恒低 / directive 恒满，不开 strength）。
  assert.match(common, /<advisory source="\$\{source\}" strength=/, 'advisory wrapper carries strength= (weak|strong)');
  assert.doesNotMatch(common, /<ambient source="[^"]*" strength=/, 'ambient must NOT carry strength (恒低)');
  assert.doesNotMatch(common, /<directive source="[^"]*" strength=/, 'directive must NOT carry strength (恒满)');

  // substrate 豁免（ADR-018 §2.5）：reinject / bootstrap 的**角色重注 / ARM 上下文注入**是 substrate，不该被
  //   标签包装。断言它们 NOT 引用标签包装器——豁免是有意的、非偶然遗漏（防有人误给 substrate 加标签）。
  const reinject = read('hooks/scripts/reinject.js');
  const bootstrap = read('hooks/scripts/bootstrap-board.sh');
  assert.doesNotMatch(reinject, TAG_CALL, 'reinject is substrate (ADR-018 §2.5) — must NOT tag-wrap');
  assert.doesNotMatch(reinject, TAG_LITERAL, 'reinject is substrate — no tag literals');
  // bootstrap 的例外（ADR-021）：其 ARM 角色注入（fresh / resume context）仍是 substrate·tag-free，但 ccm
  //   install-presence 硬查失败时注入一条 **transient 硬约束 directive**（`<directive source="bootstrap">`·ccm
  //   未装·agent-relay 提醒用户）——这 NOT substrate（substrate 是角色/魂重注·这是「硬前置缺失」的硬约束告警），
  //   故合法带 directive 标签。契约收窄为：bootstrap 里**唯一允许**的 tag literal 是这条 ccm-missing directive；
  //   其它 substrate 注入（inject_ctx 的 fresh/resume context）一律不带标签。
  const bootstrapTagLiterals = bootstrap.match(/<(ambient|advisory|directive)\s+source=/g) || [];
  for (const lit of bootstrapTagLiterals) {
    assert.match(
      lit,
      /<directive source=/,
      `bootstrap may only carry the ccm-missing <directive source="bootstrap"> (ADR-021); found a non-directive tag literal: ${lit}`,
    );
  }
  // 且这条 directive 确实在场（ADR-021 实现存在性·防被误删回退到「无硬前置 fail-loud」）。
  assert.match(
    bootstrap,
    /<directive source="bootstrap">/,
    'bootstrap carries the ccm install-presence directive (ADR-021): ccm missing → agent-relay reminder',
  );
});

test('every SKILL.md (distributed + project-internal) has YAML frontmatter with name + description', () => {
  // Validate BOTH the distributed plugin skills (skills/) and the project-internal dev skills
  // (.claude/skills/, e.g. cc-master-skillsmith) — the latter are not shipped but are still tracked
  // skills that must load, so they get the same structure gate (Finding #1 YAML footgun applies to both).
  for (const label of ['skills', '.claude/skills']) {
    const dir = join(ROOT, label);
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir)) {
      if (!statSync(join(dir, d)).isDirectory()) continue;
      if (!existsSync(join(dir, d, 'SKILL.md'))) continue;
      const md = read(`${label}/${d}/SKILL.md`);
      assert.match(md, /^---\n[\s\S]*?^name:\s*\S+/m, `${label}/${d}/SKILL.md has name`);
      assert.match(md, /\ndescription:\s*\S+/m, `${label}/${d}/SKILL.md has description`);
    }
  }
});
