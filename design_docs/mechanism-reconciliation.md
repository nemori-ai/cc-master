# 机制 ↔ skill 对账矩阵

> **这张表是什么**：每个机制（command / hook / 运行时 script / dev-only script）一行——它的业务流一句话摘要、被哪些 skill prose 引用、上次对账日期。配套的每机制契约级文档在 `design_docs/mechanisms/<name>.md`（五段：触发输入 / 业务流 / 输出副作用 / 关键不变式 / 失败模式）。
>
> **怎么用**：机制业务逻辑变更后，对照这张表找到被它引用的 skill prose 文件，逐一核对 prose 描述是否仍与 on-disk 实现一致——不一致即语义漂移，记进文末 `## 疑似漂移清单`。这是**轻量手维护**的对账源（T30 设计闸采路线），不接 CI 强制门。
>
> **范围**：`design_docs/` 不随 plugin 分发，文档内引用仓内文件用裸相对路径即可（无 `${CLAUDE_*}` 要求）。
>
> **「被哪些 skill prose 引用」的口径**：`grep -rln <机制名> skills/`（排除 `skills/*/scripts/` 自身源码）。不含 `DESIGN.md`（那是 skill 设计稿、非 agent 指导 prose）的纯设计性提及——但保留它作交叉参考标注。

