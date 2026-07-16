# kimi-code adapter — end-to-end live smoke evidence

状态：证据记录（K6 集成收口）。日期：2026-07-16。分支：`feat/kimi-code-harness`。宿主：本机真实 **kimi v0.26.0**（`~/.kimi-code/bin/kimi`）。

本文记录 kimi-code 作为第四 host 的**真实装载 + hook 触发**冒烟证据。设计与整合步见
[`2026-07-16-kimi-code-adapter-design.md`](2026-07-16-kimi-code-adapter-design.md) §8.3 / §10.2。

## 隔离与安全纪律

- **隔离 kimi home**：`KIMI_CODE_HOME=<scratchpad>/iso-kimi-home`——把 `plugin/dist/kimi-code` 复制进
  `$KIMI_CODE_HOME/plugins/managed/cc-master/` 并写 `installed.json`（`{version:1,plugins:[{id:"cc-master",
  root,source:"local-path",enabled:true,...}]}`）。**绝不污染用户真实 `~/.kimi-code`。**
- **隔离 board home**：`CC_MASTER_HOME=<scratchpad>/iso-ccm-home*`，board 落隔离目录，不碰用户真实 `~/.cc_master`。
- **凭证只读不写**：冒烟前记录真实凭证 `~/.kimi-code/credentials/kimi-code.json` 的 sha256 + mtime 作 baseline；
  隔离 home **不含 credentials**——真实 `kimi -p` 因此在 UserPromptSubmit hook 触发**之后**才 auth 失败（见 Phase B），
  全程从未读写真实凭证。冒烟后复核：hash + mtime **逐字节不变**。
- **kimi-aware ccm**：`CCM_BIN=ccm/apps/cli/dev-bin/ccm`（本 worktree 构建，含 kimi-code harness）——使 board 写入
  `owner.harness=kimi-code` 过 `FMT-HARNESS` lint。

## ① 真实 kimi 装载 plugin + ② UserPromptSubmit bootstrap hook 触发（Phase B：真实 `kimi -p`）

```bash
KIMI_CODE_HOME=<iso-kimi-home> CC_MASTER_HOME=<iso-ccm-home3> CCM_BIN=ccm/apps/cli/dev-bin/ccm \
  ~/.kimi-code/bin/kimi -p "cc-master:as-master-orchestrator kimi live smoke: verify plugin load and bootstrap hook" \
  --output-format stream-json
```

真实 kimi 输出（stream-json，摘录）：

```json
{"role":"assistant","content":"UserPromptSubmit hook\n\ncc-master fresh: created and armed kimi-code orchestration board at <iso-ccm-home3>/boards/20260716T193405Z-221163.board.json\nMANDATORY NEXT STEP: ... Invoke master-orchestrator-guide, clarify/refine an unambiguous Goal Contract ...\nsession_id=session_92cceec0-f85a-4b92-9222-ef24a2986989\nraw_request_present=true ..."}
error: failed to run prompt: auth.login_required: OAuth provider "managed:kimi-code" requires login before it can be used.
```

- **plugin 被发现装载**：真实 kimi 二进制加载了 managed 安装的 cc-master plugin，并把 UserPromptSubmit hook 的输出 surface 进 stream-json（`"UserPromptSubmit hook\n\ncc-master fresh: ..."`）。
- **bootstrap hook 触发**：hook 在 prompt 提交时 fire，用**真实 kimi session_id**（`session_92cceec0-...`，非合成）建板并武装。落盘 board：

```
owner.harness  = kimi-code      ← 真实 kimi 环境 KIMI_CODE_HOME 使 stampHarness 可信探测为 kimi-code
owner.active   = true
owner.session_id = session_92cceec0-f85a-4b92-9222-ef24a2986989
schema         = cc-master/v2
```

- **auth 在 hook 之后才失败**：`auth.login_required` 发生在 hook 建板成功**之后**——证明 UserPromptSubmit hook 在 LLM/auth 步骤之前触发，因此无需真实凭证即可取得完整 plugin-load + hook-fire 证据。
- **凭证安全复核**：真实 `~/.kimi-code/credentials/kimi-code.json` 冒烟前后 sha256 `786f4b12…` + mtime `2026-07-16 19:26:38.861176105` **逐字节不变**。

## ③ board-guard / verify-board 最小链在武装后生效（Phase A：真实 dist hooks，合成 kimi stdin）

真实 dist kimi launcher（`hooks/_hosts/kimi-code/launcher.js`）+ 真实 dist cores，喂 kimi 形状的合成 stdin
（snake_case、`session_id`、`prompt` 为 content-block 数组）。

**归一化（`--echo-normalized`）**：`harness=kimi-code`、event `UserPromptSubmit → user-prompt-submit`、
`session_id` 提取正确、`prompt` 数组保留；注入 env `CC_MASTER_HARNESS=kimi-code` 等。

**board-guard（PreToolUse，尝试 Write 目标 board 文件）→ deny**：

```json
{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"<directive source=\"board-guard\">\n直接 file-edit board 被拦（board-guard·rule:board-write-single-path）。\n... fix：改用 ccm verb ...\n</directive>"}}
```

**verify-board（Stop）→ deny（Stop-continuation 硬门）**：

```json
{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"<directive source=\"verify-board\">\ncc-master kimi-code Stop continuation required:\n... Goal Contract is pending; refine it with ccm goal set ...\n</directive>"}}
```

- kimi 注入 envelope 正确：context/message 走 `hookSpecificOutput`，block/deny 走
  `permissionDecision="deny" + permissionDecisionReason`（ADR-018 标签写进文本体）。
- verify-board 在 kimi 上以 **`implemented-blocking`** 形态生效（Stop-deny 续跑硬门）。

## harness 探测说明（非 bug）

`ccm board stamp-harness` 用**可信探测** `detectTrustedHarnessId`（有意忽略可被 agent 伪造的 `CC_MASTER_HARNESS`
env hint），kimi-code adapter 的 `detect(env)` 判据是 `!!env.KIMI_CODE_HOME`。真实 kimi session 恒设
`KIMI_CODE_HOME`，故可信探测得 `kimi-code`（Phase B 已证）。合成 stdin 若不设 `KIMI_CODE_HOME`，会退回本机
active-env（claude-code）——这是合成环境不完整的产物，非 adapter bug；设上 `KIMI_CODE_HOME` 后即正确 stamp
`kimi-code`（Phase A 复核已证）。

## 结论

kimi-code adapter 在本机真实 kimi v0.26.0 上：plugin 被真实发现装载、UserPromptSubmit bootstrap hook 真实触发
并建/武装 `owner.harness=kimi-code` 的 board、board-guard/verify-board 最小链在武装后以正确 kimi envelope 生效；
全程隔离，真实用户 kimi home 与凭证零改动。