| 机制 | 业务流一句话摘要 | 被哪些 skill prose 引用 | 上次同步日期 |
|---|---|---|---|
| **commands** | | | |
| `commands/as-master-orchestrator.md` | 据注入串开头自判 fresh/resume，fresh 拆 DAG、resume 接管 reconcile 孤儿，每回合跑决策程序；保留 hook 盖的 owner.session_id | `orchestrating-to-completion/references/board.md`、`.../references/handoff.md` | 2026-06-21 |
| `commands/status.md` | 只读渲染按状态分组的 board 视图 + 心算临界路径 + program-state 健康检查 | （无直接命名引用；`/status` 概念见 cost-and-pacing.md / handoff.md） | 2026-06-21 |
| `commands/stop.md` | 用户确认后把认准 board 的 owner.active 置 false（显式可逆归档、不删文件） | （无直接命名引用；`/stop` 概念见 board.md / handoff.md） | 2026-06-21 |
| `commands/handoff-to-new-session.md` | 6 步：quiesce → drain 就地验收 → 写叙事 handoff 文档 → log+heartbeat → 归档 → 告诉用户续跑命令 | `orchestrating-to-completion/SKILL.md`、`.../references/handoff.md` | 2026-06-21 |
| `commands/view.md` | 后台起 view-server.js、抓 `127.0.0.1:<port>` URL 交用户、只读每 2s 活轮询 | （无直接命名引用；功能自洽） | 2026-06-21 |
| ~~`commands/accounts.md`~~ **（退役·ADR-019）** | 账号操作已全归 `ccm account` CLI（用户直接敲·token-blind）+ 自动切号在 usage-pacing hook；命令零增量零覆写 = 装饰，删除。概念叙事见 `using-ccm/references/account-pool.md` | — | 2026-06-29 |
| **hooks** | | | |
| `hooks/scripts/bootstrap-board.sh` | UserPromptSubmit：dual-sentinel 触发 → fresh 建板盖 sid / resume 选板 live-probe 后重盖 owner；唯一豁免武装闸者 | `orchestrating-to-completion/references/board.md`（+ DESIGN.md 设计性） | 2026-06-21 |
| `hooks/scripts/reinject.sh` | SessionStart：武装闸过后注入 orchestrator 身份 + active 板 listing + dangling stale/escalated 节点 | `orchestrating-to-completion/references/board.md`、`.../references/external-coordinates.md`（+ DESIGN.md） | 2026-06-21 |
| `hooks/scripts/verify-board.sh` | Stop goal-hook：据 status 分布 + fingerprint 握手决定 block/allow，watchdog 提醒，fuse 防死锁 | `orchestrating-to-completion/references/board.md`、`.../references/async-hitl.md`（+ DESIGN.md） | 2026-06-21 |
| `hooks/scripts/posttool-batch.sh` | PostToolBatch：sub-agent 闸 + 武装闸过后逐板独立 WIP 过调度软警告（永不 block） | `orchestrating-to-completion/references/board.md`（+ DESIGN.md） | 2026-06-21 |
| `hooks/scripts/usage-pacing.js` | Stop（node）：武装闸过后账户权威优先判 5h/7d 撞墙/欠用/7d dispatch 闸，effective-N 从 accounts.json 算，非阻断注入 | `orchestrating-to-completion/references/cost-and-pacing.md`、`.../references/board.md`、`.../references/external-coordinates.md`、`account-management/references/account-scheduling.md` | 2026-06-21 |
| `hooks/scripts/board-lint.js` | PostToolUse（node）：四闸（工具/路径/武装/目标本 session active 板）过后跑共享核心、非阻断注入 lint 报告 | `orchestrating-to-completion/SKILL.md`、`.../references/board.md` | 2026-06-21 |
| `hooks/scripts/board-lint-core.js` | 共享 lint 核心（R1-R6：合法 JSON / 窄腰 / task 契约 / deps 图完整性 / viewer 字段），被 hook + 运行时脚本共用 | （无直接命名引用；规则集语义见 board.md §board lint） | 2026-06-21 |
| **运行时 scripts** | | | |
| `account-management/scripts/switch-account.sh` | 选号 → refresh（REFRESH_TOKEN_URL host 白名单反 exfiltration）→ **取跨进程换号锁** → 覆写官方共享凭证三存储（无重启换号·全或无 + 中断两阶段恢复：未提交回滚 / 已提交 forward-align 补 keychain③）→ 先 setActive 后 snapshot 翻 registry active | `orchestrating-to-completion/SKILL.md`、`orchestrating-to-completion/references/cost-and-pacing.md`、`account-management/SKILL.md`、`account-management/references/account-scheduling.md`、`account-management/references/vault-security.md` | 2026-06-22 |
| `account-management/scripts/account-add.sh` | 直读 keychain「Claude Code-credentials」完整 blob（含 refreshToken）→ 存 vault（file 全或无 + 精确前缀 + `with_vault_lock`）+ 写 registry entry（`mutateRegistry` 锁）；身份 guard + 手动恢复旁路（probe vault 已有有效 blob 升 switchable:true） | `account-management/SKILL.md`、`.../references/vault-security.md` | 2026-06-22 |
| `account-management/scripts/account-delete.sh` | token-blind 按 email **精确前缀**删 vault（不带 -w·全或无 + `with_vault_lock`）+ 删 registry entry（`mutateRegistry` 锁） | `account-management/SKILL.md`、`.../references/vault-security.md` | 2026-06-22 |
| `account-management/scripts/account-list.sh` | 只读列号池非密信息（永不取 token 值），file-token 存在性 **bash 层 token-blind awk 布尔预计算**（blob 不进 node 诊断进程）、`?`=无到期记录 unknown 口径，switchable:false 标 no-token | `account-management/SKILL.md`、`.../references/vault-security.md` | 2026-06-22 |
| `account-management/scripts/accounts-lib.js` | accounts.json registry 读/写/校验核心（原子写 + token-leak 拒写 + active 唯一性 + **`mutateRegistry` 咨询文件锁 RMW** + 通用文件锁 + fileVaultLineMatch awk index 守卫），被各 account 脚本 require | `account-management/SKILL.md`、`.../references/vault-security.md` | 2026-06-22 |
| `account-management/scripts/select-account.js` | 选号调度（W5/W7 评分 + **7d 硬闸排除候选** + switchable:false 排除 + 临到期降权 + 弱信号兜底），完全不碰 token | `account-management/SKILL.md`、`.../references/account-scheduling.md`、`orchestrating-to-completion/references/cost-and-pacing.md` | 2026-06-22 |
| ~~`orchestrating-to-completion/scripts/cc-usage.sh`~~ **（退役·被 `ccm usage advise` 取代·ADR-015/024）** | ~~python 解析本地 JSONL 算 5h/7d，账户权威 sidecar 优先、本地反推 fallback（标 approx）~~ 已删；usage 感知 + 配速数学收口进 `@ccm/engine`，主线改跑 `ccm usage advise --json`（单侧 verdict） | — | 2026-07-02 |
| `orchestrating-to-completion/scripts/codex-review.sh` | 封装 `codex exec review` 出 verdict，空/失败 → 按未通过（exit 2）；read-only sandbox | `orchestrating-to-completion/references/resume-verify.md`、`.../references/cost-and-pacing.md` | 2026-06-21 |
| `orchestrating-to-completion/scripts/statusline-capture.js` | status-line（非 hook）捕获账户权威 rate_limits 落 sidecar，原子写、失败静默 | `orchestrating-to-completion/references/cost-and-pacing.md`、`account-management/references/account-scheduling.md` | 2026-06-21 |
| `orchestrating-to-completion/scripts/view-server.js` | 本地 127.0.0.1 http server 渲 board DAG，只读、零联网、每请求 fresh 读 board | （无直接命名引用；由 view.md 启动） | 2026-06-21 |
| ~~`orchestrating-to-completion/scripts/board-lint.js`~~ **（退役·被 `ccm board lint` 取代·ADR-014）** | ~~独立手动 board lint（复用 hook 同一份核心），显式调用不需武装闸~~ 已删；lint 引擎迁入 `@ccm/engine`，独立手动 lint 改跑 `ccm board lint --board <path> --raw --json` | — | 2026-07-02 |
| **dev-only scripts**（不随 plugin 分发·红线 5） | | | |
| `scripts/eval-trigger.sh` | 跑 skill-creator Track A 触发准确率 eval 的薄包装 | （无 skill prose 引用；dev 流，见 AGENTS.md §8） | 2026-06-21 |
| `scripts/eval-benchmark.sh` | 跑 skill-creator Track B benchmark 聚合步的薄包装 | （无 skill prose 引用；dev 流，见 AGENTS.md §8） | 2026-06-21 |
| `scripts/skill-lint.sh` | 对每个 SKILL.md 跑静态 prose-lint 的 checker（四 check），绝不改文件 | （无 skill prose 引用；dev 流，见 AGENTS.md §6/§12） | 2026-06-21 |

---

## 疑似漂移清单

> 这一节汇总建表过程中发现的**疑似「机制实现与 skill prose 描述不符」**——T31a 只**记录不修**，喂给后续 T31c 修。每条：机制 → 哪个 skill 文件哪段 → 实现说 X 但 prose 说 Y。

**T31c（2026-06-22）post-TR32 同步**：TR32 对 account-management 做了近 2000 行硬化（codex R1-R19），上述六份 `mechanisms/script-account-*.md` + `script-accounts-lib.md` + `script-select-account.md` 已逐个对照 post-TR32 源码增量更新（registry 咨询文件锁 mutateRegistry / 跨进程换号锁 / file vault `with_vault_lock` + 全或无 + 精确前缀 / 中断两阶段恢复 rollback↔forward-align / REFRESH_TOKEN_URL host 白名单 / rotated-blob recovery / account-list bash 层 token-blind 布尔预计算 + `?` unknown 口径 / 7d 硬闸排除候选 / cc-usage timeout 默认 60s）。**prose 核对（vault-security.md / SKILL.md）：已同步、无残留漂移**——TR32 自身已把白名单 / rotated-token recovery / 精确前缀写进 `vault-security.md`（§删/重写 + §refresh 端点白名单 + §轮转后回写失败抢救），把 registry 锁注（`mutateRegistry`·咨询文件锁串行 RMW）写进 `account-management/SKILL.md` line 39。判定：**无 judgment-bearing SKILL prose 需改**（registry 锁是非纪律型机制事实陈述、已在 line 39 到位）。

---

**T31a 建表（2026-06-21）未发现确凿语义漂移。** 这是一份 post-0.8.0 / A2-refactor 刚收口的代码库，活体漂移例（0.8.0 把换号从 exec-restart 改成无重启凭证覆写）已在前序 PR 回流到 skill prose。逐项核对结论：

- **换号机制（switch-account.sh ↔ cost-and-pacing.md / account-scheduling.md / vault-security.md / account-management SKILL.md）**：prose 已全面对齐 **post-0.8.0 无重启凭证覆写**——「不再 exec 重启 / 不再 `--resume` 续板」「覆写官方共享凭证三存储」「运行中 claude 惰性 re-read 接管」「`--board` 已 deprecated no-op」均与实现一致。`setup-token` 的提及一律框定为「旧弃用路径、我们不用、它不产生 refreshToken」（正确，非漂移）。**无漂移。**
- **effective-N / num_account 来源迁移（usage-pacing.js ↔ board.md / cost-and-pacing.md / external-coordinates.md）**：prose 已对齐 **A2 T6**——「effective-N 由 usage-pacing.js 从号池 registry accounts.json 算、hook 不读 board 的 num_account / accounts[]」「`--num_account` 起跑 flag 已砍」均与实现一致（board 模板仍 ship 无害 `"num_account":1` 默认值，prose 已说明 hook 不读它）。**无漂移。**
- **账户权威 pacing（cc-usage.sh / statusline-capture.js / usage-pacing.js ↔ cost-and-pacing.md）**：prose 对齐 Finding #37——账户权威 used_percentage 优先、本地反推标 approx fallback、7d≥85% dispatch 闸只在账户口径触发、欠用加速侧反推路径禁用。**无漂移。**
- **wakeup watchdog（verify-board.sh ↔ async-hitl.md / board.md）**：prose 对齐——soft-observed 读法、ceiling=recon 触发器非死亡判据（Finding #60）、陈旧 wakeup 重开盲区（Finding #56）、退役两件一起做。**无漂移。**
- **board narrow waist / status enum（board-lint-core.js ↔ board.md）**：lint 规则集（R1-R6 + status enum 8 值 + deps required 硬窄腰）与 board.md 的窄腰契约一致。**无漂移。**

> **给 T31c 的提示**：本轮无漂移不代表对账无价值——它确立了「这些机制此刻与 prose 一致」的 baseline 与同步日期。后续机制业务逻辑再变时，对照本表逐项重核，凡发现不一致即在此节追加一条（机制 → skill 文件:段落 → 实现 vs prose），由 T31c 修。
