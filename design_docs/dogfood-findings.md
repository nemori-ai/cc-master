# cc-master Dogfood 发现台账

用 cc-master 自身 dogfood 本仓库过程中,记录「用着不爽的点 / 给 agent 的指导不对的点 / 效率没真正最大化的点」。
对应 go-to-market 三目标之 ①「持续优化」。每条:现象 → 根因 → 影响 → 处置 → 严重度 / 来源。

> 跨 session 交接说明:本文件是给「带 `--plugin-dir` 重启后的 orchestrator session」的便条与权威台账。
> 来源标注:`一手` = orchestrator 实操中亲历;`T1体检` = dogfood 系统体检 sub-agent 实测复现;`双重确认` = 两路独立同源命中。

---

## 严重度汇总

| # | 标题 | 严重度 | 状态 |
|---|---|---|---|
| 1 | skill frontmatter YAML 被冒号+空格打挂 | blocker | ✅ 已修(boot 前) |
| 2 | `/goal` 对 agent 不可执行(自驱机制空转 + 假安全感) | should-fix(逼近 blocker) | ✅ 已解(goal-hook 取代 + 拔除指导) |
| 3 | sub-agent「假完成」(completed 但 tool_uses=0 返回垃圾) | 运营经验(非 plugin bug) | 已应对(retry+端点验收) |
| 4 | `verify-board` 跨 session 误伤,砸并发卖点 | should-fix | ✅ 已修(goal-hook session 过滤,P2a) |
| 5 | `goal_condition` 含 `}`/`"` 被 reinject 静默截断 | should-fix | ✅ 已消(phase 段整段删除,P2b) |
| 6 | 命令含「assistant 做不到」的祈使 + status/stop 多 board 识别缺步骤 | nice-to-have | ✅ 已修(P2c-D) |
| 7 | 信息过载:灵魂公式/step-6 ledger/`/goal` 重复三四遍 | nice-to-have | ✅ 已修(拔除 /goal 大幅瘦身,P2b) |
| 8 | 「don't busy-poll」与后台 shell `until…sleep` 文案表面张力 | nice-to-have | ✅ 已修(dispatch.md 精简,P2b) |
| 9 | `wip_limit` 在 board.md 里 pinned vs flexible 自相矛盾 | nice-to-have | ✅ 已修(board.md 统一 flexible,P2b) |
| 10 | sub-agent 最终报告被 content filter 拦(CoC 模板触发),文件却已落盘 | 运营经验 | 已应对(端点验收实际产出) |
| 11 | lens-7「前台∥后台」在密集 HITL 时对 agent 拉力不足 | should-fix(skill) | 已识别(待固化进 SKILL) |
| 12 | 并行实现各跑子集 → 漏集成测试,端点跑全套才逮到 | 运营经验/should-fix | 已应对(端点全套) |
| 13 | orchestrator 红线「不演奏」vs 端点验收的微修张力 | nice-to-have(skill) | 已识别 |
| 14 | goal-hook 自我验证:真拦住 orchestrator 一次提前 yield | ✅ 机制验证(正向) | 活证据 / GTM 素材 |
| 15 | bootstrap sentinel 裸子串匹配,被「提及命令名」的输入(notification/result)误触发建空 board | should-fix | ✅ 已修(P2c-F 收紧前缀分支);marker 分支残留见 #16 |
| 16 | bootstrap marker 分支仍裸子串,被 sub-agent 报告内联引用 marker 误触发建空 board(#15 同类残留) | should-fix | ✅ 已修(P4b:marker 须 prompt 首非空行;codex 又逮到首行内联残漏→收紧为 standalone 精确匹配,见 #19) |
| 17 | phantom in_flight:标 board 在前、dispatch 在后,被 sibling 完成通知打断致漏派 worker | should-fix(流程纪律) | ✅ 已应对(先 dispatch 再标板 + agentId 实证);待固化进 AGENTS/SKILL |
| 18 | eval Track A 触发召回近零(冷启 claude -p 单轮欠表征真实触发),绝对召回不可当 description 判据 | should-fix(eval 可靠性) | 已记;infra 已交付跑通;Track A 宜作 precision+相对 delta,绝对召回 caveat 待后续提保真度 |
| 19 | codex 自审(新 reviewer 首跑)逮到 #16 修复的首行内联残漏(测试+自读都漏) | ✅ 机制验证(正向)+ 残漏已修 | codex needs-attention→TDD 收口(Case E3 + standalone 精确匹配),passed=21。reviewer 交付物活证据 / GTM 素材 |
| 20 | codex-review.sh 非功能:codex exec review 禁止自定义 PROMPT 与 --base/--uncommitted 同用,P2 只 bash -n 没真跑漏检 | should-fix(deliverable 可用性) | ✅ 已修(去自定义 PROMPT,靠 AGENTS.md 供约定);教训:带外脚本 V 端点必须真跑一次 |
| 21 | codex 功能 review 再逮两条:(A) goal-hook fingerprint 只哈希 status 多重集→身份变不重握(P4 缺口)(B) codex-review.sh 未强制 read-only,用户 danger-full-access 配置下 reviewer 可写仓库(P2 缺口) | ✅ 机制验证(正向)+ 2 should-fix 已修 | A:fingerprint→id+status+blocked_on(Case Q,passed=37);B:加 -c sandbox_mode=read-only。一程逮 #19/#20/#21 |
| 22 | codex 第4次再逮两条:(C) #21 的 fingerprint 扫全 board、把 log 等 flexible 字段也算→违反 narrow-waist(D) track-b 文档 codex 配对指向不工作的调用(审 diff 非 transcript + #20 互斥) | ✅ 机制验证(正向)+ 2 should-fix 已修 | C:fingerprint scope 到含 deps 的 task 行(Case R,passed=38);D:改 plain codex exec grade transcript。一程共逮 6 条→fuse 停自动循环 |
| 23 | meta-skill 误置为分发制品 + 命名过泛:authoring-skills 放进分发的 skills/、名字太通用(它其实是"怎么造本仓 skill"的项目自用工具) | should-fix(product hygiene) | ✅ 已修(git mv → .claude/skills/cc-master-skillsmith;引用全更;content 测试扩到也 iterate .claude/skills/)。用户 review catch |
| 24 | codex 复审两轮逮 region 提取两反向漏洞(`log` 截断 fail-open + 嵌套字段伪装 fail-closed)| must-fix + should-fix | ✅ 已修(`tasks_region` 双深度 string-aware awk,三轮 codex 放行)|
| 25 | Track A 满载环境信号死亡:正例 recall 地板=0,与 description 质量无关 | must-know(测量有效性)| 已记 caveat;语义改动降级定性评审 |
| 26 | 模型分层 + usage-pacing baseline 零失败 → 归类为 reference 知识非红线(TDD-for-skills 防编造未被违反的规则)| ✅ 机制验证(正向)| 落 `cost-and-pacing.md` + lens 软指针,不写红线 |
| 27 | codex 第二验收 4 轮逮 6 bug:cc-usage.sh 五 correctness(schema 契约/陈旧窗口/跨界清零/dedup 低报/未来行计数)+ cost-and-pacing.md effort 不可执行 lever | ✅ 机制验证(正向)+ 6 should-fix 已修 | A–F 全收口;fuse 据 #22 先例停自动循环;passed=10 |
| 28 | 常驻重注的魂(SKILL.md Vision-index)把已 live 的 H8(usage-pacing)标作「TODO/待批准」,误导未来每场 orchestration 以为 C2 pacing hook 不存在 | should-fix(指导失真)| ✅ 已修(POLISH-SOUL 端点验收亲读暴露→micro-fixup 校准3处,dot-graph 重验未扰);根因=MAPSYNC 只同步 H6/H5/H3 子集、漏 H8 |
| 29 | 公开落地页(README)demo 直接照搬一个真实保密项目的场景(数据模型 schema,标识符已隐去),且泄密早已潜伏在 walkthrough/smoke.sh/board.md(分发)——README 只是放大到最高曝光面 | **must-fix(泄密)** | ✅ 已修(用户 review catch→全仓 scrub 换通用 i18n 场景 + 彻底去外部出处痕迹 self-contain;repo-wide grep 零残留+smoke.sh 真跑过;台账自身的标识符残留见 [[Finding #35]] 二次清除) |
| 30 | H6 `subagent-stop.sh` hook 建在一个**未验证的平台语义假设**上(以为 SubagentStop 的 additionalContext 通知父 orchestrator);实际它注入刚结束的 sub-agent 自己、达不到父线,且与内建结果摘要冗余 | should-fix(误设计 hook)| ✅ 已删(codex 二审 committed 代码逮出→claude-code-guide 查官方文档裁决→全仓级联移除;魂 dot-graph byte-identical) |
| 31 | 落地页把 live hook 能力 over-claim 成「5h/7d burn-rate」,实现只有 5h(7d 连概念都不存在) | should-fix(对外 over-claim) | ✅ 已修(收窄宣称不补功能:11 处归 5h,7d 明确归 `cc-usage.sh` 带外累计) |
| 32 | PostToolBatch 在 sub-agent 上下文也触发,指挥专属 WIP 警告泄漏给 leaf worker(破红线 4) | should-fix(红线 4 泄漏) | ✅ 已修(官方核实 `agent_id` 语义→sub-agent 闸:非空 `agent_id` 静默 exit 0) |
| 33 | agent-facing 文本与 hook 契约脱节:命令叫 agent 重设 ARM 盖的 `session_id`(P1)+ 魂仍标已删 H6 为 live(P3) | P1=must-fix · P3=should-fix | ✅ 已修(命令改「保留勿覆写」;魂去 H6;MAPSYNC 穷举自检) |
| 34 | armed-gate 把 empty-session_id 的 active 板孤儿化;权威核实反证 codex 半个前提 | should-fix(单边兜底盲区) | ✅ 已修后被 [[Finding #36]] **回退**——对称 degrade 破红线 6;终局=blank 板保持休眠(ADR-007 §4.5) |
| 35 | 记录泄密的台账条目自身把秘密又写了一遍:dogfood ledger 也是发布面 | **must-fix(泄密,release-blocking)** | ✅ 已修(三处匿名化 + 全仓 re-grep 归零,搜索面含台账与测试) |
| 36 | 两个 reviewer finding 反向振荡(孤儿化 ↔ 污染);用非协商红线当裁决锚 + 文档化止振荡 | P1(对称 degrade 破红线 6) | ✅ 已修(回退对称 degrade;裁决写进 ADR-007 §2.3/§4.5;blank 板休眠,显式 re-arm 认领) |
| 37 | cc-usage.sh/usage-pacing.js 本地反推 5h 窗口失真到数量级:反推报 reset 剩 21m,账户权威剩 2h55m(且 5h 59%/7d 86% 才是真值),误导 orchestrator 误报「快撞墙、赶紧收口」| should-fix(逼近 must:钦定主动查询工具最关键信号数量级失真 + 误导 pacing 决策)| ✅ 已落地(statusline-capture 捕获→sidecar→cc-usage/usage-pacing 优先读 account `used_percentage`+纳入 7d+反推 fallback;ADR-008;全绿。剩 README/CHANGELOG/端点验收)|
| 38 | 既存运行时带外脚本(cc-usage/codex-review)在分发 prose 里裸相对路径,终端用户 cwd 触不到 plugin 安装位置(真实安装才现形的形态盲区);新加 statusline-capture 同隐患 | should-fix(分发可用性:终端用户跑不起来)| ✅ 已修(运行时脚本搬 skills/<s>/scripts/ + `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PLUGIN_ROOT}` 引用;dev-only 留顶层;ADR-008)|
| 39 | 接法文档假设 `${CLAUDE_PLUGIN_ROOT}` 在用户 settings.json `statusLine.command` 里展开(未核实);官方核实=该字段变量展开**未文档化**、且 statusLine user-scoped 不绑 plugin→大概率不展开,用户照抄接不上 | should-fix(接法文档准确性)| ✅ 已修(接法改保守绝对路径 + 标注未文档化 + 给实证步骤;cost-and-pacing/statusline 注释同步)|
| 40 | codex 多轮独立复审揪出 4 轮共 7 个单测看不见的退化路径 bug | ✅ 机制验证(正向)| 印证 codex 第二端点验收核心价值;不新增 prose(已是红线 + AGENTS §7 活证据)|
| 41 | 跨 session bug 报告:另一 agent 凭推断误诊「安全闸误建空板」,实为旧缓存代码(实证 > 臆测)| ✅ 机制验证(正向)| 实证推翻臆测;作跨 session 诊断先例入账,精神已在 SKILL A |
| 42 | plugin 部署形态盲区:directory marketplace 缓存快照陈旧 + project-scope 覆盖 user-scope | should-fix(部署/发版纪律)| ✅ 已应对(发版后刷全局缓存 `plugin update`;建议只 user-scope 配一次)|
| 43 | 新命令体写成第三人称 reference 文档而非注入 agent 的 prompt;端点验收漏「命令体当 prompt 品嗓音」一维 | should-fix(agent-facing 指导质量)| ✅ 已修(命令体改 imperative;§12 加约定 + 端点验收增一检)|
| 44 | board DAG 假串行偏多:反过度串行的承重纪律全住 references、魂里无显式护栏(常驻反并行压力 vs 非常驻反串行纪律的非对称)| 中(行为质量) | 回流魂(lens2/Rationalization/Red Flag)+ OBJECTIVE.md 纳并行度;✅ predict-then-validate 抓到眼读误判 |
| 45 | 5h/7d pacing 单边刹车:杠杆全减速、目标只有上限护栏无 setpoint、欠用配额白白蒸发 | 中-高(资源利用效率) | 用户拍板 B②(双侧走廊 70–90%·7d 当总闸);重构 cost-and-pacing + 魂 lens5 双向化 + usage-pacing.js 欠用提示 + ADR-010;诚实只做方向性逼近 |
| 46 | 「标 in_flight 却无真实派发」重复犯——board 标 in_flight 与真实 Agent 调用脱节,且在已写教训进 board log **之后**再犯(#17 复发) | **高**(虚构进度破红线 + 空等浪费 makespan) | ✅ 已回流魂——SKILL.md lens3 dispatch 节点(dispatch=真实工具调用+handle / 派发先于标注)+ 决策程序 (d) recon 对账幽灵 + Red Flags 一行 + Rationalization Table 一行;论证 / 地面真相验证法下沉 `references/dispatch.md` §派发卫生。#49 并入本条 |
| 47 | done-but-unverified 节点标裸 `uncertain` → Stop hook 每拍噪声;改标 `blocked_on:<verify-task-id>` 噪声消除且语义更准 | 低(流程) | ✅ 已回流 `references/board.md` status enum 说明(uncertain 行后加一句:verify 已在飞的 done-but-unverified 宜标 blocked_on:<verify> 而非裸 uncertain) |
| 48 | 独立验收节点 + A/B pressure baseline 范式有效:G1/G1.5 各派独立 verify 清晰证明指导咬住行为 | ✅正向(机制验证) | ✅ 正向登记,判**不新增 prose**(现有「独立端点验收 / gate-green≠passed」红线 + TDD-for-skills 已覆盖,再写造双 SSOT);作 Rationalization Table / 红线正向素材,与 #14/#19/#40 同列 |
| 49 | pacing 加速侧 reasoning 对(镜头 5 lever 用对)却被 #46 拖成「虚假加速」——「标 in_flight」被当成「已派发/已加速」证据 | 中(与 #46 同根) | ✅ 已并入 #46(同根:加速识别本身正确不需回流,需回流的是 #46 的派发纪律,已落地);本条留独特视角「pacing 修复收益依赖派发纪律先成立」 |
| 50 | 跨 skill 引用裸相对路径(`authoring-workflows/…`)+ §12 CI grep 盲区不覆盖该模式;codex 第二验收 flag 为 install-safety 灰区 | 低(P2 灰区) | ✅ **已在 v0.5.1 处置**(候选①②**都做了**):① §12 grep 盲区接进 `scripts/skill-lint.sh` check(4) 自动执行(剔除 `scripts/` 分支避误报 dev-only 引用);② `dispatch.md` 3 处裸跨 skill 引用全升级 `${CLAUDE_PLUGIN_ROOT}/skills/authoring-workflows/…`。不回流任何 skill body |
| 51 | codex 当第二端点验收者价值兑现:对 G1+G1.5 提前跑 codex,抓到 Claude 独立验收 + 多轮 pressure baseline **都没抓到**的 2 条 P2 文档契约问题 | ✅正向(机制验证) | ✅ 正向登记,确认范式有效(与 [[Finding #48]] 同族);**不新增 prose**(已在 AGENTS §7/§8 + resume-verify reference)。其一(strict_dims 超限)已端点折叠修复 |
| 52 | 测试 temp-dir 泄漏致偶发 flaky:两 resume helper 内联 `make_project` temp 目录从不 `rm -rf`,每轮泄漏 ~44 个 → `$TMPDIR` 膨胀致 `mktemp` 偶发失败 → 空 `$H` → board 打错路径偶发红 | 中(隔离脆性·偶发 flaky) | ✅ **已在 v0.5.1 修**(source 修两 helper 补 capture+`rm -rf` + `run-tests.sh` 加套件级 `sweep_ccm_tmp()` 清存量+防累积;连跑后泄漏恒 0、全绿)。隔离设计本身经 80+ 次含并发压测全绿过硬 ✅正向。(b)tests 硬依赖 `python3` **判不修**(红线只禁 `hooks/` 用 python、tests 允许)作已知可接受脆性登记 |
| 53 | watchdog 自我唤醒(ADR-011)全生命周期 dogfood 跑通:CronCreate 一次性 watchdog 给静默失败盲区兜底 + `wakeup.checklist` 写 recon 料 + 3 agent harness 自动重唤起完成后 CronDelete 清理 | ✅正向(机制验证·端到端可落地) | ✅ 正向登记,即 ADR-011 + skill prose 的「边造边用」活证据;判加一句注脚到 `async-hitl.md`(标 ADR-011 设计已 live dogfood 过)或不回流——见 #53 蒸馏判定 |
| 54 | gate-green ≠ passed 活体复现:`board.example.json` 加 `wakeup` 软字段后 node content 段 `fail 0` 但整体 `TESTS FAILED`(撞 example↔template parity / schema 校验) | 低(测试纪律·只读整体结果行) | ✅ 已应对(回退 example 改动);蒸馏=回流 `board.md` fixture-vs-inline 分工(可选 situational 软字段不进 starter fixture,inline 示例才是 demo 处)+ 复用既有 §10「读整体结果行」纪律 |
| 55 | 三层 file-disjoint 并行 + 实现契约(plans/)锁共享常量 → 三层零越界、grep 验接缝逐字一致;TDD-for-skills baseline RED 三边界全 held(强模型天花板,诚实不造红旗) | ✅正向(机制验证·过程亮点) | ✅ 正向登记,印证 multi-layer-planning + impl-contract-as-总谱 + §6 TDD-for-skills 防造范式;判**不新增 prose**(已是 multi-layer-planning reference + #26 防造先例),仅作正向素材 |
| 56 | codex(非-Claude 第二验收者)抓到 watchdog(v0.6.0)2 个真问题——退役 watchdog 只 CronDelete job 漏清 `board.wakeup` 对象(陈旧残骸→hook 误判仍 armed→重开静默失败盲区)+ DESIGN.md ship-anywhere 不变式与 ADR-011 失同步;而我们自己充分验收(读全 diff + 全套测试绿 + 三层一致性 grep)全漏 | ✅正向(机制验证)+ 2 should-fix(P2/P3)已修 | ✅ 已修(P2:async-hitl.md/board.md/ADR-011 明确「退役=CronDelete job **且** 删 wakeup 对象」+ 不变式;P3:DESIGN.md 区分派发机制 vs watchdog timer 例外);坐实 codex-as-second-verifier 价值(与 #19/#21/#22/#27/#40/#51 同族)。**记一个未来 hardening(本次不做,0.6.x 候选)**:verify-board.sh self-heal——把 `fire_at` 已过期的 `wakeup` 视为陈旧(teeth>discipline) |
| 57 | 合并后 main(#18 board viz + #19 watchdog 同随 0.6.0)发版前验证发现**预存** flaky 测试 `test_flow.sh` S24(minute-precision 心跳新鲜度·时间依赖,自 #2 起、#18/#19 零触及),3 跑 2 绿 | 低(测试纪律·预存·与 0.6.0 无关) | 用户决策照发 0.6.0、flake 记 follow-up;蒸馏=后续起独立 PR root-cause 硬化 S24 时间依赖(按 systematic-debugging 查根因勿仅拓宽);正向印证「合并两同版本 PR 后必验**组合 main** 全套门」([[Finding #12]] 延伸 post-merge 集成)+ 一红一绿要复现性定性 |
| 58 | watchdog × 前台指挥建模交互:orchestrator 把前台 self ship 工作标 `status:"in_flight"` → watchdog hook 按规则正确 fire,但 nudge 是 false-positive(V2:self 非可静默失败的已派发后台任务) | 低(建模·正向自检·无产品损害) | self-检正:`in_flight` 应专指已派发后台任务(`board.md` 已定义「已派发、正在后台跑」)→ 误用在我、非 hook 错;即时改 V2 回 `blocked` 消误提醒;蒸馏=判 `board.md` 是否加一句强调 in_flight=dispatched-bg-only,0.6.x 候选澄清 |
| 91 | provider supervisor 把全部 timeout/reap timer `unref()`,本地全量被旁路 handle 假绿、干净 CI 提前结束 pending promise；五轮 fresh review 又依次抓到 long-delay owner、reentrant late-arm、callback 返回后继续副作用、callback 内 terminal 抢先结算、pending terminal 后 provider work 未冻结 | must-fix(CI 阻断·进程生命周期正确性·candidate 已关闭已知反例，待 fresh 终审) | ref timer + slot owner；可重入 postcondition + callback 原子边界 + ordinary/drain 双 gate；isolated / long-delay / callback arbitration/freeze matrix，Node 22.23.1/24.18 双验 |

> 基线健康(无问题留痕,**早期 P2 阶段历史快照**——当时仓库为 3 个纯 bash hook;现行为 5 hook(4 bash + 1 node,ADR-006/ADR-007),当前健康以 `run-tests.sh` 本次输出为准):`claude plugin validate .` ✔;`run-tests.sh` 46 条 bash 断言 + 6 条 node 全绿;
> 三个 hook 纯 bash、无 jq/node;reinject 对诱饵同名键鲁棒;verify-board 的 `"id"` 计数不误算 session_id/log;
> bootstrap dual-sentinel 稳;authoring-workflows 的 5 template + API 契约自洽。**确定性骨架是健康的。**

---

## Finding #1 — skill frontmatter 的 YAML 被「冒号+空格」打挂,skill 以空 metadata 静默加载 ✅已修

- **现象**:`claude plugin validate .` 报错 —— `skills/master-orchestrator-guide/SKILL.md` 的 YAML
  frontmatter 解析失败,「At runtime this skill loads with empty metadata (all frontmatter fields silently dropped)」。
- **根因**:`description:` 是无引号 plain scalar,值内含 `master orchestrator: decompose` 的「冒号 + 空格」,
  被 YAML 当成嵌套 mapping 的 key。对照 `authoring-workflows` 的 description 不含「: 」序列,故校验通过。
- **影响**:skill 的 `name`/`description` 全丢 → 按名自动发现 / `Skill` 工具加载失效。一直被 SessionStart 全文
  reinject 掩盖,运行时「看似正常」。典型的「不跑真 plugin runtime 就发现不了」。
- **处置**:整行 `description` 用单引号包裹(内部英文双引号在单引号标量内为字面量,安全)。validate → ✔。
  改动已在磁盘,**未 commit**(待正式 single-committer 收口)。
- **教训**:① CI/pre-commit 应纳入 `claude plugin validate .`,把「plugin 是否可加载」变确定性门禁;
  ② skill frontmatter 的 `description` 含标点(尤其 `:`、`"`)一律加引号,写进 skill-creator/authoring 规范。
- **严重度 / 来源**:blocker / 一手。

---

## Finding #2 — 「proactively set a phase `/goal`」对 agent 根本不可执行

- **现象**:`commands/as-master-orchestrator.md` 第 17 步、`SKILL.md` 决策程序 step 3 子项 + 红线第 6 条、
  `references/async-hitl.md`「Phased self-driving」、`reinject.sh` 第 44 行注入文案「run `/goal` to inspect / re-set it」
  —— 全链路把「agent 自行敲 `/goal`」当可执行动作。
- **根因**:slash command 只有**用户在输入框敲**才会被 harness 解析;assistant 把 `/goal …` 写进回复正文只是
  普通文本,不会被执行。工具清单里也**没有任何设 goal 的 tool**。设计文档 §2.1 写「hook 不能编程式设 /goal,
  只能由 agent 主动敲(LLM 中介)」——这句隐含了未证实假设「agent 能敲命令」,实际**只有人类能敲**。
- **影响**:整条 `/goal` 分阶段自驱(被设计文档称为「把第 4 镜头从软纪律升级为独立模型硬约束」的核心增益)在
  标准 CC 里**对 agent 是空操作**:agent 要么打印 `/goal "…"` 自以为设了、陷入「有独立裁判兜底」的**假安全感**,
  要么困惑于「我没有这个能力」。好在真正兜底(bootstrap 三层 + verify-board)是确定性的,功能不退化到崩;
  但「主动敲 goal」占了 command/skill 相当篇幅,对 agent 是**纯认知负担 + 假安全感**。
- **处置**(文档为主,不动确定性骨架):把「agent 敲 `/goal`」的措辞从命令式改为**条件式 + 归属人类** ——
  agent 职责降为「在每段起点把符合灵魂公式的 `goal_condition` **写进对话和 board**,供用户按需采用」;
  显式标注「设 `/goal` 是给**人类用户**的可选增强」。配套改 `reinject.sh` 第 44 行「run /goal」祈使
  (hook 注的是给 agent 看的 context,agent 跑不了 `/goal`)→ 改成提醒**用户**或删除该祈使。
- **补充核查(工具层,应用户要求)**:实际 ToolSearch 两轮确认 —— 工具库里**没有任何 set-goal /
  stop-condition tool**,`/goal` 实锤设不了。agent 唯一能用的「自驱」是闹钟式的 `ScheduleWakeup`
  (= `/loop` dynamic 底层)与 `CronCreate/List/Delete`(= `/loop` fixed 底层,7 天过期、session-only);
  语义与 `/goal` 相反:`/goal` 是「拦 Stop、条件未达不让停」(刹车锁),Schedule/Cron 是「主动预约未来重入」
  (闹钟),后者能**近似**「不半途而废」效果。**但 cc-master 已主动弃用它们**(`/loop` dissolution):
  `ScheduleWakeup` 在 Bedrock/Vertex/Foundry 不支持、cron 7 天过期,违反 ship-anywhere → 改用「后台 shell +
  完成通知重入」做全平台 event-driven 自驱。**故 #2 修复方向更清晰**:自驱既不靠 `/goal`(设不了)、也不必靠
  cron(违反 ship-anywhere),而是 decision program 自律 + verify-board 兜底(现状,全平台);仅当某部署愿意
  放弃 ship-anywhere,`ScheduleWakeup` 才是 agent 真正可用的「分阶段自驱」候选。文档应把这层讲透,而非让
  agent 以为能敲 `/goal`。
- **严重度 / 来源**:should-fix(逼近 blocker)/ **双重确认**(orchestrator 一手 + T1体检 Finding A,独立同源命中)。

---

## Finding #3 — sub-agent「假完成」:状态 completed,实则 tool_uses=0 返回垃圾

- **现象**:Phase 1 的 T3(authoring-workflows 调研)sub-agent 状态报 `completed`,但 `tool_uses=0`、6.5s 秒退,
  返回的是一坨 harness 泄漏内容(`_message_callbacks_test` + 一串 skill 列表 + "Always use TodoWrite"),
  完全没读文件、没联网,啥都没干。
- **根因**:疑似 harness/sub-agent 启动偶发异常(非 cc-master 自身缺陷)。无论根因,**sub-agent 的 `completed`
  状态不等于「真的干了活、交付有效」**。
- **影响**:若盲信 `completed` 就把垃圾喂进下游汇总(D1),整个调研被污染。
- **处置**:已按 cc-master 红线「gate-green ≠ passed,agent 自报不可信」在端点验收识破 → 标 `failed` → retry 为 T3b。
  **运营经验固化**:验收 sub-agent 产出时,把「`tool_uses` 是否为 0 / 返回内容是否切题」纳入端点检查;
  这条恰好**正向验证了 cc-master「只信端点验收」红线的真实价值**——它不是 plugin 的 bug,是 plugin 方法论的活教材,值得写进 README/demo 的说服素材。
- **严重度 / 来源**:运营经验(非 plugin bug)/ 一手。

---

## Finding #4 — `verify-board` 跨 session 误伤:他人 session 的空 board 会 block 当前 Stop

- **现象**:实测复现 —— home 里两块 active board,A(有 task)+ B(空),对**任意** session 跑 verify-board 都返回
  `{"decision":"block"}`,理由指向 B。
- **根因**:`verify-board.sh` 第 15–24 行 `for b in "$HOME_DIR"/*.board.json` 遍历**全部** active board,
  `empty_active=1` 一置位就 block,**不按 `owner.session_id` 过滤**。而 plugin 卖点正是「多 orchestration 并发、
  各自独立 board」——并发模型与「全 home 扫描 block」直接打架。
- **影响**:并发跑两个 orchestration 时,只要其一停在「bootstrap 完、DAG 没填」的正常中间态,**另一个无辜 session
  想正常结束都会被硬 block**,且理由指向它不该管的 board,会被引导去填别人的 board。这是确定性骨架里唯一的硬 block,
  误伤代价最高。
- **处置**:让 verify-board 按 session 过滤 —— pinned waist 已有 `owner.session_id`,Stop hook 的 stdin 通常带
  `session_id`,纯 bash grep/sed 取出即可,只对「session_id 匹配当前 session 的 active board」判空。**切忌引入 jq**
  (守 ship-anywhere)。退一步可只 block「最近 mtime 的那块 active board」。design-notes §14 已留 backlog,此处正式拎出。
- **严重度 / 来源**:should-fix / T1体检(实测复现)。

---

## Finding #5 — `goal_condition` 含 `}` / `"` 被 reinject 静默截断

- **现象**:实测 —— `goal_condition` 含 `{done:true}` → reinject 的 phase note 变「goal_condition on record: (unset)」;
  含转义 `\"build\"` → 从引号处截断成半截。**均为静默失败**。
- **根因**:reinject 用 `sed -n 's/.*"phase"...{\([^}]*\)}.*/\1/p'` 锚 phase 对象,依赖「phase 内不含 `}`」这个脆弱前提;
  `[^}]*` 遇 `}` 破锚,`[^"]*` 遇 `"` 提前切断。`board.md` 虽文档化「plain text,no literal `"`/`}`」,但纯靠 agent
  自律、无校验,而灵魂公式的标准写法全是长自然语言句,极易自然写出含引号/花括号的条件。
- **影响**:compaction 后阶段感知静默丢失,agent 认不回「我在冲哪段」——恰在 `/goal`+`phase` 最该起作用(扛 compaction)时失效。
- **处置**(可叠加):① 健壮化提取(已 `tr -d '\n'` 压平,可改锚 `"task_ids"` 之前整段以容忍 `}`;检测到截断迹象时
  降级为「条件存在但无法安全显示,请直接读 board」而非静默吐半截);② `/cc-master:status` health check 增「含 `"`/`}` → 警告」;
  ③ 示例统一用不含引号/花括号的写法,并就近放一句风险提示。
- **严重度 / 来源**:should-fix / T1体检(实测复现)。

---

## Finding #6 — 命令/hook 含「assistant 做不到」的二级祈使;status/stop 多 board 识别缺可执行步骤

- **现象**:① reinject 注「run `/goal` to inspect」(同 #2);② `as-master-orchestrator.md` 第 11 行称 board 路径
  「injected into your context **above**」——但 UserPromptSubmit 的 `additionalContext` 与命令正文展开的相对顺序并非
  命令能保证的「above」;③ `status.md`/`stop.md` 说读「the active one / the one you have been driving」,但 home 多块
  active board 时没给「机械认出哪块是我的」的步骤。
- **根因**:多处把「context 注入相对位置」「agent 自我识别」当确定事实写祈使,而在多 board / 注入顺序不定时并不确定。
- **影响**:单 board 主路径基本无碍;**多并发 board** 场景下 status/stop 可能操作错 board(stop 写 `active:false`,选错
  即归档了别人的 orchestration),reinject 的 `/goal` 祈使空转。
- **处置**:命令正文把「认 board」写成可执行步骤(「列出 home 下所有 `active:true`,按 `goal` 匹配当前任务;多块且无法
  唯一确定 → 先问用户」,stop 这种破坏性操作前应 confirm);第 11 行「above」弱化为「look for the `cc-master:` line with
  the board path」;reinject 的 `/goal` 祈使按 #2 处理。
- **严重度 / 来源**:nice-to-have / T1体检。

---

## Finding #7 — 信息过载 / 自指密度过高

- **现象**:灵魂公式「business end-state ∨ legitimate waiting」+ step-6 ledger + `/goal` 逃生口论述,在 `SKILL.md`
  (决策程序 + 红线 + board 协议)、`async-hitl.md`、`dispatch.md`(末尾引用块)里重复三到四遍。
- **根因**:progressive disclosure 没贯彻 ——本该「主文一句话 + reference 详述」,实际成了「主文详述 + reference 再详述」。
  叠加 #2(`/goal` 对 agent 不可执行),这部分重复是在反复加固一个空机制。
- **影响**:SKILL.md 是 reinject 每次 compaction 全文重注的常驻手册,越长越占 context、越稀释真正每回合要跑的
  「决策程序 7 步」硬核。
- **处置**:决策程序 7 步骨架不动;`/goal` 灵魂公式/ledger 详述**收敛到 `async-hitl.md` 一处**,SKILL.md 主文只留一句
  指针(且按 #2 改成「供用户按需采用的 goal_condition」);`dispatch.md` 末尾 `/goal`=TFU 引用块对其主题无操作价值,可删。
- **严重度 / 来源**:nice-to-have / T1体检。

---

## Finding #8 — 「don't busy-poll」与后台 shell `until…sleep 60` 范式的表面张力

- **现象**:`async-hitl.md` 明令「Do not busy-poll … hand-roll file-size polling is a proven misfire」;`dispatch.md`
  又把「`until <state>; do sleep 60; done` 后台 shell 轮询」作为等外部状态的推荐范式 —— 两处对「轮询」态度看似矛盾。
- **根因**:实则不矛盾(前者禁「主线程占回合 busy-poll sub-agent」,后者是「轮询丢后台、靠完成通知重入」,正交),
  但两段无交叉引用、没点破区别。
- **影响**:中等概率让 agent 在「等外部状态(如 CI)」时犹豫或选错机制。
- **处置**:两处各加一句对照说明(后台轮询是例外且正确;禁的是主线程前台 busy-poll)。
- **严重度 / 来源**:nice-to-have / T1体检。

---

## Finding #9 — `wip_limit` 在 board.md 里 pinned vs flexible 自相矛盾

- **现象**:`board.md` pinned waist 括注把 `wip_limit` 算作「maps 1:1 to pinned」,flexible edges 段又把它列为
  example flexible 字段;`SKILL.md` 的 pinned 列表则根本没列它。
- **根因**:三处表述打架。实际 hook(verify-board/reinject/bootstrap)都不读 `wip_limit`,故它**事实上是 flexible**
  (只是模板给了惯用默认值)。
- **影响**:agent 对「哪些字段是 hook 依赖、动不得」的边界轻微误解;narrow-waist 原则的价值正在于「精确区分 pinned vs
  flexible」,此处恰在该区分上自相矛盾,有损原则可信度。
- **处置**:统一口径为 flexible —— 删 board.md pinned 段括注里的 `wip_limit`,只在 flexible 段保留;SKILL.md 维持现状。
- **严重度 / 来源**:nice-to-have / T1体检。

---

## Finding #10 — sub-agent 最终报告被 content filter 拦,文件却已落盘

- **现象**:G2(开源标配初稿)sub-agent `tool_uses=17` 已写了一批文件,但最终返回 `API Error: Output blocked
  by content filtering policy`,且 `CODE_OF_CONDUCT.md`/`SECURITY.md` 没写完。
- **根因**:让 sub-agent 生成含敏感词的标准模板(Contributor Covenant 全文含 harassment/sexual 等词)触发了
  **输出**内容过滤,连带中断 + 最终报告丢失。
- **影响**:若轻信 sub-agent 的错误返回会误判「整批全废」;实际多数文件好端端落了盘。
- **处置**:① 端点验收**实际产出**(`git status` + 读文件)而非信返回 —— 我据此发现产出 OK;② CoC 改为
  「简短声明 + 链接 Contributor Covenant」而非粘全文(P2c-E),从源头避开过滤;含敏感词的标准件由主线程/链接处理,
  不派 sub-agent 全文生成。
- **严重度 / 来源**:运营经验 / 一手。

## Finding #11 — lens-7「前台对话∥后台执行」在密集 HITL brainstorm 时对 agent 拉力不足

- **现象**:orchestrator(本 session 的我)陷入 goal-hook 设计的前台对话,把**不依赖该对话**的 goal 2/3
  错误地 `blocked_on:G1` 串行挂起,被用户当场点出「另两个目标完全可以后台并行」。
- **根因**:密集 HITL 设计对话会吸住注意力;lens 7/3 的「独立 ready 工作照常 dispatch」在这种场景没有足够强的
  自我提醒,agent 容易默认「先把眼前对话谈完」。
- **影响**:独立目标被串行,效率没拉满 —— 正是 goal 1 要找的「效率没真正最大化」的活样本。
- **处置**:已即时纠正(并行 dispatch G2/G3)。**固化建议**:decision program step 3 / lens 7 补一句
  「即使在前台密集 HITL 时,也要检查有无不依赖该对话的独立 goal 可后台并行」。
- **严重度 / 来源**:should-fix(skill)/ 一手(用户点出)。

## Finding #12 — 并行实现各跑测试子集 → 漏集成测试,端点跑全套才逮到

- **现象**:P2a 只跑 `test_verify-board.sh`、P2b 只跑 `test_reinject.sh`(为避免同工作树互扰),都绿;但集成测试
  `test_flow.sh` 没人更新(仍用旧契约「有 task→allow」),orchestrator 端点跑**全套**时 1 failed。
- **根因**:并行子任务各自只验自己的文件子集;集成测试跨多文件、不属任一子任务,成了**结构性盲区**。
- **影响**:若不在端点跑全套,会带着失败的集成测试「以为完成」。
- **处置**:端点全套逮到 + 收口把 test_flow 改成握手语义。**固化**:并行实现后,端点**必须**跑全套(含集成测试),
  「各子集绿 ≠ 全绿」。这是 cc-master「端点验收」红线的价值再证。
- **严重度 / 来源**:运营经验 / should-fix(已是红线,本条强化「并行后必跑全套」)。

## Finding #13 — orchestrator 红线「不演奏」与端点验收发现的微修之间的张力

- **现象**:端点验收暴露 `test_flow.sh` 一条断言需与新契约对齐;dispatch 一个 sub-agent 改一行断言,往返成本
  远大于收益(T∞≈T₁),orchestrator 直接改了。
- **根因**:红线「never implement/review by hand — dispatch everything」在「端点验收暴露的极小集成 fixup」场景
  过于绝对。
- **影响**:轻微 —— 但严格遵守会为改一行断言派一个 agent(浪费),与 dispatch.md「T₁/T∞≈1 时别 fan out」自相矛盾。
- **处置**:建议 SKILL 红线补注:「端点验收暴露的微小集成 fixup(T∞≈T₁)允许 orchestrator 直接收口,不必 dispatch」。
- **严重度 / 来源**:nice-to-have(skill)/ 一手。

## Finding #14 — goal-hook 自我验证:真拦住 orchestrator 一次「提前 yield」 ✅正向

- **现象**:本 session 用 `--plugin-dir` 加载 live repo(含刚实现的 goal-hook)。orchestrator(我)在 4 路后台
  `in_flight` 时想 yield,被 goal-hook 的**自检握手 block**,逼自检 → 发现一件被我推给 P3 的 fill-work
  (findings 落盘)其实**现在就能做** → 于是不 yield、去做它。
- **根因(机制成功)**:goal-hook 把 lens 4「穷尽 fill-work 再歇」从软纪律变成**硬拦截**,逮住了 orchestrator 自己的
  一次过早 yield。
- **影响**:**这是 goal-hook 设计价值在真实 dogfood 中兑现的活证据** —— 确定性 Stop 闸确实防住了「提前歇」,
  连作者自己都拦。也观察到:两段式握手对「真在等」的情况会多拦一次(可接受 —— 自检本就该每次停时做一遍)。
- **处置**:无需修;作为 README/demo 的「眼见为实」说服素材。
- **严重度 / 来源**:✅ 机制验证(正向)/ 一手(刚发生)。

## Finding #15 — bootstrap sentinel 裸子串匹配,被「提及命令名」的输入误触发建空 board

- **现象**:P2c-B 的 task-notification(其 result 里 walkthrough 提到字符串 `/cc-master:as-master-orchestrator`)
  进来时,UserPromptSubmit hook `bootstrap-board.sh` **误建了一个空 board**(`20260608T105655Z-4335`)并注入
  「you are now the master orchestrator」。
- **根因**:`bootstrap-board.sh` 第 10–13 行 `case "$stdin" in *cc-master:as-master-orchestrator*|*"cc-master:bootstrap:v1"*)`
  是**裸子串匹配** —— 任何含这两个字符串的 stdin(task-notification、sub-agent result、用户讨论该命令)都触发。
  dual-sentinel 本意是 robust 触发(UserPromptSubmit 看到 raw command 或 expanded body 都能 fire),却宽松到被
  「提及」误触发。
- **影响**:home 被空 board 污染;每次含命令字符串的输入都建一个;注入误导性「you are now orchestrator」。
  **幸而 goal-hook 的 session 过滤(#4 修复)让空 board 不误伤当前 session 的 Stop** —— 否则误建空 board 会
  立刻 block 当前 session。两个 finding 在此交汇:#4 的修复正好兜住了 #15 的副作用。
- **处置**:① 已 `rm` 本次误建空 board;② 收紧 sentinel(**需先实测** UserPromptSubmit 看到 raw command 还是
  expanded body):若总是 expanded → 只 gate marker `cc-master:bootstrap:v1`(提及通常不含该注释 marker);若可能
  raw → 额外要求命令名出现在 prompt 字段**开头**(纯 bash 提取 prompt 值查前缀)。须保持 content test 的
  sentinel-consistency 断言仍绿。
- **严重度 / 来源**:should-fix / 一手(实时撞上)。

## Finding #16 — bootstrap marker 分支仍裸子串(#15 同类残留),被 sub-agent 报告内联引用 marker 误触发

- **现象**:R5(迭代范式勘察)报告正文逐字引用 sentinel 标记 `cc-master:bootstrap:v1`(在讲 command 文件约定时),
  该报告经 task-notification 走 UserPromptSubmit 时,`bootstrap-board.sh` 的「stdin 含 marker 子串」判据命中,
  **误建空 board**(`20260608T121833Z-2069`)。
- **根因**:#15 的 P2c-F 只收紧了 `/cc-master:as-master-orchestrator` **前缀分支**;marker 那条 OR 分支
  (`*"cc-master:bootstrap:v1"*`)仍是**裸子串匹配** —— 任何提及该 marker 的文本(sub-agent 报告 / 文档 / 对话)
  都触发。修了一半,另一半同病未除。
- **影响**:home 被空 board 污染。**幸:goal-hook 的 session 过滤(#4 修复)再次兜住** —— 误建 board 的
  `owner.session_id` 为空 ≠ 本 session,故 goal-hook 不 gate 它、不误伤(与 #15 同样的交汇救援)。
- **处置**:① `rm` 误建空壳;② **P4b** 把 marker 判据从「stdin 含子串」改为「**marker 须是 prompt 提取值的首个
  非空行**」(prose 内联提及不触发;`as-master-orchestrator.md` 的 command body frontmatter 之后首非空行正是该 marker,
  合法触发不破),与 P2c-F 前缀纪律同源。`test_bootstrap-board.sh` 加 E1(首行 marker→建)/E2(内联提及→不建)回归,
  并修正 Case B/G 旧 fixture(marker 移首行贴合真实 body),`passed=19 failed=0`。
- **严重度 / 来源**:should-fix / 一手(实时撞上)。✅ 已修(P4b)

## Finding #17 — phantom in_flight:标 board 在前、dispatch 在后,被 sibling 完成通知打断致漏派 worker

- **现象**:Wave1 批 b 的 P2c/P1/P1b 在 board 被标 `in_flight`,但**实际从未 dispatch sub-agent** —— 零产物、
  零 transcript。仅 P3b(在同一拍内既改 board 又发 Agent 调用、且未被打断)真跑。空挂数轮,进度停滞,直到用户
  「继续推进」催问,orchestrator 核 `git status` / transcript 才发现。
- **根因**:orchestrator 把「标 board `in_flight`」与「实际发 Agent 调用」拆成**两步**;每次刚标完 board,一个
  sibling 的完成通知就插进来打断本拍 → 转去验收那个刚完成的节点时,**漏掉了实际的 dispatch tool-call**。
  step-6 ledger 据 board 断言「in_flight」,却**未核实背后真有活 worker**(board 是模型,现实才是真相)。
- **影响**:三节点空挂,效率严重受损 —— 正是 goal 1 要找的「效率没真正最大化」的活样本(且这次是 orchestrator
  自身执行 bug,非 plugin bug)。
- **处置**:① 真 dispatch 三节点,**agentId 写入 board 当 worker 实证**;② 固化纪律:**先 dispatch 拿 agentId、
  再标 board**(标 `in_flight` 必须有 worker 实证);reconcile 时**核实 `in_flight` 是否真有活 worker**(无 agentId /
  无 transcript / 零进度 = phantom)。建议写进 AGENTS.md 反模式 + orchestrating Red Flags(「标了 in_flight 却没发
  Agent 调用」「step-6 只凭 board 断言 in_flight 未核 worker」)。
- **严重度 / 来源**:should-fix(skill,流程纪律)/ 一手(用户催问逮到)。✅ 已应对(待 V 后固化进 AGENTS/SKILL)

## Finding #18 — eval Track A 触发召回近零:冷启 `claude -p` 单轮欠表征真实触发(非 description 缺陷)

- **现象**:V 阶段首次真跑 `scripts/eval-trigger.sh master-orchestrator-guide`(20 query × 3 run,uv 3.12 + claude CLI):
  **10 条 should-not-trigger 全 PASS**(零误触发,precision 满分);**10 条 should-trigger 全 FAIL**——9 条 `rate 0/3`、
  1 条 `1/3`,召回 ≈ 1/30 ≈ 0.03。连「我手头有 6 个后台 agent 在跑…要协调到全部完成」「跨好几天、compaction 后续跑」
  这类教科书级编排 query 都几乎不触发。
- **根因(推断)**:那条 `1/3` 证明 skill 在 harness 里**能**触发(并非完全没加载暴露),故非"未暴露 bug";更可能是
  **冷启 `claude -p` 单轮对行为型 skill 本就极少主动调用**。run_eval 的判定 = "裸单轮 `claude -p <query>` 是否选择
  调用该 skill(经临时 command wrapper)";这个条件比 cc-master 真实使用(plugin 上下文 + SessionStart 每 compaction
  重注 + `using-superpowers` 的"1% 可能就调 skill"主动纪律 + 多轮对话)**苛刻得多、欠表征**。R3 调研早标注过该天花板
  (平凡 query 不触发与 description 无关);此处实测把它放大到了行为型 skill 的"绝对召回"上。
- **影响**:**直接关乎 goal #3「建立 eval 机制可靠指导迭代」的"可靠"**——Track A 的**绝对召回数字对行为型 plugin skill
  不能直接当"description 好不好"的判据**(会把好 description 误判为差)。但:① 负例 / precision 仍可靠(无误触发);
  ② seed=42 同 harness 下**改前后相对 delta 仍有意义**(描述改动是否抬高/压低召回可比)。即 Track A 宜定位为
  **precision 门 + 相对迭代信号**,而非绝对召回评判。
- **处置**:① eval 基础设施已交付且**跑通**(证 infra OK,这是 goal #3 的交付物);② 记此可靠性 caveat;
  ③ 后续候选(非本轮、非阻塞):提高 harness 保真度(在更接近真实的多轮 / 加载 plugin 的上下文里测),或在
  `design_docs/eval/README.md` 明确 Track A 的"相对 delta + precision"定位与绝对召回 caveat。
- **严重度 / 来源**:should-fix(eval 可靠性)/ 一手(V 阶段首次真跑实测,eval 自曝可靠性边界——eval 在做它该做的事)。

## Finding #19 — codex 自审(新 reviewer 首跑)逮到 #16 修复的首行内联残漏 ✅正向

- **现象**:V 阶段用本轮新建的 codex-as-reviewer(`codex exec review --uncommitted`)自审本轮全部改动,codex 出
  **needs-attention**:P4b 的 bootstrap marker 修复用 glob `*'<!-- cc-master:bootstrap:v1 -->'*`,只要 marker 落在
  首个非空行的**任意位置**(含首行内联在 prose 里)就 `marker_hit=1` 建 board;契约要求 marker **独立成行**。E2 回归
  只覆盖了"marker 在第 2 行 prose",漏了"marker 内联在第 1 行"——后者仍误触发。
- **根因(机制成功)**:codex 作为**独立第二端点验收者**,审出了我的回归测试 + 我自己的 diff-read **都漏掉**的真残漏——
  注释写的意图("MUST be the first non-empty line, not a bare substring")与实现(glob 允许首行内联)之间的缝。
- **影响**:**codex-reviewer 交付物价值在真实 dogfood 中兑现的活证据**——新 reviewer 在自己诞生的同一轮里,审出了
  另一处 hook 修复(#16)的诞生缺陷(与 Finding #14 goal-hook 自验同类正向)。是 README/demo 的"眼见为实"说服素材:
  端点验收红线("agent 自报不可信、只信独立端点验收")不是口号——连 orchestrator 自己的修复都被独立 reviewer 拦下补全。
- **处置**:按红线例外(端点验收**本身**暴露的微修,T∞≈T₁,Finding #13 立的 carve-out)orchestrator 直接 TDD 收口:
  加 `tests/hooks/test_bootstrap-board.sh` Case E3(marker 内联首行→不建,先 Red 确认 FAIL=20/1)→ 改 glob 为 trim 后
  对 `'<!-- cc-master:bootstrap:v1 -->'` **standalone 精确匹配**(Green,passed=21/0)→ 合法触发(marker 独立成行)
  回归仍建 board。#16 修复至此完整。
- **严重度 / 来源**:✅ 机制验证(正向)+ should-fix 残漏已修 / 一手(codex 首跑实测)。

## Finding #20 — codex-review.sh 非功能:`codex exec review` 禁止自定义 PROMPT 与 scope flag 同用

- **现象**:V/PR 终审门**真跑** deliverable 脚本 `scripts/codex-review.sh --base main`,codex 退出码 2:
  `error: the argument '[PROMPT]' cannot be used with '--base <BRANCH>'`。脚本同传**自定义 PROMPT + `--base`** →
  每次必报错 → silent-pass-through guard(正确地)判 `CODEX_REVIEW_FAILED` / exit 2,但**它从未真正 review 过任何东西**。
- **根因**:`codex exec review` 的 `[PROMPT]` 与 scope flag(`--base` / `--uncommitted` / `--commit`)**互斥**(逐字 `--help`
  证实)。P2 实现时按约束"不发起会消耗 API 的真 codex 调用",只做了 `bash -n` 语法检查 → **运行期 CLI 契约不兼容遂漏检**。
  (本轮早先那次成功的 `--uncommitted` 自审,恰因我手动**没带**自定义 prompt 才绕过了这个互斥——所以 reviewer 机制本身能用,
  是**脚本封装**写错了参数组合。)
- **影响**:codex-reviewer 这个**核心 deliverable 如 P2 交付即不可用**——每次假性 NOT passed,等于没有 reviewer。
  **幸 silent-pass-through guard 让它 fail-safe**(绝不误判成 approve),坏也只坏向安全侧。
- **处置**:orchestrator 直接修(端点验收本身暴露、T∞≈T₁):**去掉自定义 PROMPT**,改用 codex 默认 review + 仓库 `AGENTS.md`
  供 review 约定(codex 会读 AGENTS.md);`--base` diff 本就只含本仓 tracked 改动,故"忽略别的 AI 的 ~/.claude skill defs"
  这个 filesystem boundary 自然 moot(那些文件不在 diff 里)。重跑确认产出真 verdict。
- **教训(固化候选)**:**带外脚本(codex / eval)不能只 `bash -n` —— V 端点必须真跑一次冒烟**。"语法过 / determinism 三禁过"
  ≠ "运行期 CLI 契约对"。P2/P3 为省 token 约束"不真跑",是对的;但 orchestrator 在 V 端点验收时**有责任真跑一次**,
  本轮正是 V 真跑才逮到 #20(和 #19)。建议写进 AGENTS.md §10 测试纪律 / §7 codex 段。
- **严重度 / 来源**:should-fix(deliverable 可用性)/ 一手(V/PR 终审门真跑实测)。

## Finding #21 — codex 功能性 review(脚本修好后首跑)再逮两条:fingerprint 身份不足 + reviewer 未强制只读 ✅正向

- **现象**:`codex-review.sh` 修好(#20)后真跑 `--base main`,codex 出 **needs-attention 两条**:
  - **(A) `verify-board.sh` fingerprint 身份不足**:只哈希排序后的 status 多重集 → 当完成态 board 的 status **计数不变但归属变了**
    (两个 task 互换 in_flight↔blocked、或某 blocked 任务的 `blocked_on` 变)时,指纹**不变** → 误判"已自检"→ **跳过新状态的必要自检**(P4 缺口)。
  - **(B) `codex-review.sh` 未强制 read-only**:未显式覆盖 sandbox,用户 `~/.codex/config.toml` 为 `workspace-write`/`danger-full-access`
    时(codex 实查到正是 `danger-full-access`)review 继承**可写沙箱**、可改仓库,违反"只读 reviewer"契约(P2 缺口 + 实在风险)。
- **根因(机制成功)**:codex 作为独立第二验收者,审出 P4(指纹身份)与 P2(沙箱契约)各自的真缺口——前者测试只覆盖了
  "multiset 不变=不重问"、漏了"multiset 不变但身份变=该重问";后者 doc/注释声称 read-only 但实现没强制。
- **影响**:**codex-reviewer 价值再证**——这一程它逮了 **#19 / #20 / #21 共四条真 bug**(全是测试 + 我自读漏掉的)。
  (B) 在当前 danger-full-access 配置下是实在的"reviewer 可写仓库"风险。这是端点验收红线"只信独立端点验收"的最强活证据。
- **处置**:orchestrator TDD 收口(端点暴露、T∞≈T₁):
  - (A) `status_fingerprint()` 改 **id+status+blocked_on 三元组、file order 不排序**(绑定 id↔status);加 `test_verify-board.sh`
    Case Q(status 互换→重握,passed=37);`fp_of` helper 同步镜像。Finding #18 的"同状态不重问"不回归(同状态→同指纹)。
  - (B) `codex-review.sh` 加 `-c sandbox_mode='"read-only"'` **强制只读**,不继承用户配置。
- **严重度 / 来源**:✅ 机制验证(正向)+ 2 should-fix 已修 / 一手(codex 第三次真跑,脚本修好后首次功能性输出)。

## Finding #22 — codex 第 4 次(收敛确认)再逮两条:fingerprint 越界读 task waist + Track B 文档指向不工作的 codex 调用 ✅正向

- **现象**:codex 第 4 次真跑(审已修 #21 的状态)again **needs-attention 两条**:
  - **(C) `verify-board.sh` fingerprint 越界**:#21 把 fingerprint 从 status-only 扩成 id+status+blocked_on 时**扫全 board**,
    会把 `log` 等 flexible 字段里的 `"id"/"status"/"blocked_on"` 也算进 → 违反 **narrow-waist 红线**(hook 只该读 task waist);
    追加 log 可能伪装成"状态变"→ 徒增 self-check + stop-block streak。
  - **(D) `track-b-benchmark.md` codex 配对指向不工作的调用**:让用户跑 `codex-review.sh`(审 repo **diff** 非 transcript)
    或 `codex exec review "<prompt>" --base main`(正是 #20 的 PROMPT+scope 互斥)→ Track B 拿不到宣称的独立 **transcript** 裁决。
- **根因**:(C) 我修 #21 时"修一处带出一处"(扩 grep 范围顺带纳入 flexible 字段);(D) 文档沿用了 codex-review.sh 的 diff-review
  形态,但 Track B 要 grade 的是 **transcript**,工具用错(应 plain `codex exec` + transcript 走 stdin)。
- **影响**:都 should-fix。(C) 违反 narrow-waist 红线(虽 valid-JSON 转义下当前多为 latent);(D) 让 eval Track B 的 codex 配对实操不通。
- **处置**:(C) `status_fingerprint()` scope 到含 `"deps"` 的 **task 行**(flexible 字段无 deps);加 `test_verify-board.sh` Case R
  (log 用 id/status 当 key 不改 fp,passed=38)+ `fp_of` helper 同步。(D) 文档改用 plain `codex exec`(transcript 走 stdin、
  grading 指令作 prompt、`-c sandbox_mode='"read-only"'`),不用 `codex exec review`。
- **收口决定(fuse)**:codex 一程(4 次真跑)共逮 **6 条真 bug**(#19 / #20 / #21A / #21B / #22C / #22D),**全部收口**;
  按预设 fuse **停掉自动 codex 循环**(不再自动再跑,避免无限逼近;如需再验可手动 `bash scripts/codex-review.sh --base main`)。
- **严重度 / 来源**:✅ 机制验证(正向)+ 2 should-fix 已修 / 一手(codex 第 4 次)。

## Finding #23 — meta-skill 误置为「分发制品」+ 命名过泛(用户 review catch)

- **现象**:`authoring-skills`(TDD-for-skills 元规范)被放进**分发的** `skills/`,且命名过于通用。但它其实是
  「怎么按本仓纪律造/改 cc-master 的 skill」的**项目自用开发工具**——对插件**终端用户毫无意义**,不该随插件分发。
- **根因**:P1b 实现 + orchestrator 端点验收时混淆了两个边界:**`skills/` = 随插件 ship 给用户的「软件源码 / 产品」**;
  而 dev tooling(怎么造这个项目)该进 **`.claude/skills/`(项目自用,本仓贡献者用,git 跟踪但不分发)**。命名 `authoring-skills`
  听着像「通用 skill 写作指南」,无项目区分度,且进 `.claude/skills/` 后会和用户全局一堆 skill 并列显示、更易混。
- **影响**:① 分发集污染——终端用户会拿到一个讲"怎么改 cc-master 自身 skill"、对他们无用的 skill;② 泛名混淆。
  均属 product hygiene(产品边界 / 命名),由用户 review 逮到。
- **处置**:`git mv skills/authoring-skills .claude/skills/cc-master-skillsmith`(历史保留);frontmatter `name` + 标题 +
  全部引用(AGENTS §2 目录树/§6 三-skill 框架/§N 触发表、`design_docs/eval/README.md`、`track-b-benchmark.md`、设计 spec §1.5)
  同步更新;**顺带把 content 测试(`tests/content/structure.test.mjs`)扩到也 iterate `.claude/skills/*/SKILL.md`**——
  这个讲"结构靠 content 契约把关"的 meta-skill 原本因移出 `skills/` 而脱离了它自己鼓吹的那道门,现在重新纳入。
- **教训(固化候选)**:**分清「分发制品(`skills/`,随插件 ship)」与「项目自用工具(`.claude/skills/`,本仓 dev)」**——
  meta / 内部工具进 `.claude/`,命名 project-specific。已在 AGENTS §1「这个插件是什么/不是什么」+ §2 目录树 + §6 体现。
- **严重度 / 来源**:should-fix(product hygiene)/ 一手(用户 review catch,PR #4 开后)。

## Finding #24 — codex 复审两轮连逮 region 提取的两个反向漏洞:截断 fail-open + 嵌套伪装 fail-closed ✅正向

- **现象**:2026-06-10 修「goal-hook 行格式假设」时,第一版 region 提取(`"tasks"` 键切到首个 `"log"` token)被
  codex 一审逮住:task 自带 flexible `log` 字段会**截断** region,后续 `ready` task 漏检 → Stop 误放行(fail-open)。
  改为括号配对提取整个 tasks 数组后,codex 二审又逮住反向问题:task 内**结构化** log 条目
  (`tasks[0].log:[{"id":"L1","status":"ready"}]`)落在数组 region 内,被 actionable grep 误判 → 误 block 到熔丝跳闸(fail-closed)。
- **根因**:用「文本切片」近似「JSON 语义」时,每个近似都有两类死角——切早了(嵌套同名 key 截断)和切宽了
  (嵌套字段伪装顶层字段)。board 协议允许 task 携带 agent-shaped flexible 字段,这两类死角都真实可达。
- **影响**:① fail-open 破坏 goal-hook 的核心闸门(该 block 不 block);② fail-closed 反复误 block 消耗熔丝、
  打断长等待。两者都过了当时的全套测试——测试只覆盖了「乖」board 形态。
- **处置**:`tasks_region()` 终版 = 双深度([ ] + { })、string/escape-aware 的 awk 字符扫描,**只输出 task 对象
  顶层字段流**,嵌套字段整体丢弃;Case V/W 红先行固化两类死角;test 镜像 `fp_of` 同步。三轮 codex 后放行。
- **教训(固化候选)**:**纯 shell 解析 JSON 时,"切片近似"必须对协议允许的全部形态(含 flexible 字段)做对抗推演**——
  问一句「嵌套里出现同名 key / 同形 pair 会怎样」;且 fail-open 与 fail-closed 要分开各验一例。codex 第二端点
  复审对这类"测试全绿但形态覆盖不足"的盲区命中率极高(本案两轮两中),值得在 hook 改动上常设。
- **严重度 / 来源**:must-fix(fail-open)+ should-fix(fail-closed)/ 一手(codex 复审 rounds 1-2,2026-06-10)。

## Finding #25 — Track A 在满载环境下信号死亡:正例 recall 地板 = 0,与 description 质量无关

- **现象**:2026-06-10 按 §8 跑 `authoring-workflows` 的 description 改动前 baseline(28 query × 3 runs,
  扩容后的 eval 集),**14 个正例全部 trigger_rate=0.0**(42 次运行零触发),14 个负例全部"通过"。
  连 "I'm about to author a dynamic-workflow script…should this be pipeline() or parallel()" 这种
  点名条目都不触发。
- **根因**(systematic-debugging,三个假设逐一验证):① `run_eval` 的 `find_project_root()` 从
  skill-creator 缓存目录向上爬,命中 **$HOME**——临时 stub 写进 `~/.claude/commands/`,`claude -p` 在
  用户全局满载环境(global CLAUDE.md + 全部插件 + ~100 个技能)里跑;② **决定性的一条**:最小复现
  (含 `--bare` 全隔离)显示当前默认模型对咨询型 query **直接凭知识作答、零工具调用**——一个 body 只有
  description 的 stub command 根本不在它的调用考虑内;③ 侦测器只看第一发 tool_use,非 Skill/Read 即判负。
  ②是地板本身,①③是雪上加霜。
- **影响**:Track A 的 before/after 对比在该环境读出 0 vs 0,**不携带任何信息**;若不察觉,会把
  "改了没掉点"误读成"改动安全",或把 0 recall 误读成"description 写得烂"而瞎调。负例 14/14 全过
  同样是死通道的副产物,不是 precision 好。
- **处置**:① description 等价美化照做(语义不变,YAML/结构门把关);② `design_docs/eval/README.md`
  增设 "Measured floor warning" 小节(数字 + 日期 + 根因 + "不要对着死通道调 description" 纪律);
  ③ 语义性 description 改动在测量通道修复前,降级为定性评审(diff review)把关。
- **教训(固化候选)**:**跑 eval 先验通道,再信数字**——一个全 0(或全满)的指标先怀疑测量,后怀疑
  被测物;"负例全过"在 recall=0 时是症状不是成绩。上游修复方向(供 skill-creator 反馈):隔离
  project root、侦测器看全程而非首发、用真 SKILL.md 而非 stub。
- **严重度 / 来源**:must-know(测量有效性)/ 一手(本轮 deferred-trio 落地,最小复现 ×3)。

## Finding #26 — 模型分层 + usage-pacing 的 pressure baseline 零失败 → 正确归类为 reference 知识(非红线)✅正向

- **现象**:2026-06-10 给 SKILL A 补「模型分层 + usage-aware pacing」两块编排能力,按 §6 TDD-for-skills「先跑 subagent
  pressure baseline 看失败、再写堵漏 prose」。三压场景(time + sunk cost + exhaustion)+ 强制 A/B/C 单选:模型分层派
  **6 个** subagent(无该纪律)、usage-pacing 派 **2 个**——**8/8 全选合规项 A,零失败**。逐字推理都从既有 lens 自行推出:
  模型分层引 lens 2「concentrate resources on the critical chain」+ Rationalization meta-rule;pacing 引 lens 4「主观能动
  不空等」+ lens 5「量力而行不顶满」+ step-6 ledger 纪律。甚至有 agent 主动点出「中途切主线模型会破坏 `owner.session_id`
  连续性」——这条我原以为要专门教,它自己从 board 协议推到了。
- **根因(机制成功)**:既有七镜头 + Rationalization Table 覆盖面已足够强,agent 在「给了信息 / 给了选项」时能从既有纪律推出
  正确编排行为。两块的真实缺口**不是「会被合理化掉的判断型规则」,而是 agent 默认缺的事实知识**:① 四档模型
  (Fable/Opus/Sonnet/Haiku)各自定位 + 相对 output 成本(10×/5×/3×/1×);② 中途切主线模型废 prompt cache 的技术代价;
  ③ 5h/7d 配额窗口存在 + 有 `scripts/cc-usage.sh` 可程序化感知。这些是 **reference / how-to 知识**,§6 明确**不 gate**
  pressure baseline(baseline 只 gate「judgment-bearing 能被合理化掉的规则」)。
- **影响(纪律正向)**:**TDD-for-skills 的 Iron Law 在此第二次发挥作用——防止我编造一条 agent 根本不会违反的红线**。原 plan
  (Task 4/6)预设 baseline 会失败、要写新红线 + Rationalization 行 + Red Flags 行;实测零失败,若仍照写就是「为不存在的违规
  造规则」,反而稀释 reinject 每次全文重注的 SKILL A、压低真红线的信噪比。**正确处置 = 降级为 reference 知识**,不进
  红线 / Table / Flags。
- **处置**:① 新建 `references/cost-and-pacing.md` 承载全部 reference 知识(四档表 + per-node 选模型 + 主线固定模型保 cache
  + usage 感知三路径 + burn-rate 撞墙预测 + 四杠杆 pacing),顶部显式标注「informational, not a red line;baselines 证明
  agent 自发会推」;② SKILL A 主文件只加 lens 2 / lens 5 各一句软指针 + reference index 一行(reinject 友好,主文件几乎
  不膨胀);③ 扩 `decomposition.md` 资源种子加 model 维度;④ 信号脚本 `scripts/cc-usage.sh`(带外、非 hook)作
  ship-anywhere 落地物。**不加任何红线 / Rationalization 行 / Red Flags 行。**
- **dogfood 确认(live)**:派 subagent 模拟 orchestrator(只给 SKILL.md + references 访问、**不**直接喂
  `cost-and-pacing.md`),问「配额紧张 + 7 个 leaf 怎么调度 / 各配什么模型 / 要不要切主线」——它顺着 lens 2/5
  软指针**自己去读了 `cost-and-pacing.md`**,4 问全答对(`cc-usage.sh` 感知 + burn-rate 撞墙公式;5 机械→Haiku、
  2 难活→Opus;90% 窗口时四杠杆 pacing + `blocked_on:quota-reset` defer + 不全停;不切主线保 cache 三理由),并
  逐条给出文件引用追溯。**软指针 → reference 可达性 + 内容有效性闭环成立。**
- **教训(固化候选)**:**baseline 零失败本身就是有效产出——它把「我以为该是红线」证伪成「其实是信息缺口」**。判断型纪律
  (红线 / Table)与告知型知识(reference)的分界,正应由 pressure baseline 来划:失败 → 判断缺口 → 红线;不失败 →
  信息缺口 → reference。不是每个「看起来该管」的主题都需要一条红线;TDD-for-skills 同时防漏(该堵的没堵)与防造(不该造的造了)。
  另一条:**reference 知识的验收 = dogfood 可达性**(软指针真把 agent 引到 reference、且内容够它据此决策),而非判断型
  纪律的 A/B pressure baseline——两类知识,两种验法:判断缺口用「无该 prose 时选错 → 加 prose 后选对」的 A/B,信息
  缺口用「顺着指针读到 reference 并据此答对」的 dogfood。
- **严重度 / 来源**:✅ 机制验证(正向)/ 一手(本轮 model-tiering-usage-pacing 落地,baseline 8 subagent 实测)。

## Finding #27 — codex 第二端点验收(本 PR,4 轮)逮到 6 个真 bug:cc-usage.sh 五 correctness + cost-and-pacing.md effort 不可执行 ✅正向

- **现象**:model-tiering-usage-pacing 这轮端点验收,跑 `scripts/codex-review.sh --base main` 让 codex 审 6645c1c +
  f7a60d8 全部 diff,出 **needs-attention 两条**(都 P2,都在 `scripts/cc-usage.sh`):
  - **(A) ccusage 加速器透传破坏 schema 契约**(:42-43):装了 `ccusage` 的机器上,该分支直接 `printf` 原始
    `ccusage blocks --json` 后 exit——但脚本头注释 + `cost-and-pacing.md` 都承诺归一化的 `five_hour`/`seven_day`
    schema。任何按文档 schema 解析的调用方,**只在装了 ccusage 的机器上**会坏(环境相关、隐蔽)。
  - **(B) 陈旧 5h block 误报**(:97-105):最新 JSONL 消息 >5h 前时,`blocks[-1]` 仍被当当前窗口,产出陈旧
    `used_tokens`、甚至**负的** `window_remaining_min`(实测 now=20:00Z、窗口 15:00Z 已关 → used=3400 残留、
    remaining=-300)。隔夜空闲后的 pacing 决策会误以为旧窗口还活着。
- **根因(机制成功)**:codex 作为独立第二端点验收者,审出我**测试 + 自读 diff 都漏掉**的两个形态盲区——测试只覆盖了
  「窗口活跃 + 无 ccusage」这一种乖形态(与 Finding #24「测试只覆盖乖 board 形态」、#12「各子集绿≠全绿」同根)。
  (A) 是「带外脚本对未安装的外部工具 schema 下注」;(B) 是「滑动窗口边界没处理过期」。
- **影响**:**codex-reviewer 价值第 5 次真实兑现**(继 #19/#20/#21/#22/#24 之后)。两条都过了当时全套测试
  (passed=45+3+6)+ plugin validate + smoke——纯结构/correctness 测试看不见,只有独立语义审查能逮。(B) 的负
  remaining 会直接误导 pacing(本 PR 的核心用途),危害不小。
- **处置**(端点暴露、T∞≈T₁,按 Finding #13/#19 carve-out orchestrator 直接 TDD 收口):
  - (A) **彻底移除 ccusage 透传分支** + `--no-ccusage` flag——纯 python 解析自洽、受控、零依赖、可测;ccusage「更准」的
    边际收益不抵 schema 不一致 + 本环境不可验(没装 ccusage,违反 Finding #20「带外脚本 V 端点必须真跑」)的代价。注释
    留增强指针(「未来加速器须先把 ccusage 归一化到本 schema」);`cost-and-pacing.md` §Sensing 第 2 路径改为
    「orchestrator 可独立跑 ccusage」,不再宣称 cc-usage.sh 内部用它。
  - (B) **active block 须 CONTAIN now**:`now <= start + 5h` 才算活跃窗口,否则报 clean zero(窗口已翻新),绝不残留
    used 或负 remaining。
  - test 加 stale-window case(now=20:00Z → used=0/rem=0;先 Red 确认 used=3400/rem=-300、passed=4 failed=2 →
    Green passed=6)。
- **教训(固化候选)**:呼应 Finding #24——**纯 shell/脚本近似真实语义时,必须对协议/环境允许的全部形态做对抗推演**:
  滑动窗口问「过期了会怎样」(负数/残留),带外加速器问「外部工具 schema 和我承诺的一致吗 / 我能在本环境验证它吗」。
  codex 第二端点验收对这类「测试全绿但形态覆盖不足」命中率极高(本案再中两条),hook/带外脚本改动上值得常设。
- **round-2(codex 复审追加,机制再成功)**:修 (B) 时把「整个 block 隔夜过期」修对了,却**引入反向回归**——分组仍只按
  「与上条 gap>5h」切块,**连续使用跨 5h 边界**(无 gap)时所有消息留在旧块,活跃新窗口被错报为 0(例 10:00/14:59/15:01,
  在 15:02 报 `used=0`,明明 15:01 刚开新窗口)。codex 第 2 轮精准逮到(`cur[0][0]+five` 才是 split 依据)。**Finding #24
  「修一处带出一处」+「fail 两方向都各验一例」再现**——我只验了「陈旧残留」(fail-stale),漏了「活跃清零」(fail-empty)。
  处置:分组条件改 `gap>5h OR ts-cur[0][0]>=5h`(满 5h 即开新块);test 隔离 fixture 到 `sample/`+`rolling/` 子目录
  (避 `**/*.jsonl` glob 污染)加连续跨边界 case(15:02 → used=300 新块,passed=8)。
- **round-3(codex 复审追加,机制再成功)**:codex 第 3 轮在 `cost-and-pacing.md` 逮到第 4 条(**非回归**,reference 首版
  就有的**可执行性**缺陷):我把 `effort`(`output_config:{effort}`)当 leaf 的 pacing lever 写进 reference,但 **cc-master
  的派发 API 根本不透传它**——workflow `agent()` opts 只有 label/phase/schema/model/isolation/agentType,Agent sub-agent
  也无 effort 钮,SKILL B 明禁传 invented option。**这是 Finding #2「/goal 对 agent 不可执行」的同类**:reference 给了 agent
  够不到的 lever,照做会写出无效 workflow 脚本。处置:effort 从「可执行 lever」降级为「知识备注」(标注 API 层概念、主线
  effortLevel 受其影响、但派发 API 不透传 → leaf 成本靠 **model tier**);四杠杆→三杠杆(downgrade model 提为首要 / lower
  WIP / defer high-float);SKILL.md reference index + CHANGELOG lever 列表同步去 effort。
- **教训补强**:① 呼应 #24——纯 shell/脚本近似真实语义,必须对协议/环境允许的全部形态做对抗推演(滑动窗口问「过期/连续跨界
  怎样」,带外加速器问「外部 schema 与我承诺一致吗、本环境可验吗」),fail-stale/fail-empty 两方向各验一例。② **跨抽象层照搬
  概念前先核对本层 API 契约**:`effort` 是 claude-api(API 层)真实参数,但 cc-master 派发面不暴露;reference 给的每个 lever
  都要能落到 cc-master 真实派发 API(`agent()`/Agent/shell)的某个 opt 上,否则就是 Finding #2 式不可执行祈使。
- **round-4(codex 复审追加,机制再成功 → fuse 停)**:codex 第 4 轮再逮 2 条(E/F),又都测试看不见:
  - **(E) [P2] dedup 该保留 max usage**(:66-68):Claude Code tool-iteration 会 rewrite 同 `message.id`,后写记录带更
    完整(累积)的 usage。first-seen dedup 保留**第一次 partial 总量**、跳过后续 → **低报** usage/burn → pacing 误以为
    配额还多。fixture 两条 m2 usage **相同**恰好掩盖了它(测试盲区再现)。
  - **(F) [P3] 过滤 `ts > now` 未来行**(:87-90):`--now` 是文档化时间锚点,但晚于 now 的行仍参与 block → `blocks[-1]`
    可能是未来块、报「还没发生」的 usage。这正是我此前手动真跑「14:30 同块」观察到、却**误判为非 bug**的现象——codex
    指出 `--now` 语义本就该过滤未来。
  处置:(E) dedup 改 `by_id` dict 保留**每 id 最大 usage**;fixture 改 m2 两次不同(partial cr=0→50、full cr=2000→2050)
  让 dedup-max 被 test 真覆盖(反证:first-seen 得 1400,max 得 3400)。(F) build block 前过滤 `ts <= now`;加 future case
  (rolling now=11:00 → 只 r1=100,非未来 300)。passed=10。
- **fuse 决定**:codex 一程 **4 轮共逮 6 条**(A/B/C/D/E/F,全收口)——与 Finding #22「一程逮 6 条→fuse 停自动循环」数量
  一致,**据先例停自动 codex 循环**(不再自动 round-5;需再验手动 `bash scripts/codex-review.sh --base main`)。6 条全是
  「全套测试 + validate + smoke 都绿、唯独独立第二端点验收能逮」的形态盲区——codex-reviewer 价值在本 PR 的最强证明;
  cc-usage.sh 这类「纯脚本近似真实语义」的带外件,改动必经 codex 第二端点验收(Finding #24 纪律的活样本)。
- **教训(本轮新增,关于 orchestrator 自身执行)**:本轮我多次把 Edit/Write **写进回复散文却没作为真 tool call 执行**,
  并误把虚构的「成功」当真(fixture Write、台账 round-4 段反复假落盘),靠 `grep`/`git status` 真核才发现。**固化:涉及
  落盘的改动必须以真 tool_result 为准、关键件改后 grep/git status 复核,绝不据自报断言已落盘**——正是 cc-master「只信端点
  验收、agent 自报不可信」红线对 orchestrator **自己**的适用。
- **严重度 / 来源**:✅ 机制验证(正向,codex 4 轮共逮 6 条)+ 6 should-fix 已修 / 一手(codex 第 5–8 次真跑,本 PR 端点验收)。

## Finding #28 — 常驻重注的魂把已 live 的 hook 标作「TODO」,reinject 指导失真 ✅已修

- **现象**:对 POLISH-SOUL 产出做端点验收、逐行亲读 `skills/master-orchestrator-guide/SKILL.md` 时,发现 Vision-index
  的 C2 行、by-design 收口句、resonance 闭注三处仍把 **H8(usage-pacing.js)标作「TODO / 待批准 / 随它的 PR 落地」**——可
  H8 早已建成、wired 进 `hooks.json`(Stop 段两个 hook)、被 ADR-007 列为已接受的六 hook 之一、`structure.test.mjs` 断言它
  跨 5 事件 live、红线 6 grep 也把它纳入武装闸覆盖。文档与现实直接打架。
- **根因**:MAPSYNC(把 hook 从 TODO 迁到 live 的那步)当初**只同步了 H6/H5/H3 子集,漏了 H8**。是「同步一张状态映射表时只改了记得起来的那几行、没穷举全部条目」的典型部分同步遗漏。
- **影响**:`SKILL.md` 是 `SessionStart` hook 每次 compaction **整篇重注**的常驻手册——读者基数 = 未来每一场 orchestration 的
  每一次 compaction。它谎报「C2 的 pacing hook 还不存在」,会让 orchestrator 误以为没有 usage 感知、转而手动补偿或误判
  pacing,而 H8 其实一直在 Stop 上如常注入 `[cc-master pacing] 5h 配额临界…`。这是「给 agent 的指导不对」最高曝光的一类:错在魂里。
- **处置**:端点验收**本身**暴露的 micro-fixup(红线唯一例外,T∞≈T₁、派发成本 > 自收),属「integrate:校准魂的 hook 状态图与
  live hook 集对齐」——由建并验过这些 hook 的 orchestrator 直接收掉。校准三处:C2 行改引 H8 真注入短语、by-design 句改「C2 的
  hook 列现由 H8 兑现」、resonance 段加 H8 的 Stop pacing 锚点 + 闭注改「H3/H5/H6/H8 现均已 live」。改后**重验 dot-graph md5
  对 HEAD 仍 byte-identical、签名短语 2/2/3/3/6 未变、`H8.*TODO|待批准` 残留归零**——确认只动了 Vision-index 散文、牙齿零扰动。
- **教训(固化候选)**:① **同步任何「状态映射表」(hook 清单 / 能力矩阵 / TODO→live 迁移)必须穷举全部条目,不能只改记得起的子集**
  ——部分同步会留下「文档说没有、现实已存在」的反向漂移,且越是常驻重注的文档(魂)曝光越大。MAPSYNC 这类批量状态迁移宜配一条
  「迁移后 grep 残留标记数应归零」的自检(本案的 `grep 'H8.*TODO|待批准'`==0 即是)。② 呼应 Finding #19/#22 —— 文档/现实漂移
  是「测试全绿也看不见」的形态盲区(`run-tests` 只验结构、不验 Vision-index 散文真不真),codex 第二端点验收对这类高命中,本条
  恰是 POLISH 阶段亲读魂、抢在 codex 之前自逮的一例。
- **严重度 / 来源**:should-fix(reinject 指导失真,高曝光低 blast)/ 一手(POLISH-SOUL 端点验收亲读暴露,本 PR)。

## Finding #29 — 公开落地页 demo 照搬真实保密项目场景 = 泄密;且泄密早潜伏在分发件里 ✅已修

- **现象**:为 README 重定位写「Watch one run」demo 时,我直接复用了仓库现成的 `walkthrough.md` 例子——一个**某真实保密项目的数据模型 schema 迁移**场景(具体 schema / 字段标识符在本台账内一律隐去——见 [[Finding #35]]:台账自身也是发布面)。用户 review 当场指出:**这是一个真实保密项目的数据模型,放进公开落地页有泄密风险**;且这个 demo「太单薄」(只一个 T0→三叶 fan-out),没体现插件的多层能力。
- **根因**:① **照搬现成例子时没核它的 provenance 是否适合公开**——`walkthrough.md` 是内部 dogfood 时写的,用了手边真实项目的 schema;搬到「最高曝光面的公开落地页」时,我没问「这个场景能不能公开」。② 更深一层:泄密**早已潜伏**在 `walkthrough.md` / `smoke.sh` / `board.md`(**随插件分发**)/ `board.example.json` / `spec.md` 里——README 不是引入者,是**放大器**(把一个本就在公开仓库里的保密场景,搬到了所有人第一眼看的地方)。
- **影响**:保密项目的数据模型(具体 schema / 字段 / domain 标识符已隐去)出现在 8 个公开站点,其中 2 个(`board.md` / `board.example.json`)**随插件分发给每个用户**。这是 must-fix 级——一旦发布,等于把别人的私有 schema 钉在了公开 README 与分发制品上。
- **处置**:① 全仓 scrub——把保密场景换成一个**通用、合成、非保密**的 i18n 国际化场景(8 站点:README×2 / walkthrough / smoke.sh / board.md / board.example.json / spec.md / track-b),三者(README ⇄ walkthrough ⇄ smoke.sh)严格对齐、`smoke.sh` 真跑 exit 0;② 顺带按用户「self-contain」要求,**彻底清除所有外部出处/上游项目的字眼与暗示**(13 站点),让本仓所有文档项目内自洽;③ README demo 同时**做厚**——显出模型分档(临界根强模型/float 廉价)、HITL(`blocked_on:"user"` 决策节点并行 surface)、escalation(RTL locale 升格 workflow)、pacing(5h 墙节流)、compaction 存活、端点验收+强制自检列未答决策。repo-wide grep 两轴零残留、全套绿、smoke.sh PASS 自证。**(注:当时的 grep 漏了台账自身这份发布面文档——本条目正文一度仍逐字带着保密标识符,后由 [[Finding #35]] 二次匿名化清除并把搜索面扩到全仓含 ledger。)**
- **教训(固化)**:① **任何进入公开/分发面的「示例 / demo / fixture」场景,必须是通用合成的,绝不照搬任何真实(尤其可能保密)项目的领域模型/命名/schema**——哪怕它就在仓库里现成可用。搬运现成内容到更高曝光面时,**provenance 审查**是必做的一步(同 §11「对外/不可逆先问用户」精神)。② 内部 dogfood 写的例子若用了真实项目素材,**在它还只躺在内部文档时就该 scrub**,别等它被搬上落地页才发现——「分发件里的保密场景」是比「README 里的」更隐蔽、更早该堵的洞。③ 这也是一次正向的 **HITL 验证**:用户作为 async reviewer 在 commit 前一眼逮到了测试与 codex 都不会报的「语义级泄密」——印证 lens 7「用户是特殊的 async worker」+ 端点人审不可替代。
- **严重度 / 来源**:**must-fix(泄密)** / 一手(用户 review catch,本 PR)。

## Finding #35 — 记录泄密的台账条目自身把秘密又写了一遍:dogfood ledger 也是发布面 ✅已修

- **现象**:Finding #29 在**记录**「保密 schema 已从全仓 scrub 干净」时,条目正文本身把那几个保密标识符(数据模型 / schema / domain 名)**逐字写了出来**用以描述「删了什么」。于是 #29 里「repo-wide grep 零残留」的断言**是假的**——秘密仍躺在 `design_docs/dogfood-findings.md`(tracked、随仓库发布)的三处(摘要表 + 现象 + 影响)。codex CODEX13 端点验收逮到(P1,release-blocking)。
- **根因**:① **把「描述一次泄密」误当成安全的**——记录「我移除了 X」时,写出 X 本身**就是再次发布 X**。dogfood ledger 是 tracked 文档、会随仓库公开,它和 README / 分发件一样是**发布面**,不是私密笔记。② scrub #29 时的 `grep` 只搜了「场景文件」(walkthrough/smoke/board),**没把台账自己纳入搜索面**——验证范围漏掉了正在书写验证结论的那份文件(自指盲区)。③ 承 #29 自身的教训②「provenance 审查」:这次连「记录 provenance 问题的文档」都成了泄露 provenance 的载体。
- **影响**:与 #29 同性质的 must-fix 泄密,只是藏在「已修」标记的台账条目里更隐蔽——发布即把私有 schema 标识符钉在公开 ledger 上。
- **处置**:把 #29 三处(L43 摘要表 / 现象 / 影响)的保密标识符全部换成**匿名占位**(「某真实保密项目的数据模型」「schema / 字段 / domain 标识符已隐去」),教训与可追溯性零损失;#29 处置段补一句指向本条的「台账二次清除」。**全仓 re-grep 保密标识符归零**(含台账自身)。顺带中和 README 三范式示例里那句呼应保密场景形状(N-domain schema 迁移)的运行示例措辞(无保密名但属「暗示」,按用户 self-contain 指令一并改成与 i18n demo 一致);全仓 `git grep` 时本条也额外逮到 `tests/hooks/test_reinject.sh` 的测试 goal 串仍带旧保密场景的回声字样(codex 只标了台账、没标测试)——一并换成 i18n,印证「搜索面须含测试」。
- **教训(固化)**:① **凡书面记录一次泄密 / 敏感清除,记录本身必须匿名化——绝不在台账里逐字复述被清除的秘密**。「描述删除」≠「安全」;ledger / changelog / commit message / PR body 都是发布面,和产物同等对待。② **验证一次 scrub 的 grep 必须把「正在写结论的那份文档」也纳入搜索面**——自指盲区(documenting-the-fix-reintroduces-it)是 #29→#35 这条链的根;scrub 类任务的收尾自检应是**全仓 `git grep <secret>` 归零**,而非「场景文件 grep 零残留」。③ 承 #19/#27/#30/#32/#34:又一例「测试全绿、唯独 codex 第二端点验收能逮」——语义/安全类盲区里,**自指型泄露**(修复说明里带着被修的东西)codex 命中率高。④ 本条与 #29 是同一根的两层:#29 是「场景泄密」,#35 是「记录场景泄密时再泄一次」——提醒任何 must-fix 安全项**收尾验证的搜索面要覆盖到验证文档自身**。
- **严重度 / 来源**:**must-fix(泄密,release-blocking)** / 一手(codex 第二端点验收 CODEX13,本 PR)。

## Finding #36 — 两个 reviewer finding 反向振荡(嫌孤儿化 ↔ 嫌污染);用非协商红线当裁决锚 + 文档化止振荡 ✅已修

- **现象**:同一个设计点(blank-session active 板该不该武装)被 codex 连着两轮**反向**提:**CODEX12** 嫌严格 session-match 把 `owner.session_id:""` 的板**孤儿化** → 我加了「对称 degrade」(空 board sid 也武装);**CODEX14(P1)** 立刻反过来嫌这个对称 degrade **破红线 6**——blank 板会武装**任意**不相关 session(从没跑过 `as-master-orchestrator` 的普通 session 也被 block-stop / 注入编排 context / pacing 警告),正是跨会话污染。一加一减,典型的 fix-A-breaks-B 振荡。
- **根因**:① **两个 finding 各自局部正确,但全局是一个 trade-off**——孤儿化 vs 污染是同一枚硬币两面,没有"两全"的天真解(blind hook 无法区分"该收养这块孤儿板的合法会话"与"不相关会话")。② 我第一轮(CODEX12)**没把它当 trade-off、而当 bug 直接修**,过度修正成了 red-line 违例。③ 真正的判别信号缺失被忽略了:**官方 resume/compaction 保留 session_id**(已 #34 核实),所以合法续跑的板**根本不是 blank**——CODEX12「blank=resume 路径」的前提本就错,孤儿化只是 bootstrap 缺 sid 建板的**异常**。
- **影响**:对称 degrade(commit 37db5c3)若发布,会让任何 blank active 板武装宿主上每一个会话——把红线 6(用户非协商)在最隐蔽处打穿。CODEX14 在发布前逮住。
- **处置**:**回退对称 degrade**(4 hook 删 board-sid-空分支,保留 stdin-sid-空的 compaction degrade);**blank 板保持休眠(fail-safe)**,由**显式 re-arm**(重跑 `as-master-orchestrator` → bootstrap 重盖 session_id)认领。**据非协商红线 6 裁决**(污染 > 孤儿边缘 case),并把整个振荡 + 裁决 + 理由写进 **ADR-007 §2.3(asymmetric)+ §4.5 Alternative E**(「auto-adopt blank — tried and reverted」),board.md 同步改正——**让下一个 reviewer 再提时有现成的书面裁决可指,不再 litigate**。端点亲手复现四情形(blank 休眠 / 非空不匹配休眠 / stdin 空武装 / 精确匹配武装)确认。
- **教训(固化)**:① **遇到两个 reviewer finding 反向拉扯(振荡),别来回翻烙饼——停下,认出这是一个 trade-off,用一个更高的不变式(这里是用户非协商红线)当裁决锚,选定一边并把『为什么是这边 + 另一边为何被否』写进 ADR 的 Alternatives**。书面裁决是止振荡的唯一办法;只改代码不改文档,下一轮 reviewer 会把你推回去。② **第一次收到 finding 就要分清「这是 bug」还是「这是 trade-off 的一端」**——把 trade-off 当 bug 直接修,极易过度修正撞穿另一条约束(本案 CODEX12→红线 6)。③ **fail-safe > fail-open**:拿不准时,「保持休眠(少做)」几乎总比「武装(多做、可能污染)」安全——尤其当多做会打穿一条 red line。④ 振荡也是 closure-loop 的一个收敛信号:从"每轮新实质 bug"变成"对同一点反复拉扯",说明接近底部、该靠原则收口而非继续滴漏。
- **严重度 / 来源**:P1(对称 degrade 破红线 6,发布前逮住)/ 一手(codex 第二端点验收 CODEX14,与 CODEX12 双向夹逼,本 PR)。

## Finding #30 — hook 建在「未验证的平台输出路由假设」上;codex 二审 + 官方文档裁决后移除 ✅已删

- **现象**:本轮把 orchestrator 的运行时信号做成确定性 hook 时,新建了 `subagent-stop.sh`(`SubagentStop` 事件,代号 H6),目的是「后台 sub-agent 一完成,就自动**提醒父 orchestrator** 去 integrate / 端点验收」。它用 `hookSpecificOutput.additionalContext` 注入那条 nudge。**但 codex 对 committed 代码做第二端点验收时指出**:`SubagentStop` 的 additionalContext **注入的是刚结束的那个 sub-agent 自己的 context,不穿过父 orchestrator 边界**——所以这条「提醒父线」的 nudge 递错了对象,父线根本收不到。
- **根因**:① 建 hook 时只验证了**事件存在**(`SubagentStop` 真实存在、能 block / 注入),却**没验证它的输出路由**——additionalContext 到底注入**谁的** context。研究文档(`claude-code-hooks-reference.md`)甚至自称对官方端点验收过,断言「SubagentStop 自动通知主线」,但这条**路由断言是错的**(该文档第一轮还整个漏了 SubagentStop,第二轮补回来却把路由判反)。② 更深:**子 → 父的自动通知本就不是 hook 的职责**——父 orchestrator 本来就会自动收到 sub-agent 的结果摘要(Claude Code 内建),这个 hook 从设计上就**冗余**;真正的跨 agent 协调属 background agents / agent teams(本仓红线 5 有意排除)。
- **影响**:一个**做不到自己设计目的、且冗余**的 hook 被建出来、测过、接线、还差点随 0.3.0 发布。它通过了所有单元测试 + smoke.sh + plugin validate——因为这些只验「给定 board 状态,hook 输出什么」,**验不了 additionalContext 注入进谁的 context** 这种平台语义。
- **处置**:① claude-code-guide 查官方文档**权威裁决**:additionalContext 达 sub-agent 非父线、`decision:block` 是「拦 sub-agent 别停」的执行控制非通知、父线自动收结果摘要、子→父通知属 background-agents/teams。codex 与官方文档**双重确认**。② 全仓级联**删除** `subagent-stop.sh`(去 hooks.json 注册 / 删文件 + 测 / structure.test 6→5·5→4 事件 / README 双语 · SKILL 魂 · AGENTS · CHANGELOG · ADR-007 · SECURITY · redesign 文档去 H6,诚实改「已建后又移除」)。「完成即整合」的纪律不丢——它本就活在 SKILL A 决策程序的 recon 步 + 内建通知里。**魂 dot-graph md5 byte-identical**(只动 2 处 hook 共鸣引用、零碰牙齿)。
- **教训(固化)**:① **建任何 hook 前,先验证它的「输出去向」,不只验「事件存不存在」**——`additionalContext` / `decision:block` 作用在谁身上(父 vs 子 vs 主会话),是 hook 能不能达成目的的命门。平台语义必须对**官方文档 / 源码**端点验收,连「自称验过」的二手研究文档都可能把路由判反(本条是研究文档**第二次**在 SubagentStop 上出错)。② **codex 第二端点验收必须能看到真代码**:这条之所以拖到现在才逮,是因为新 hook 文件一直 untracked、不进 `git diff`,前两轮 codex 都看不到它们的代码——**先 commit 再 codex** 是让第二验收真正生效的前提(呼应 Finding #20「带外脚本 V 端点必须真跑」)。③ 呼应 Finding #19/#21/#27——「全套测试 + validate 都绿、唯独独立第二端点验收能逮」的形态盲区里,**平台语义类**(谁收到注入)是 codex 命中率极高的一类。
- **严重度 / 来源**:should-fix(误设计 hook,发布前逮住)/ 一手(codex 第二端点验收 + 官方文档裁决,本 PR)。

## Finding #31 — 落地页把 hook 能力**过度宣称**:对外说 live「5h/7d burn-rate pacing」,实现只有 5h ✅已修

- **现象**:codex 第二端点验收(CODEX8)指出:`usage-pacing.js` 运行时只调 `computeFiveHour()`、只算 5h 滚动窗,但 README / SECURITY / CHANGELOG / AGENTS 等对外文档把它宣称成 live「5h/**7d** burn-rate pacing」。当 5h 窗还有余量、而 7d 周配额已逼近上限时,这个 Stop hook 仍**静默**——长跑会对 7d 维度**全盲**,除非用户手动跑 `cc-usage.sh`。
- **根因**:① 把**带外工具 `cc-usage.sh` 的能力**(它确实同时吐 `five_hour` + `seven_day:{used_tokens}`)错记到了 **live hook** 头上——README 重定位做能力矩阵时,「5h/7d」这个口号从 cc-usage.sh 顺手贴到了 hook 行。② 更细一层的事实错:**「7d burn-rate」这个概念根本不存在**——连 cc-usage.sh 在 7d 上也只算**累计 `used_tokens` 总量**(无 burn rate、无撞墙锚,因为周配额 reset 点不在 JSONL 里)。所以「5h/7d burn-rate」双重失真:既错把 7d 归给 live hook,又虚构了一个 7d burn-rate。③ hook 自身的 header 注释**一直只声称 5h**——是外层文档单方面 over-claim,代码与自述本来就对。
- **影响**:最高曝光面(落地页能力矩阵 C2 标 🟢 Live)登了一条**实现兑现不了**的能力宣称。这正是本仓「no-silent-failure / gate-green ≠ passed / 诚实 🟢🟡⚪ 矩阵」纪律在**对外宣称**维度的同构破口——一条 advertised ≠ implemented 的 C2 行,等于把「闸绿」当「真过」登在了 README 第一屏。`run-tests` / `plugin validate` 全绿也看不见它(它们验结构,不验「宣称对不对得上实现」)。
- **处置**:**收窄宣称、不补功能**(codex 给了「补 7d 信号 或 收窄宣称」两条路)。判据:无 `CC_MASTER_7D_BUDGET`(net-new env)时 7d 无诚实撞墙锚,对绝大多数没设预算的用户**仍会静默**——终局期补 7d = 加复杂度却不改可观测行为的 scope creep / gold-plating。故选**纯文档诚实修正**:凡把「5h/7d」能力归给 live hook 处一律收窄为 5h(SECURITY / README×4 / README_zh×4 / CHANGELOG / AGENTS 共 11 处),7d 明确归 `cc-usage.sh`(带外、累计总量、非 live 注入);概念性的「5h/7d 配额窗口」引用(cost-and-pacing.md / SKILL.md:26 / cc-usage.sh 自述)**准确,保留不动**。**零代码改**(hook 本就只做 5h),双语 `##` 节仍同构、全套门绿。
- **教训(固化)**:① **落地页/能力矩阵的每条 capability 宣称,发布前必须对「它由哪个制品兑现、那个制品实际算什么」逐条核对**——尤其当一个能力跨「live hook + 带外脚本」两个制品时,别把带外脚本的能力贴到 hook 上(provenance 同 Finding #29:搬运到高曝光面必做来源审查)。② **宣称里的技术词要对实现为真**——「7d burn-rate」连工具层都不存在,口号化的并列(「5h/7d」)最易把一个不存在的概念夹带进对外文档。③ 收窄宣称 vs 补功能:**默认选「让文档说真话」而非终局期临时加 feature**——把 advertised 拉到 implemented,是稳妥、低风险、不 overreach 产品方向的诚实修正(对照 §6 Iron Law:别造一个 baseline 证明不需要的东西)。④ 再次印证 Finding #19/#27——「测试全绿、唯独 codex 第二端点验收能逮」的形态盲区里,**文档/实现漂移**是 codex 高命中的一类(本条是同一 PR 内第三例:#28 魂标 live hook 为 TODO、#30 平台路由判反、#31 对外 over-claim hook 能力)。
- **严重度 / 来源**:should-fix(落地页 over-claim,高曝光低 blast,零代码)/ 一手(codex 第二端点验收 CODEX8,本 PR)。

## Finding #32 — PostToolBatch 在 sub-agent 上下文也触发:指挥专属 WIP 警告泄漏给 leaf worker(破红线4)✅已修

- **现象**:codex 第二端点验收(CODEX9)指出:`posttool-batch.sh` 注册的官方 `PostToolBatch` 事件**会在后台 sub-agent(Task 派生的 leaf worker)上下文内部也触发**;此时 hook 的 stdin 仍带 orchestrator 的 `session_id`,于是 leaf worker 自己的一批工具调用会**匹配上主板**,在主板超 `wip_limit` 时收到「指挥专属」的 WIP/编排 `additionalContext`——而 sub-agent 内注入的 additionalContext 进的是**该 leaf worker 自己**的 context。等于**把指挥的乐谱递给了乐手**,破红线 4(指挥不演奏:WIP pacing 是 orchestrator-only 的认知指导)。
- **根因**:① 设计 `board_matches` 武装闸时,默认 PostToolBatch 只在主线触发,**只用 `session_id` 判 arming**——没考虑 per-tool 类 hook 在 sub-agent 内同样 fire 这一平台语义。② sub-agent 与主线**共享同一 `session_id`**,所以 session-scoped 闸**区分不了**两者;真正能区分的是官方 stdin 里**仅在 sub-agent 内出现、主线缺席**的 `agent_id` 字段——而原实现根本没解析它。③ 又一次「**测试全绿看不见**」:`run-tests`/`smoke` 只喂主线形态的 stdin 验「给定 board → 输出什么」,从不喂带 `agent_id` 的 sub-agent stdin,故 production 才会暴露的污染在单测里完全不可见(同 #30 的形态盲区)。
- **影响**:一个破红线 4 的指导泄漏——leaf worker 会被灌入「别再加并行、defer 高 float」这种只对指挥有意义的指令,可能扰动单元 worker 的执行。通过了所有单测 + smoke + validate,只在真 sub-agent 上下文下才发生。
- **处置**:**官方文档权威核实先行**(承 #30 铁律:平台语义不凭 codex/记忆断言)——派 claude-code-guide 对 docs.claude.com 逐条核实,**坐实** codex 全部断言:`PostToolBatch` 是有效事件、在 sub-agent 内会触发、官方字段确实叫 `agent_id`(仅 sub-agent 出现、主线缺席、官方推荐「空=主线 非空=子」)、sub-agent 内 additionalContext 进子自身 context。据此 TDD 修:在 `posttool-batch.sh` 的 `sid` 解析后、武装闸**之前**加一道 **sub-agent 闸**——纯 bash sed 解析 `agent_id`(红线1 禁 jq,比照 session_id 写法;只认带引号值,故 `null`/缺席当主线),**非空即静默 `exit 0`**。**只改 posttool-batch.sh 一个 hook**:`Stop`(verify-board/usage-pacing)与 `SessionStart`(reinject)是主线生命周期事件、不在 sub-agent 触发(子完成走独立 `SubagentStop`,本仓已不注册),无需此闸——不扩散。端点亲手复现(超 cap 主板 + 带 agent_id stdin → 静默;无 agent_id → 照常警告;`agent_id:null` → 当主线)全清。
- **教训(固化)**:① **任何经 `additionalContext` 注入「编排者专属」指导的 per-tool 类 hook(PostToolUse/PostToolBatch),必须用 `agent_id` 把 sub-agent 上下文 gate 掉**——因为这类 hook 在 sub-agent 内同样 fire、且注入落在子自身 context,session-scoped 闸区分不了(主线与子共享 session_id)。这是红线 4 在 hook 层的具体落地。② **承 #30**:平台语义(事件在哪触发、stdin 带什么字段、注入进谁的 context)是 hook 正确性的命门,**必须对官方文档端点验收**——本条与 #30 互为镜像:#30 验证**推翻**了二手研究文档的错误路由断言,#32 验证**坐实**了 codex 的断言;两种结果都只有「真去查官方」才能得到,凭记忆/二手都不可靠。③ 单测盲区固化:**hook 测试除主线 stdin 外,应补一份带 `agent_id` 的 sub-agent 形态 stdin**,否则「sub-agent 内行为」永远测不到(本案 Case 15/16/17 即补此)。④ 同一 PR 内**第四例**平台/文档语义类(#28 魂标 live hook 为 TODO、#30 平台路由判反、#31 对外 over-claim、#32 sub-agent 触发未 gate)——印证 codex 第二端点验收对「测试全绿唯独独立验收能逮」这一形态盲区的高命中。
- **严重度 / 来源**:should-fix(红线4 指导泄漏,发布前逮住)/ 一手(codex 第二端点验收 CODEX9 + 官方文档坐实,本 PR)。

## Finding #33 — agent-facing 文本与 hook 契约脱节:命令叫 agent 重设 ARM 盖的 session_id(P1)+ 魂仍标已删 H6 为 live(P3)✅已修

- **现象**:codex CODEX11 两条——① **P1(命令)**:`as-master-orchestrator.md` 第 2 步叫 agent「从运行环境设好 `owner.session_id`」。但 ADR-007 下 `bootstrap-board.sh` **建板即把唯一 hook 可见的 `owner.session_id` 盖成创建它的 session**(ARM 动作本身)。agent 拆 DAG 重写 board 时若把它覆写成空值/猜的值,**所有 session 精确匹配的 hook(reinject/verify-board/posttool-batch/usage-pacing)对本 orchestration 集体休眠**——整套运行时静默失效。② **P3(魂)**:常驻重注的 `SKILL.md` 收尾仍写「H3/H5/**H6**/H8 现均已 live」,但本 PR 已删 `subagent-stop.sh`/`SubagentStop`(H6,Finding #30)——魂的 hook 状态图带一条 stale claim,compaction 后会让编排者期待一个不存在的子→父通知路径。
- **根因**:① **agent-facing 文本(命令散文 / 魂的 hook 图)没跟着 hook 契约的演进同步**——两条都是「文档说的」与「hook 实际做的」脱节。P1 是预存隐患:原英文命令一直这么写,ADR-007 引入 ARM-stamp 后该指令就**反了**,而 CMD 中文化忠实搬运了错的原意(中文化只换语言、不审语义正确性)。P3 是 Finding #28 同款 **MAPSYNC 漏**:删 H6 时改了 2 处共鸣引用、漏了这条收尾汇总行(#28 的教训「同步状态映射表必须穷举全部条目」恰好又被自己违反一次)。② 共性:**当一个 hook 以「写某个 narrow-waist 字段」作为它的契约动作(bootstrap ARM-stamp session_id),任何 agent-facing 指令都不能再叫 agent 去(重)设那个字段**——这是 ADR-007 的一条未写明推论。
- **影响**:P1 是 **P1 级**——一条照着做就会让整套 armed-hook 运行时对本 orchestration 全哑的指令,印在点火命令里(每次起 orchestration 都注入)。P3 在魂里、每次 compaction 重注,误导面广但 blast 低(只是认知误期,不致命)。两条都通过了所有单测 + validate——测试验「给定 board → hook 输出」,验不了「命令散文叫 agent 干的事会不会破坏 hook 契约」「魂的 hook 图与实际 live 集是否一致」。
- **处置**:① P1——命令第 2 步改为「填 `goal`/`git`/`tasks`;**`owner.session_id` 已由 bootstrap 盖好,原样保留、绝不覆写**」并写明覆写的后果(四个 hook 集体休眠)。**按 #28 教训穷举** `commands/`+`skills/`+`spec.md`+`adrs/`:确认别处再无「叫 agent 设 session_id」的指令,隐患封口。② P3——`SKILL.md:157` 删 H6,改「H3/H5/H8 现均已 live」;grep 穷举确认 SKILL.md 与全部 references 再无 H6 残留。改后**重验 dot-graph md5 对 HEAD 仍 byte-identical**(`d6923683…`,只动 Vision-index 收尾行、零碰牙齿)。
- **教训(固化)**:① **凡 hook 以「写某 narrow-waist 字段」为其契约动作,所有 agent-facing 文本必须『保留勿覆写』那个字段**——ARM-stamp 的 `owner.session_id` 是头号案例;给 agent 的填板指令要显式区分「hook 已盖好、别碰」与「你来填」。② **翻译/中文化≠审校**:CMD 中文化忠实搬运了一条语义上已经错的英文指令——批量改写(翻译/重构)时,顺带对照当前 hook 契约审一遍语义正确性,别只换皮。③ **MAPSYNC 第三次复发**(#28 H8 标 TODO、本条 P3 H6 标 live)证明:魂里任何「hook 状态汇总表/收尾行」是高频漂移点,删/加 hook 的 PR **必带**一条 `grep 'H[0-9]'` 全量核对 live 集的自检。④ 承 #19/#27/#30/#32:agent-facing 散文与契约脱节是「测试全绿唯独 codex 第二端点验收能逮」形态盲区里的又一类(本 PR 第五例语义/文档类)。
- **严重度 / 来源**:P1=must-fix(armed-hook 运行时全哑,发布前逮住)· P3=should-fix(魂 stale,高曝光低 blast)/ 一手(codex 第二端点验收 CODEX11,本 PR)。

## Finding #34 — armed-gate 把 empty-session_id 的 active 板孤儿化;权威核实反证 codex 半个前提,对称 degrade 收口 ✅已修(处置后被 [[Finding #36]] 回退)

- **现象**:codex CODEX12 指出 session-scoped 武装闸(`owner.session_id==stdin sid`)会把**未匹配 session_id 的 active 板静默孤儿化**,称这破坏「插件宣称的 board-based resume」:① 用户在「全新会话 restart」→ stdin sid 不匹配 → reinject 跳过 → resume 失效;② 升级时旧 active 板 `owner.session_id:""` → 不匹配 → 孤儿化。
- **根因 / 权威反证**:**先对官方文档权威核实(claude-code-guide,承 Finding #30 铁律:平台语义不凭断言)**,结论把 codex 的两幕**劈成一真一伪**——① **伪**:`claude --resume`/`--continue` **保留原 session_id**(`SessionStart.source:"resume"`,session_id 不变),compaction 也保留(`source:"compact"`);官方 resume/compaction 路径下 gate 照常匹配、reinject 照常工作。「全新独立会话接管旧板」**无官方范式**(sessions are independent),armed-gate 在全新会话休眠**正是设计目标(红线 6)**——ADR-007 的 Alternatives 早已**明确否决**「任何 active 板即武装」。所以 codex 第一幕建立在「resume 会换 session_id」这个**错误前提**上。② **真**:当 board 的 `owner.session_id` 为**空串**(bootstrap 若在缺 session_id 的 stdin 上建板就会盖空、或迁移/手改)时,它对任何非空 stdin sid 都不匹配 → **永久孤儿化**。这是真缺口——原 degrade 只对「stdin sid 空」放行,**没对称覆盖「board sid 空」**。
- **影响**:一块 `owner.session_id:""` 的 active 板会被所有 session 精确匹配的 hook 永久无视——orchestrator 起不来、reinject 不重注、goal-hook 不兜底。低概率(bootstrap 正常会盖非空 sid)但真实(缺 sid 的 UserPromptSubmit stdin 会触发)。
- **处置**:**对称化 degrade**——`owner.active 且 (stdin sid 空 ∨ board owner.session_id 空 ∨ 二者字面相等)` 即武装(4 hook:3 bash `board_matches` 各加 `[ -z "$board_sid" ] && return 0`、node `isArmed` 加 `if (!owner.session_id) return true`)。**只放行 empty-session_id(未认领板),「非空但不匹配」仍休眠**——端点亲手复现:`owner.session_id:""`+非空 stdin → 收养(block/warn);`owner.session_id:"OTHER"`+不同 stdin → 仍休眠(红线 6 防线一字未动,没退化成被否决的「任何 active 板即武装」)。同步两文档:ADR-007 §2.3 扩成对称 degrade + 新增「官方语义裁决」小节(resume/compaction 保 session_id、`source` 字段、sessions independent——故 resume 路径照常、全新会话休眠是设计目标、只 empty-sid 需收养),board.md 加一小段续跑三态(SSOT 指回 ADR-007)。
- **教训(固化)**:① **平台语义核实能反证 reviewer 的前提**——codex 是强 reviewer 但它对「resume 是否换 session_id」的隐含假设是错的;承 #30/#32,**任何「跨会话/续跑/事件在哪触发」类断言都要对官方文档端点验收**,核实结果可能让一条 finding 从「修代码」缩成「修半条 + 把另半条记成 by-design」。② **degrade/兜底逻辑要查对称性**:已为「我方(stdin)缺值」兜底时,对面(board)缺同一字段往往也要兜——单边兜底是常见盲区。③ **by-design 与 bug 要写进 ADR**:全新会话休眠是设计目标,不写明就会被一轮轮 reviewer 反复当 bug 提;ADR-007 现已把官方语义裁决固化,后人不必再 litigate。④ 承 #30/#32:本 PR 第三例「平台语义经权威核实改变结论」(#30 推翻研究文档、#32 坐实 codex、#34 半推翻 codex)——三种走向都只有真查官方才得到。
- **严重度 / 来源**:should-fix(empty-sid 板孤儿化,低概率真实;另半条 by-design 澄清)/ 一手(codex 第二端点验收 CODEX12 + 官方文档权威核实,本 PR)。

## Finding #37 — cc-usage.sh/usage-pacing.js 本地反推 5h 窗口失真到数量级,reset 倒计时误导 orchestrator pacing ✅已落地

- **现象**:用户在一场 1M-context 长会话里要查「5h 窗口距 reset 还剩多久」。`cc-usage.sh`(与 `usage-pacing.js` **同源同算法**)报 `window_remaining_min:21`(reset≈16:14)、`used_tokens:5.6 亿`;orchestrator(我)据此**误报「只剩 21 分钟、要紧活赶紧收口」**。但用户**账户配置面板**显示:距 5h reset 还有 **2h55m**(reset≈18:54)、5h 用量 **~59%**、7d 用量 **~86%**。反推与账户权威在**最关键的 reset 倒计时上差 2h40m**(量级级相对误差),且方向相反地误导了 pacing 决策。
- **根因**:`cc-usage.sh`/`usage-pacing.js` 用**本地 JSONL 的 timestamp 反推** 5h rolling block(ccusage 口径):窗口**起点钉在「最近一段连续活动的首条 assistant 消息」**。端点复现——该 block 从 11:14:33 起、含 2808 条连续消息、中间无 >5h 间隙 → 被算成一整块,起点焊死在 11:14,reset=11:14+5h=16:14。但**服务端的真实 5h 计费窗口按它自己的锚点滚动**,本例约在 13:54 开了新窗口(上一窗到点 reset);**这个服务端 reset 事件在本地 JSONL 里零痕迹,反推法结构性看不见它** → 窗口比真实早 2h40m。叠加:`used_tokens` 把 input/output/cache_creation/**cache_read** 四类全加(cache_read 占大头),与服务端 `used_percentage` 口径**根本不是一回事**,绝对数对不上 %。**病根**:权威的 `used_percentage`(5h/7d %)**只存在于 status-line 脚本的 stdin**(`cost-and-pacing.md` §60 仓库自己写明:JSONL 没有);两个制品(带外主线脚本 `cc-usage.sh` + Stop hook `usage-pacing.js`)**都够不到它**,只能反推 → 注定是近似,reset 倒计时可失真到数量级。
- **影响**:**cc-master 钦定的「主动查询用量」工具,在最关键的 reset 倒计时上失真到数量级,且失真未在输出层标注,§62 撞墙预测公式还直接拿这个不可靠的 `window_remaining_min` 当真** → 把 pacing 决策带沟里(本轮活案例:orchestrator 据 21min 误判收口,实际还有近 3h;而真正紧的 **7d 86%** 反被忽略)。这是上一轮已识别「主动查的*时机*是留白」之上更深一层:**连主动查到的*数字本身*都不可信**。同构于本仓「gate-green ≠ passed」红线在 pacing 信号上的破口——一个看似精确的反推值冒充了权威事实。
- **处置**:**用户拍板(非协商):统计口径一律以 Claude Code 订阅账户为准,`usage-pacing.js` + `cc-usage.sh` 两脚本都改**——引入账户权威 `used_percentage`(5h/7d %)作首选信号源、本地反推退为 fallback。**承重技术约束**:权威 `used_percentage` 只在 status-line stdin、两制品都够不到 → 落地**必然需要一个捕获通道**(一个 status-line 脚本在被调用时把 `used_percentage` 落 sidecar,供两脚本读)。**先核实平台语义再动手**(承 [[Finding #30]]/[[Finding #32]]/[[Finding #34]] 铁律:hook/平台语义必须对官方文档端点验收,绝不凭记忆/二手建在未验证假设上)——已派 `claude-code-guide` 核实 status-line stdin 的字段结构 / 是否仅 Pro/Max / 刷新时机 / 能否写 sidecar / 有无别的 hook 事件也带 `rate_limits`。**蒸馏落点(待核实后定稿)**:① `cc-usage.sh`(读 sidecar 优先、反推 fallback、输出显式标注口径与新鲜度);② `usage-pacing.js`(撞墙判据脱钩反推 `window_remaining_min`、改用账户 5h/7d %);③ **新增 status-line 捕获脚本**(须过武装闸 / ship-anywhere 红线审查——它在所有 session 跑,sidecar 写入策略要符合 dormant-until-armed 精神);④ `cost-and-pacing.md`(信号优先级改写:账户 % 权威 > 反推 fallback)。详设计落 `design_docs/plans/`。
  **✅ 落地(本轮)**:核实坐实 status-line 是账户用量的**唯一程序化通道**(API `anthropic-ratelimit-*` 是 tier RPM/ITPM、口径不等价;CLI/transcript/hook stdin 全无);①②④ 全落地、③ `statusline-capture.js` 新建——经核实判定**不需武装闸**(非 hook、不注入/不 block、只缓存账户全局只读信号,红线 6 精神之外,见 ADR-008 §2.2);三脚本搬入 `skills/<s>/scripts/`(见 [[Finding #38]]);决策固化 **ADR-008**;run-tests 全套 + plugin validate 绿。
- **严重度 / 来源**:should-fix(逼近 must:钦定 pacing 工具最关键信号数量级失真 + 误导决策)/ 一手(用户账户权威值当场反证 + orchestrator 误报活案例,本轮)。

## Finding #38 — 既存运行时带外脚本在分发 prose 里裸相对路径,终端用户触不到 ✅已修

- **现象**:盘点 [[Finding #37]] 脚本落点时用户追问「scripts/ 会随 plugin 装吗、该不该放 skill 目录」。排查:`cc-usage.sh`/`codex-review.sh` 这类**运行时**带外脚本,在**分发的** skill/command prose(SKILL.md/cost-and-pacing.md/resume-verify.md/status.md)里全是**裸相对路径** `scripts/xxx`。对比 `hooks.json` 用 `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/xxx`(正确)——带外脚本引用从没用 plugin-root。新加的 `statusline-capture.js` 起初也落顶层 `scripts/`,同隐患。
- **根因**:官方核实(claude-code-guide 查 code.claude.com):plugin 装时整 repo 拷到 cache,但**只保证约定目录**(skills/commands/agents/hooks/bin)随 plugin 可靠分发,顶层自定义 `scripts/` 不在约定范围。且 agent 装 plugin 后 cwd=**用户项目**,prose 里裸 `scripts/cc-usage.sh` 在用户 cwd 解析→**找不到** plugin 安装位置;`${CLAUDE_SKILL_DIR}`/`${CLAUDE_PLUGIN_ROOT}` 在 skill prose 会被替换成绝对路径,官方推荐 `skills/<skill>/scripts/` + 这两个变量。**裸路径在 dev(repo 根 cwd)碰巧能跑→测试/dogfood 都没暴露,真实安装才现形**(同 [[Finding #30]]/[[Finding #32]] 的形态盲区:验不了「装到用户机器后引用解析」)。
- **影响**:终端用户装插件后,orchestrator 按 prose 跑 `scripts/cc-usage.sh` **找不到文件**——一整批运行时脚本(pacing/codex 端点验收)在真实安装下静默失效。`run-tests`/`validate` 全绿也看不见(它们 repo 根跑,裸路径正确)。
- **处置**:**落点二分**(用户拍板「搬 skill 子目录 + 一并清理所有引用」)——运行时脚本(cc-usage/codex-review/statusline-capture)`git mv` 进 `skills/master-orchestrator-guide/scripts/`,分发 prose 改 `${CLAUDE_SKILL_DIR}/scripts/...`(skill 内)/`${CLAUDE_PLUGIN_ROOT}/skills/.../scripts/...`(command 内);**dev-only**(eval-trigger/eval-benchmark/skill-lint)**留顶层** `scripts/`(只 repo 根 dev 调,裸路径正确,改 plugin-root 反而破 dev)。测试路径同步、全套+validate 复绿。固化 **ADR-008** + AGENTS §2 形态图/§3 红线5 卡点。**蒸馏**:分发面(skills/commands) prose 引用脚本一律 `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PLUGIN_ROOT}`,绝不裸相对路径;dev-only 按 repo 根裸路径不变。
- **附带观察(判不回流)**:往 skill 目录加 `scripts/` 子目录后,dev `--plugin-dir` 热加载反复重索引、刷大量重复 `*-skill-<hash>` 注册条目。判**不回流**(非产品 bug:dev 热加载现象,真实安装不重索引,plugin validate 通过)——仅记录,提醒后续动 skill 目录结构时预期此噪声。
- **严重度 / 来源**:should-fix(分发可用性,发布前逮住)/ 一手(用户 review 追问 catch + 官方文档核实)。

## Finding #39 — 接法文档假设 `${CLAUDE_PLUGIN_ROOT}` 在 statusLine.command 展开,但官方未文档化 ✅已修

- **现象**:[[Finding #37]] 落地后写的「接法」文档(cost-and-pacing.md /  ADR-008 / CHANGELOG / statusline-capture.js 注释)让用户把 `statusLine.command` 设为 `${CLAUDE_PLUGIN_ROOT}/skills/.../statusline-capture.js ...`。用户在另一个 session 真去接时这个写法可靠性存疑——若变量不展开,路径错、capture 不跑、sidecar 永不落盘,account 口径永远激活不了(用户那次实测正是 `source:"local-derived-approx"`、sidecar 缺位)。
- **根因**:**把 hooks.json 的事实平移到了一个没核实的字段**。`${CLAUDE_PLUGIN_ROOT}` 在 hooks.json 的 command 字段官方明确支持([[Finding #38]] 据此修引用),但 `statusLine.command` 的变量展开**官方文档未提及**(claude-code-guide 核实:未明确)。更关键:**statusLine 是 user-scoped**(用户全局/项目 settings.json,不绑任何特定 plugin),而 `CLAUDE_PLUGIN_ROOT` 是 **plugin-scoped** 概念——那个上下文很可能根本没定义该变量。即:从 hooks(plugin-scoped、明确支持)外推到 statusLine(user-scoped、未文档化)是一次**未验证的平台语义假设**(同 [[Finding #30]] 反模式:建在没核实的平台行为上)。
- **影响**:接法文档若照原样发布,Pro/Max 用户照抄接 status-line 时**大概率接不上**(变量不展开→路径错→sidecar 不落→account 口径静默失效,只剩反推 approx)——而 account 口径正是 [[Finding #37]] 整个修复的目的。讽刺地:修 #38 时正确地在**被文档化支持**的 skill prose/hooks 上下文用 `${CLAUDE_PLUGIN_ROOT}`,却把同一变量**外推**到了一个未文档化的字段。
- **处置**:**接法改保守 + 诚实标注**——cost-and-pacing.md「接法」段 + statusline-capture.js 注释:① 默认**绝对路径**(dev/`--plugin-dir`=repo 内路径,安装=`~/.claude/plugins/cache/<mp>/cc-master/<ver>/skills/.../statusline-capture.js`);② 显式标注「该字段变量展开官方未文档化」;③ 给**实证步骤**(设变量→渲染一次→看 sidecar 落不落=展不展开),判定权交给能实测的用户。**蒸馏**:平台变量/字段的支持范围**逐字段核实**,别从「字段 A 支持」外推「字段 B 也支持」——尤其跨 scope(plugin-scoped → user-scoped)。**待补实证**:用户那个 session 正在接,一测即可把接法从「绝对路径 + 未知变量」收敛为确定写法。**未来更顺选项**:若 plugin 能自带 statusLine(claude-code-guide 第 3 问亦未明确,待核实),可绕过手改 settings + 变量问题——记为后续探索,非本轮。
- **严重度 / 来源**:should-fix(接法文档准确性,发布前逮住)/ 一手(用户真 session 试接暴露 + 官方文档核实「未明确」)。

## Finding #40 — codex 多轮独立复审揪出 4 轮共 7 个单测看不见的退化路径 bug ✅正向

- **现象**:`--resume` hook 的单测(S1–S24,120 assertions)全绿、指挥亲读每段 diff 也过,但 codex 第二验收者跨 **4 轮**独立复审揪出 **7 个真 bug**,全是单测+作者亲读的共同盲区:round1(3×P2:`inject_ctx` 多行消歧 context 产出非法 JSON / expanded-body `--resume` 落空建 fresh 空板 / freshness 闸误拦刚归档板) → round2(2×P2:空 sid 覆写损坏现有板 owner / heartbeat 从不定龄、mtime 不可用时漏放 force) → round3(P2:heartbeat 解析器拒了 board 示例/活 session 实写的**分钟精度**格式→defeat 安全闸 + P3:命令体裸相对路径) → round4(P3:helpers 红线注释事实错)。
- **根因**:单测断言「子串存在」,**不验**「JSON 合法性 / 退化输入(空 sid、坏 heartbeat) / 跨产物格式一致性(分钟 vs 秒精度)」。happy-path 测试与作者亲读共享同一盲区:都只想到正常输入。codex 作独立非-Claude 端点专攻「作者没想到的契约违背」。
- **影响**:无 codex 多轮复审,7 个会带病合并——其中「空 sid 覆写损坏现有板」(破坏性)、「heartbeat 拒分钟精度→活板被当 abandoned 静默接管」(安全)是真实危害,且全部躲过 120 条单测。
- **处置**:✅正向印证——codex 第二端点验收 + 多轮 needs-attention→Replan→re-review 直到 approve,是本仓 review 纪律的**核心价值**、非冗余。**蒸馏**:退化/边界路径 bug 单测系统性看不见,必须独立端点守;loop 带 fuse(round-3 出新 P2 surface 用户)。回流:已是 SKILL A 红线(「Gate-green≠passed/只信端点验收」)+ AGENTS §7 codex reviewer 的活证据,作正向先例入账,**不新增 prose**(避免双 SSOT)。
- **严重度 / 来源**:✅正向机制验证 / 一手(本次 `--resume` 编排 4 轮 codex 复审实录)。

## Finding #41 — 跨 session bug 报告:另一 agent 凭推断误诊「我的安全闸误建空板」,实为旧缓存代码(实证 > 臆测)✅正向

- **现象**:用户在 omne-next session 试 `--resume`,那边 agent 诊断「bootstrap 因接管安全闸触发误建空板 45857」,当**我的新代码 bug** 报上来(还手写进它的 board log + 把 45857 archive)。
- **根因**:那个 agent **假设新代码在跑**就推断了因果,**没核实**「加载的插件是哪个版本/其 bootstrap 实际有没有 `--resume`」。实测:omne-next 加载的是 marketplace **0.1.0 陈旧缓存**(`grep -c resume_main`=0,根本无 `--resume`),`--resume <sel>` 被当 goal 文本走 fresh 路径**正常**建板。我的新代码 withhold 路径已验证**不建板**(注入警告后 `return 0`+`exit 0`)。
- **影响**:若指挥不实证就信那诊断,会去「修」一个代码里**不存在**的 bug,基于误诊改坏本来正确的代码——经典「信他人结论而非验证」。
- **处置**:✅正向——实证(`claude plugin list`=0.1.0 + grep 缓存 bootstrap `resume_main`=0)直接推翻臆测。**蒸馏**:跨 session/跨环境的 bug 报告,**先核实对方跑的是哪个版本的代码**,别假设新代码已 live;这是「Gate-green≠passed」对 bug 报告的**对偶**——别信他人诊断**结论**,验证它的**地面真相**。呼应 [[never-fabricate-tool-results]] / SKILL A「只信真实 function_result」。回流:作跨 session 诊断的具体先例入账,精神已在 SKILL A。
- **严重度 / 来源**:✅正向(实证纪律)/ 一手(omne-next dogfood 报告 + 指挥实证诊断推翻)。

## Finding #42 — plugin 部署形态盲区:directory marketplace 缓存快照陈旧 + project-scope 覆盖 user-scope ⚠️发版纪律

- **现象**:cc-master 全局注册早已就位(`~/.claude/settings.json` 有 `cc-master@cc-master`+directory marketplace→本仓),但 omne-next 仍加载 **0.1.0**、用不了 `--resume`。
- **根因**:两连环。① **directory-source plugin 的 cache 是安装时快照、非 live link**:装时拷 0.1.0 到 `~/.claude/plugins/cache/.../0.1.0/`,repo marketplace.json 后来到 0.4.2,但**缓存不自动 re-sync**(`marketplace update` 只刷 metadata,要 `plugin install/update` 才真拷新代码)。② **scope 优先级 project>user 非显然**:omne-next 有 project-scope cc-master enable,即便 user scope 装了 0.4.2 也被 project 0.1.0 压住(`plugin list` 同显两条,project 那条生效)。
- **影响**:用户以为「注册到全局就最新」,实被「陈旧缓存 + scope 覆盖」双重卡住;`--resume` 永远用不上,且 **dogfood 在旧代码上跑会误导诊断**(正是 [[Finding #41]] 的上游成因)。
- **处置**:治法——`claude plugin marketplace update` + `claude plugin install cc-master@cc-master --scope user` 刷 0.4.2;**最干净是删项目级 cc-master 配置、纯靠全局 user-scope**(用户提出),一处维护、全项目自动跟版。**蒸馏**:① 发版后**必须刷新全局缓存**(`plugin update`,非仅 `marketplace update`);② 本地 plugin dev 建议**只在 user scope 配一次**、别每项目 project-scope pin。回流:`deliver` 已含「发版后从干净 main 刷新全局缓存」步骤;README 可加一句「directory 安装更新需 `plugin update`」(发版连带)。
- **严重度 / 来源**:should-fix(部署/发版形态,真实安装才现形)/ 一手(omne-next 试用 + 全局注册排查 + scope 实测)。

## Finding #43 — 新命令体写成第三人称 reference 文档而非注入 agent 的 prompt;端点验收漏「命令体当 prompt 品嗓音」一维 ⚠️质量

- **现象**:`handoff-to-new-session.md` 命令体开篇两段是 doc 嗓音——第三人称描述(「由当前正在跑的 orchestrator session 运行」)、被动(「board 被归档」)、外加一整段从 `handoff.md` 重复来的设计哲学说教(「交接的价值恰恰在 board 装不下的东西…」),半天没有一句冲 agent 来的指令。与兄弟普通命令 `status.md`(「读取你的编排 board,渲染…」)/`stop.md`(「列出 home,读取每一块…」)的 imperative 第二人称 task-first 嗓音不一致。run-tests + plugin validate + 自动门 + 红线 + handoff.md 行为 pressure-test **全绿**,靠用户 review「你自己品一品这在 agent 视角自然吗」才现形。
- **根因**:命令体正文本质是**用户敲 `/command` 时注入 agent context 的 prompt**,但作者(和指挥的端点验收)当成了 reference 文档来写/审——把「这命令是什么、为什么」的定义与哲学放进了应当直接下指令的位置。指挥端点验收清单覆盖了内容正确性 / 红线 / self-contain / 甚至 handoff.md 纪律 prose 的行为 pressure-test,**唯独缺「把命令/skill 体当 prompt 读、品它的嗓音是否 imperative 直呼 agent」这一维**——一个只有代入「敲完命令那一刻读到这段的 agent」才察觉的盲区(同 [[Finding #30]]/[[Finding #38]] 的形态盲区家族:自动门全绿、唯独某个真实视角能逮)。
- **影响**:agent 读到的开头是两段说教而非指令,降低指令性;且哲学段与 reference 重复(双 SSOT 雏形,违 [[Finding #7]] 收敛精神)。非功能错(6 步本身是正经 imperative),是**给 agent 的指导质量**问题——正是 charter「给 agent 的指导对不对」该守的。
- **处置**:端点 micro-fixup 就地改(review 暴露、T∞≈T₁、指挥手握确切批评 + 兄弟范本):开篇直呼 agent、task-first、破坏性提醒像 `stop.md` 折进一句、哲学说教下沉回 `handoff.md`;门重跑全绿、amend 进 PR #14。**蒸馏**:① `AGENTS.md` §12 command 约定加一句「命令体正文 = 注入 agent 的 prompt,用 imperative/第二人称/task-first,对齐 status/stop,别写成第三人称 reference」;② 指挥端点验收 + `cc-master-skillsmith` 增一检「命令/skill 体当 prompt 品嗓音」。回流:落 §12(约定 SSOT)+ 本条作先例,不在多处复述。
- **严重度 / 来源**:should-fix(agent-facing 指导质量,自动门全绿唯 review 能逮的形态盲区)/ 一手(本次 handoff 功能 PR #14 用户 review)。

## Finding #44 — board DAG 假串行偏多:反过度串行的承重纪律全住 references、魂里无显式护栏 ⚠️质量 + ✅正向(predict-then-validate)

- **现象**:用户 dogfood 观察到 cc-master 规划出的 board DAG **串行偏多、并行偏少**——本可后台并行的独立任务被挂成链,makespan 被无谓拉长。
- **根因**:反假串行的承重纪律——**float 是免费的并行预算 / 边只能来自真前驱依赖 / 串行并不省 token**——全住在 references(`decomposition.md` / `dispatch.md` / `cost-and-pacing.md`),而**魂 `SKILL.md`(每次 compaction 整篇重注的唯一常驻手册)里无显式表述**。强模型单次决策能从镜头 2/3/5 推导出「默认并行」(**强模型天花板**),但 compaction 后退化 context + 常驻预算压力下推导**不保证**,且无显式护栏接住「假串行边」。更关键的**非对称**:镜头 5「限 WIP / 瞄 75%」+ 常驻预算意识是**常驻**的反并行压力,而反过度串行的纪律却**非常驻**(只在 references)→ 天平系统性倒向串行。
- **影响**:makespan 被拉长;预算压力下 agent 有现成的合理化(「串行省 token」)且无红旗拦截它画出说不出下游消费者的假边。
- **处置**(含蒸馏判定):回流到**魂**——① lens2 加「边即债务 / 默认并行 / 逐边举证」一句;② Rationalization Table 加「窗口紧 / 预算紧 → 串起来省」一行(真相:串行**不省 token**、只拉长 makespan;省预算靠**降档 / 控 WIP / 推迟 float**,不是串行);③ Red Flags 加「画了边却说不出被下游消费的上游产物」一条。`decomposition.md` §2 加**反向指针**(规则 SSOT 在魂、论证 SSOT 在 reference,**勿互抄**,守 [[Finding #7]] 收敛精神);新建 `master-orchestrator-guide/.design/OBJECTIVE.md` 把**并行度**纳入成功契约 J。**Track B 重跑验证**:魂-only 臂从改前「靠推导」变为「**逐字引用三处新规则 + 具名删 4 条假边**」(宽度本就触顶 4,价值不在宽度跃升而在**强模型天花板下的 legibility + 跨 compaction 一致性**)。
- **✅ 正向同权入账**:① **端点验收纪律**——亲跑 `run-tests` 不信 leaf 自报,再次兑现([[Finding #12]] 家族);② **predict-then-validate 抓到我自己的误判**——眼读所下的假设「指导不对称→助长串行」被行为 eval **证伪**:指导被**完整读到**时反而**防住**串行,真缺口在「可达性 / 常驻层」(魂里没有)而**不在内容**(references 里讲得很清楚)。这正是 `grounding-skill-evals` 的 predict-then-validate 防自欺纪律的活样本——眼读直觉错了,行为 eval 纠了它。
- **严重度 / 来源**:中(行为质量,非 correctness)/ 用户 dogfood 观察 + 本会话 Track B 行为 eval。

## Finding #45 — 5h/7d pacing 是单边刹车:杠杆全减速、欠用配额白白蒸发 ⚠️质量(资源利用效率)

- **现象**:5h/7d pacing 是**单边刹车**——所有杠杆都朝**减速**(降模型 / 降 WIP / 推迟 float),目标只有 75% 上限护栏、**无 setpoint**;**欠用**配额时(用量远低于窗口额度)让 5h 窗口的额度**白白蒸发**,进度净浪费。
- **根因**:三层各有缺口。① **认知层** `cost-and-pacing.md` 的杠杆**全是减速**,没有加速侧的镜像;② **hook** `usage-pacing.js` **只在撞墙**(`used%≥85`)才出声、对**欠用全盲**;③ **信号层**账户口径虽给 `used_percentage`,却**不给绝对 token 分母**、**不给权威 burn**(只在可失真的本地反推里有,[[Finding #37]] 已证其失真到数量级)。
- **影响**:同一个**欠 pace 探针**下,两个**有能力**的 agent 会做出**相反决策**(一个加速、一个拒绝)——指导沉默 → 掷硬币。字面读法**系统性**把 agent 推离高效利用;配额**用进废退**,欠用即净浪费进度。
- **处置**(含蒸馏判定):用户拍板 **B②(双侧目标走廊 · 7d 当总闸 + 认知层 + hook 双深度)**。回流:① `cost-and-pacing.md` **重构为双侧**(目标走廊 **70–90%** / 减速侧 3 杠杆 / 加速侧 3 镜像杠杆 / **7d 当硬总闸** / 诚实天花板);② 魂 **lens5 极简双向化**(常驻层既反顶满也反欠用,修 [[Finding #44]] 同源的「单边常驻压力」非对称);③ `usage-pacing.js` 加 `decideAccountUnderuse` **对称提示**(限定**账户口径** / 7d 缺失则**静默** / 本地反推**禁欠用**提示 / **撞墙优先**与欠用互斥);④ `external-coordinates.md` 短语→锚点表**双向同步**;⑤ 新增 **ADR-010** 留痕。**Track B 重跑验证**:欠用 ×2 一致**加速且先过 7d 闸**;**holdout(7d=88%)正确拒绝加速**、让额度蒸发(防过拟合:学的是「过 7d 闸的双侧判断」而**非**「临 reset 一律冲」)。
- **诚实天花板入账**:「reset 时配额精确归零」**做不到**(账户无分母 + 无权威 burn,两量永不同路)——只承诺**方向性双侧逼近**,绝不承诺做不到的控制精度(同 [[Finding #37]] 的诚实标注纪律)。
- **严重度 / 来源**:中-高(直接关系资源利用效率、用户明确诉求)/ 用户提问 + 本会话 Track B 行为 eval。

## Finding #46 — 「标 in_flight 却无真实派发」重复犯:board 标注与真实 Agent 调用脱节,写进 board log 之后仍复发([[Finding #17]] 复发)⚠️高

- **现象**:本场编排(G1 多层 planning + G1.5 分派优化 + G2 文档更新 + 发版)中,orchestrator(我)**两次**把 board task 标 `in_flight`,却**没有实际调用 Agent/Bash 工具派出对应真实进程**——先 `baseline-check`、后 `g2a-impl`。结果是「等待一个不存在的进程」数拍空转,并据此向用户**虚构了进度**。**关键**:第二次发生在第一次已把「教训:标 in_flight 必须对应真实进程」**写进 board log 之后**——纪律落了字,但在压力下没咬住。唯有 `git status` 地面真相能戳穿(board / 自报都「显示在跑」)。
- **根因**:board 状态更新(`Write` board 标 `in_flight`)与真实派发(`Agent` 工具调用拿 handle)是**两个独立动作**;多线程编排 + 每拍 compaction reinject 的压力下,极易「写了 board 标 in_flight、却漏掉那次真实 Agent 调用」。与 [[Finding #17]] **同根**(phantom in_flight:标 board 在前、dispatch 在后被 sibling 完成通知打断致漏派),但 #17 的处置「先 dispatch 再标板」当时只**写进 board log / 待固化**、**未真正回流进魂的可达层**——故本场在「已知教训」下仍复发,证明软纪律 + 一次性 log 不足以拦住它,需进常驻手册的决策程序节点。
- **影响**:① **虚构进度**——违「绝不虚构工具状态/结果」红线([[never-fabricate-tool-results]]),board 与自报都「在跑」、地面真相却为空;② **空等浪费 makespan**——数拍等一个不存在的 worker;③ **误导用户进度汇报**。是 charter「异步并行推进、把目标完整落地」与「token 消耗速度合理前提下最大化实施效率」双双受损的活样本,且为 orchestrator 自身执行 bug(非 plugin bug)。
- **处置(含蒸馏判定)**:**已回流魂(`master-orchestrator-guide`)**——把已知但未真正进可达层的纪律从 board-log 提升为常驻护栏。可达层(魂里要有,不能只在 references)落点:
  - **SKILL.md 决策程序 dispatch 节点(lens 3)**——加硬纪律一句:**dispatch 动作 = 一次真实工具调用(Agent / Bash)并记下它返回的 handle(agentId / shell handle);没有 handle 的 task 不得标 `in_flight`;派发先于 board 标注(先调工具拿 handle、再 `Write` board)**。
  - **SKILL.md 决策程序 recon 节点**——dot-graph 骨架不动(红线 §5),在图后「四件塞不进边的事」散文里加第 **(d)** 条:**recon 时逐个对账每个 `in_flight` 是否都有真实 handle;无 handle 的 `in_flight` 是幽灵任务(phantom),board / 自报都显示「在跑」,唯有 git / 工具结果的地面真相能戳穿**。
  - **Red Flags 表加一行**——「你正要把一个 task 标 `in_flight`,却没有一次刚返回的真实工具 handle 对应它(你在虚构进度)」。
  - **Rationalization Table 加一行**——借口「我 `Write` board 标了 `in_flight` 就等于派了」→ 真相「board 标注 ≠ 真实派发;标 `in_flight` 必须由一次真实工具调用产生 handle,否则是虚构进度——这正是 Finding #17/#46 的病根」。
  - **论证 / 地面真相验证法下沉 `references/dispatch.md` §派发卫生**——为什么软纪律不够(#46 写进 board log 仍复发)、#17 精确复发路径、三步地面真相对账(handle / git status / transcript 皆空 = phantom 立即降级)。守 [[Finding #7]] 收敛:规则 SSOT 在魂、论证 SSOT 在 reference,**未互抄**。
  **TDD-for-skills baseline**:本场 board dogfood **两次**犯错、且第二次在已写 #17 教训进 board log **之后**复发——这是最强的真实失败基线(无需再造合成失败);堵漏后由独立 verify agent 跑 predict-then-validate 确认咬住(定性堵漏;能否回归靠 §8 Track B 定量)。
- **严重度 / 来源**:**高**(虚构进度破红线 + 空等浪费 makespan + 误导用户;且为已写教训后复发,证明现有软纪律不足)/ 一手(本场 board dogfood,`git status` 地面真相戳穿)。

## Finding #47 — done-but-unverified 节点标裸 `uncertain` → Stop hook 每拍噪声;改标 `blocked_on:<verify>` 消噪且语义更准 · 流程

- **现象**:本场出现 done-but-unverified 节点(impl 已完成、产物在盘,其 verify 任务已在飞)。若把它标**裸 `uncertain`**,Stop hook 每拍提醒「resolve uncertain」,持续噪声;改标 `blocked_on:<verify-task-id>` 后,提醒消除、且语义更准——节点不是「我不确定该怎么办」,而是「产物已在、正等一个具名的下游 verify 裁决」。
- **根因**:`uncertain` 与 `blocked_on:<id>` 在「等外部裁决」这一态上语义重叠,但 Stop hook 对裸 `uncertain` 主动提醒、对 `blocked_on:<具名依赖>` 不提醒。done-but-unverified 的本质是「阻塞在具名 verify 上」,用 `blocked_on` 既消噪又把「在等谁」写明确(可被 recon / 续跑读到)。
- **影响**:轻微——纯噪声 + 语义精度,不影响 correctness。但累计每拍提醒会稀释真正待处理的 `uncertain`(信噪比),且裸 `uncertain` 让续跑 / recon 读不出「在等哪个 verify」。
- **处置(含蒸馏判定)**:**已回流 `references/board.md` 的 status enum 说明处**——在 `uncertain` 行后加一段:「**verify 已在飞的 done-but-unverified 节点宜标 `blocked_on:<verify-task-id>` 而非裸 `uncertain`**(产物在、等具名裁决,既消 Stop hook 噪声又写明在等谁;裸 `uncertain` 留给 verify 尚未派出 / 真不确定下一步的态)」。轻量、纯 reference 知识(非红线、非魂可达层)。红线 2(board narrow waist)守住:只动 board.md 的**散文说明**,不动 narrow-waist schema 字段本身。
- **严重度 / 来源**:低(流程 / 噪声)/ 一手(本场 board dogfood)。

## Finding #48 — 独立验收节点 + A/B pressure baseline 范式有效:G1/G1.5 各派独立 verify 清晰证明指导咬住行为 ✅正向

- **现象**:本场 G1(多层次 planning 心智)、G1.5(分派机制优化)各派**独立 verify sub-agent**(读 diff + 跑 A/B pressure baseline + 独立 `run-tests`),清晰证明指导咬住了行为:
  - **G1**:A/B baseline 中 **B 组(有指导)明确「先发现并遵循*被编排项目自己*的规范」**、A 组(无指导)缺失该步——证明「多层 planning」指导在压力下真改变了编排者行为;
  - **G1.5**:O-1 护栏在 SKILL A **可达层**独立加固,verify 证明它进了常驻手册而非只在 references。
  「gate-green≠passed」+ TDD-for-skills(A/B pressure baseline)+ 独立端点验收三者**合力有效**——指导不是写了就算,是被独立 verify 节点实证咬住行为。
- **根因(机制成功)**:把验收做成**独立节点**(而非作者自读),并用 **A/B pressure baseline** 把「指导有没有用」从主观判断变成「B 组逐字引用新规则 / A 组缺失」的可观测对比。这正是 [[Finding #44]] predict-then-validate 防自欺纪律 + §8 Track B 行为 eval 的范式在本场的再次兑现。
- **影响**:正向——本场为「独立验收 + A/B baseline」范式又添一组活证据,与 [[Finding #14]](goal-hook 自验)/[[Finding #19]](codex 逮自身修复残漏)/[[Finding #40]](codex 多轮逮退化 bug)同族:验收纪律不是冗余,是指导质量的守门人。
- **处置(含蒸馏判定)**:**正向先例,确认现有纪律有效;判定不新增 prose**——「独立端点验收 / gate-green≠passed」已是 SKILL A 红线、TDD-for-skills 已是 [[`.claude/skills/cc-master-skillsmith/SKILL.md`]] 纪律,再写会造双 SSOT(违 [[Finding #7]] 收敛)。定稿判定:**作 Rationalization Table / 红线的正向素材登记**(与 #14/#19/#40 同列),**不新增 prose**。可作 README/demo「眼见为实」说服素材。
- **严重度 / 来源**:✅正向(机制验证)/ 一手(本场 G1/G1.5 独立 verify 实录)。

## Finding #49 — pacing 加速侧 reasoning 对、却被 [[Finding #46]] 拖成「虚假加速」(并入 #46,同根)· 中

- **现象**:本场账户欠用信号(5h 仅 49%、临近 reset)**正确触发了镜头 5 加速侧 reasoning**——orchestrator 拆出 G2 独立落差、想提前并行以利用本配额窗口(正是 [[Finding #45]] 双侧走廊修复后期望的加速侧行为)。**但**那个「提前派」的 `g2a` 因 [[Finding #46]] 根本**没派出**(标了 `in_flight` 却无真实 Agent 调用),加速**从未兑现**,反而制造了「已加速」的假象。
- **根因**:加速侧**识别本身正确**(镜头 5 lever 用对了,#45 的双侧化在起作用);真正的脱节在 [[Finding #46]]——**「标 in_flight」被当成了「已派发/已加速」的证据**,而二者脱节。即:pacing 的**决策**对了(该加速、且选对了要提前的独立落差),但**执行**因 #46 的派发-标注脱节而落空,且因 board「显示在跑」而误以为已兑现。
- **影响**:中——双重损失:① 本该利用的欠用配额窗口**没真正利用**(加速落空);② 更隐蔽地**制造「已加速」假象**,叠加 #46 的虚构进度,让 orchestrator 与用户都以为配额在被高效消耗。直接削弱 [[Finding #45]] 双侧 pacing 修复的实际收益——杠杆用对了,但执行层漏掉真派发,等于白用对。
- **处置(含蒸馏判定)**:本条**佐证 [[Finding #46]] 的回流必要性**——pacing 加速决策无论多正确,只要 #46 的「标注≠派发」脱节存在,加速就只停在 board 字面、不落地。**定稿判定:并入 #46**(同根)——加速侧识别本身正确(#45 已落地、用对了)**不需回流**,需回流的是 #46 的派发纪律(已落 SKILL.md dispatch/recon 节点 + Red Flag + Rationalization Table)。本条作为「加速侧也受害」的影响补充强化 #46 的必要性,保留独特视角「pacing 修复的收益依赖派发纪律先成立」,**不另开新回流点**。
- **严重度 / 来源**:中(与 #46 同根;削弱 #45 pacing 修复的实际收益)/ 一手(本场 board dogfood)。

## Finding #50 — 跨 skill 引用裸相对路径 + §12 CI grep 盲区:codex 第二验收 flag 的 install-safety 灰区 ✅已在 v0.5.1 处置(①②都做)

- **现象**:codex 第二端点验收对 G1+G1.5 diff 给出 `needs-attention`,其中一条 flag:`references/dispatch.md`(line 37 等)在跨 skill 引用 `authoring-workflows/…` 时用的是**裸相对路径**(`authoring-workflows/...`),而非 §12 红线要求的 `${CLAUDE_PLUGIN_ROOT}/skills/authoring-workflows/...` 绝对形式。codex 把它判为 **install-safety 灰区**:装到用户机器后,裸相对路径相对其 cwd 解析,理论上可能不可解析→死链。
- **根因**:AGENTS.md §12 红线**散文**确实要求「分发 skill 间引用走 `${CLAUDE_PLUGIN_ROOT}` 绝对形式」,但 §12 的 **CI 硬卡点 grep**(`design_docs|adrs/[A-Z]|\]\(\.\.|hooks/scripts|README\.md`)**不覆盖**裸 `authoring-workflows/…` 这一模式——**grep 盲区**:散文规则与可执行卡点之间有缺口,该模式靠人审而非 CI 拦。且这是 `dispatch.md` 的**既有约定**(line 37 等存量引用),**非本次 G1+G1.5 新引入**——是全 skill 范围的存量债。
- **影响**:理论 install 死链风险(裸相对路径在用户 cwd 下找不到 plugin 安装位置——与 [[Finding #38]] 同形态盲区);但 codex 自评削弱本条信号:① CI grep 对本 diff **全绿**(该模式不在 grep 覆盖内);② 属概念性指针援引(§12 有「概念性提及 / 叙事性引用可留」carve-out,这类跨 skill 指引更接近指针而非可执行文件引用);③ 是**全 skill 范围存量债**,非本 diff 新债。三点叠加把它从「必修」降为「灰区登记」。
- **处置(含蒸馏判定)**:本条最初**判本 board 不修**(避免单点修复制造全仓引用形式不一致),留两候选;**v0.5.1 把两候选都做了**:① **§12 grep 盲区接进可执行卡点**——`scripts/skill-lint.sh` 新增 **check (4)**,扫 `skills/`/`commands/`/`hooks/` 下 `.md`,捕获反引号包裹、以兄弟分发 skill 名(`authoring-workflows`/`master-orchestrator-guide`)开头带 `/` 且未用 `${CLAUDE_*}` 的裸引用,命中即 `exit 1`;`AGENTS.md §12` 已同步文档化该卡点。**有意剔除 `scripts/` 分支**(否则会误报 DESIGN.md 对 dev-only repo 根脚本的合法引用·红线 5)。**check(4) 本身还经 codex round-2 逮到一个 false-negative**:初版用「整行含 `CLAUDE_` 即跳过」防误报修正形式,但同一行若既有修正形式又有残留裸引用会被整行漏放;改为**逐 token 匹配 + 删掉整行跳过**(正则反引号锚定已天然排除 `${CLAUDE_*}/…` 修正形式、不需整行跳过),端到端验证混合行裸引用被抓。**codex round-3 进一步逮到同一缺陷的文档落点**:§12 文档化的那条 grep 仍带 `| grep -v CLAUDE_` 行级过滤(round-2 只改了可执行 check、漏改 SSOT 文档),已同步删除——**可执行卡点与文档 SSOT 现一致**(均逐 token、无行级过滤)。二次教训:**修一个逻辑缺陷要查它在「代码 + 文档 SSOT」的所有落点**,别只改可执行的一处留文档漏改。② **全仓裸跨 skill 引用统一升级 `${CLAUDE_PLUGIN_ROOT}`**——`references/dispatch.md` 的 3 处裸引用(line 37 两处 `authoring-workflows/references/mechanism.md` + line 59 `authoring-workflows/SKILL.md`)全升级为 `${CLAUDE_PLUGIN_ROOT}/skills/authoring-workflows/…` 绝对形式。**蒸馏判定**:散文规则 → 可执行卡点(check (4))闭环堵盲区;本条**仍不回流任何 skill body**(检查在 dev-only 的 `skill-lint.sh`,符合红线 5 落点二分)。与 [[Finding #38]]/[[Finding #39]] 同族(真实安装才现形的形态盲区),区别是本条把「人审拦」升级为「CI 拦」。
- **严重度 / 来源**:低(P2 灰区,v0.5.1 闭环)/ 本 board codex 第二验收。

## Finding #51 — codex 当第二端点验收者的价值兑现:抓到 Claude 独立验收 + pressure baseline 都漏的 2 条 P2 文档契约问题 ✅正向

- **现象**:本场对 G1+G1.5 在定稿后**提前**派出 `codex` 做第二端点验收(非-Claude 视角),verdict=`needs-attention`,抓到 Claude 自身独立验收(g1-verify / g15-verify 均 `approve`)+ 多轮 pressure baseline **都没抓到**的 **2 条 P2 文档契约问题**:① `OBJECTIVE.md` 的 `strict_dims` 超出 schema 规定的 1–2 上限;② 跨 skill 引用裸相对路径([[Finding #50]])。
- **根因(机制成功)**:codex 是**非-Claude 视角**,与 Claude 验收结论的**分歧 = 高信号**(呼应 AGENTS.md §7/§8「codex 当第二评委」范式——Claude 全 approve、codex needs-attention 的分歧恰是值得查的盲区)。且本次由 pacing **加速侧**正当触发:本场账户欠用([[Finding #49]] 同场的 5h 仅 49% 信号),利用配额窗口**提前**跑 endpoint 的 codex 部分,是 [[Finding #45]] 双侧走廊修复后期望的加速侧行为的一次**正确兑现**(与 #49 不同——这次加速真落地了)。
- **影响**:正向——Finding ①(`strict_dims` 超 1–2 schema 上限)得以在**发版前**及时**端点折叠修复**,避免带病的超-schema J(成功契约)发版;Finding ②([[Finding #50]])经评估判本 board 不修、留后续。两条都是 Claude 独立验收 + pressure baseline 这两道既有关卡**穿透**后才被 codex 第二端点逮到——再次印证第二验收者不是冗余。
- **处置(含蒸馏判定)**:**正向登记**,确认「codex 当第二端点验收者」范式有效(与 [[Finding #48]] 独立验收范式、[[Finding #40]]/[[Finding #19]] codex 逮退化 bug 同族)。**判定不新增 prose**——该范式已在 AGENTS.md §7/§8 + [[`skills/master-orchestrator-guide/references/resume-verify.md`]](codex 第二验收者小节)文档化,再写会造双 SSOT(违 [[Finding #7]] 收敛纪律)。定稿判定:**仅作正向素材入账**(与 #14/#19/#40/#48 同列),不新增 prose。
- **严重度 / 来源**:✅正向(机制验证)/ 本 board(G1+G1.5 codex 第二端点验收实录)。

## Finding #52 — 测试 temp-dir 泄漏致偶发 flaky:resume helper 临时目录从不清理,`$TMPDIR` 累积膨胀压垮 `mktemp` ✅已在 v0.5.1 修 + 隔离设计经 80+ 次压测验证过硬

- **现象**:`tests/hooks/test_bootstrap-board.sh` 偶发红——但**新 checkout 怎么也复现不出**(80+ 次含并发全绿),只在**本机这类已用久的脏环境**偶发。`run-tests.sh` 同一套断言时绿时红,无可稳定复现的触发条件。本机 `${TMPDIR:-/tmp}` 下累积了 **4016 个** `.tmp-ccm.*` 残留目录。
- **根因**:`test_bootstrap-board.sh` 的 `run_resume` / `run_resume_nosid` 两个 helper 内联调用 `make_project` 建临时项目目录,但**从不 `rm -rf`** 它们——每轮测试泄漏 ~44 个 `.tmp-ccm.*` 目录到 `$TMPDIR`。久跑本机累积到 4016 个 → `$TMPDIR` 膨胀 → `mktemp` **偶发失败** → 返回空 `$H`(home 路径) → board 操作打到错误路径 → 断言**偶发红**。这正解释了「新 checkout 复现不出(干净 `$TMPDIR`)、脏机器偶发(膨胀的 `$TMPDIR`)」的诡异表现——根因不在被测逻辑、不在隔离设计,而在**测试自身的资源泄漏**慢性压垮了 `mktemp`。
- **影响**:中——偶发 flaky 直接侵蚀对测试套件的信任(红了不知是真退化还是 flaky,逼人重跑、掩盖真问题);且泄漏是**单调累积**的,不修则脏环境越久越频繁红。但**隔离设计本身没问题**——`test_bootstrap-board.sh` 的 per-test 临时目录隔离经 80+ 次(含并发)压测全绿复现不出 flaky,问题纯在「建了不收」的清理缺口。
- **处置(含蒸馏判定)**:**已在 v0.5.1 从源头封堵**,回流落点二处(均 `tests/` source,非 prose):① **两 helper 补清理**——`run_resume` / `run_resume_nosid` 给内联 `make_project` 的返回目录补 capture + `rm -rf`,源头不再泄漏;② **套件级兜底清扫(age-filtered)**——`run-tests.sh` 加 `sweep_ccm_tmp()`(startup + `trap EXIT`),用 `find … -mmin +60` **只删 stale(mtime >60min)残留**,清掉历史累积的 4016 个。**这里有个关键二次教训(codex 第二端点逮到)**:初版 sweep 用 `rm -rf ${TMPDIR}/.tmp-ccm.*` **全局删共享前缀**——codex round-1 验收 flag 为 P2:会**误删并发 `run-tests.sh` 的 active `CC_MASTER_HOME`**(一个 run 的 startup sweep / 另一 run 的 EXIT trap 会在第三方 run 测试中途删它的活动临时目录 → **重引入 flaky**)。讽刺的是 flaky 排查本身就用并发跑套件测隔离,而修复却引入并发 footgun;orchestrator + fix-flaky agent + orchestrator 端点验收**全漏**——因验证都是顺序跑、或加 sweep **前**的并发跑,没在加 sweep **后**跑并发。改 **age-filter** 后:并发 run 的 fresh 目录(<60min)绝不被碰、stale backlog 仍清。**验证**:age-filter 单元逻辑(old 删/fresh 留) + **并发 ×3 全绿** + 顺序全绿、泄漏恒 0。**二次教训蒸馏**:防御性「全局清扫共享命名空间」是并发 footgun——清扫务必 age-filter 或限本进程 owned root;且**任何会改变并发行为的 fix,验证必须覆盖并发场景**(顺序绿 ≠ 并发安全)。codex 第二端点价值第 3 次兑现(同 [[Finding #50]]/[[Finding #51]]),不另开 prose(§7 范式已文档化·[[Finding #7]] 收敛纪律)。**蒸馏判定**:本条是「用着不爽 / 效率没真正拉满必落台账」的正例,且**隔离设计经 80+ 次含并发压测验证过硬**这一**成功机制**与失败同权入账(与 [[Finding #14]]/[[Finding #40]]/[[Finding #48]] 正向素材同列)——不要因为「flaky」就误判隔离设计有缺陷而去重构它,根因是清理缺口而非隔离机制。**(b)tests 硬依赖 `python3`**(`test_usage-pacing.sh` / `test_cc-usage.sh` / `test_statusline-capture.sh`)**判不修**——红线 1 只禁 **`hooks/`** 用 `python`(ship-anywhere 约束面),**tests 允许**(dev-only,跑测试的开发机有 python3 是合理假设);这属**环境脆性**(无 python3 的开发机跑不了那 3 个测试)而非隔离问题,作**已知可接受脆性登记**,不回流任何 source。
- **严重度 / 来源**:中(隔离脆性·偶发 flaky·单调累积)/ 本 board(flaky 隔离性根因诊断)。隔离设计经 80+ 次压测验证 ✅正向。

## Finding #53 — watchdog 自我唤醒(ADR-011)全生命周期 dogfood 跑通:arm → harness 主路径接管 → recon → CronDelete ✅正向

- **现象**:本场(`feat/idle-self-wakeup` → 0.6.0)实现 watchdog 自我唤醒后,orchestrator(我)在派出 **3 个 file-disjoint 实现 agent**(标 `in_flight`)、走决策程序 `wait` 边之前,按新设计的触发条件(§1.4:剩余 path 中存在 blocked 在 in_flight 后台任务上的等待)**arm 了一个 CronCreate 一次性 watchdog**(`recurring:false durable:false`,本地 session 内存调度、ship-anywhere OK、只在 REPL idle 时 fire),给"静默失败盲区"(后台 agent hang 死 / 静默死 / 幽灵任务 [[Finding #17]]/[[Finding #46]])兜底;并把"被唤醒后要 recon 什么"写进 `board.wakeup.checklist`(§1.3 双层记录的**实质层**——board 持久、扛 compaction;wakeup prompt 只是易朽指针)。**实际走向**:3 个 agent 经 **harness 自动重唤起**(正常完成的免费主路径)逐个正常完成、被端点验收咬住,watchdog **从未需要 fire**(正是它作为"安全网层叠于主路径之上、非替换"的预期行为);处置完后 **CronDelete 清掉待发 job**(§1.2 重唤起处置完清理,免重复 fire)。**arm → harness 主路径接管 → recon → CronDelete 全生命周期端到端跑通**。
- **根因(机制成功)**:ADR-011 的核心设计——① watchdog = 安全网而非替换(harness 自动重唤起仍是正常完成的主路径,免费、事件驱动);② 双层记录(实质=board.wakeup、指针=wakeup prompt)让 compaction 后即便 prompt 没了,board 的 `wakeup.checklist` 仍供 recon 料;③ CronCreate `recurring:false durable:false` 本地调度不需 claude.ai OAuth(与被排除的 `/schedule` 云 routines 区分),守 ship-anywhere——**三者在真实 dogfood 中各自兑现**。这是"边造边用"(本场刚实现的能力,在同一会话里被实现编排自身用上)的活样本。
- **影响**:正向——**验证 ADR-011 设计端到端可落地**(非纸面):arm 的触发判定、双层记录、harness 主路径优先、CronDelete 清理四环全跑通,且 watchdog 正确地"在场但未 fire"(主路径覆盖了正常完成,安全网只补盲区)。是 charter ①"异步并行多线程推进、把目标完整落地"在"长等待窗口不漏静默失败"维度的落地证据;与 [[Finding #14]](goal-hook 自验)/[[Finding #48]](独立验收范式)同族——机制在真实运行中兑现设计价值。
- **处置(含蒸馏判定)**:**正向先例,本身即 ADR-011 + 本轮 skill prose(Agent B 落 `async-hitl.md` 的"等待前 arm watchdog"心智 + `dispatch.md` 派发卫生的 liveness 维度)的活证据**。蒸馏判定:**加一句"边造边用"注脚到 `references/async-hitl.md` 的 watchdog 小节**——标注"ADR-011 watchdog 自我唤醒已在 `feat/idle-self-wakeup` 实现会话自身 dogfood 跑通全生命周期(arm→harness 主路径接管→CronDelete),watchdog 正确地在场未 fire(安全网层叠于主路径之上)",作为该 prose 的真实落地锚(轻量一句、不展开,守 [[Finding #7]] 收敛——不在台账与 reference 间复述设计细节)。**不另开红线 / Rationalization 行**(机制成功非判断缺口,同 [[Finding #26]] 防造纪律)。注:此注脚是否值得加由 Agent B / 后续收口者定——若 `async-hitl.md` 已有充分的 live 落地表述则判**不回流**(避免双 SSOT),本条仅作正向素材入账即足。
- **严重度 / 来源**:✅正向(机制验证·ADR-011 端到端可落地)/ 一手(本场 `feat/idle-self-wakeup` 实现会话自身 dogfood)。

## Finding #54 — gate-green ≠ passed 活体复现:`board.example.json` 加 `wakeup` 软字段后 node 段 `fail 0` 但整体 `TESTS FAILED` · 低(测试纪律)

- **现象**:本场为给新加的 `wakeup` 软字段做示例,往**分发的** `assets/board.example.json`(starter fixture)加了 `wakeup` 对象,跑 `run-tests.sh` 时 **node content 段显示 `fail 0`**(content 结构断言全过),但**整体以 `TESTS FAILED` 收尾**——若只盯着 content 段那行 `fail 0`、不读整体结果行,会误以为"加 fixture 安全"。根因排查指向 `board.example.json` 与 `board.template.json` 之间的 **parity / schema 校验约束**:给 example 加可选 situational 软字段(`wakeup`)撞了二者间的一致性断言。
- **根因**:① **测试纪律层**——`run-tests.sh` 是多段编排(hook bash 断言 + node content),**某一段 `fail 0` / exit 0 不代表整体绿**,权威信号是**整体结果行**(`ALL TESTS PASSED` vs `TESTS FAILED`),这正是 [[Finding #12]]"各子集绿≠全绿" + AGENTS §10"读整体结果行"纪律的又一活体复现;② **fixture 设计层**——`board.example.json`(starter fixture,装插件用户照抄的最小起步板)与 `board.template.json` 间有 parity/schema 约束,**可选 situational 软字段(`wakeup`)本不该进 starter fixture**——starter 该是最小乖形态,`wakeup` 是"合法等待 + 有可能静默失败的 in_flight"才出现的情境字段,它的 demo 该放 `references/board.md` 的 **inline 示例**(讲该字段语义处),不该污染所有用户照抄的起步板。
- **影响**:轻微——纯测试纪律 + fixture 卫生,不影响 correctness(`wakeup` 是 soft-observed 柔性边,hook 缺则 graceful-degrade)。但若误读 `fail 0` 当 passed,会带着红的整体套件"以为完成"(典型 gate-green≠passed 陷阱);且 situational 软字段进 starter fixture 会给所有用户的起步板塞进一个他们当下用不到的字段,损 fixture 的"最小乖形态"语义。
- **处置(含蒸馏判定)**:① 即时应对——**回退 `board.example.json` 的 `wakeup` 改动**,`wakeup` 的 demo 由 `references/board.md` 的 inline 示例承载(§2.2/§2.3 Agent B 域已文档化该柔性边),整体套件回绿。② **蒸馏判定 = 回流 `references/board.md` 的 fixture-vs-inline 分工说明**——加一句轻量纪律:「**可选 / situational 软字段(如 `wakeup`)的 demo 放本文 inline 示例处,不进 `board.example.json` starter fixture**(starter 须保持最小乖形态;example↔template 间有 parity/schema 约束,加可选软字段会撞测试)」;**"读整体结果行而非某段 `fail 0`"复用既有 AGENTS §10 测试纪律**(已是 [[Finding #12]] 沉淀的纪律,不另造 SSOT,守 [[Finding #7]] 收敛)。红线 2(narrow waist)守住:只动 `board.md` 散文 + 回退一个 fixture,不动硬 waist schema。
- **严重度 / 来源**:低(测试纪律 · fixture 卫生)/ 一手(本场加 `wakeup` 示例时撞上)。

## Finding #55 — 三层 file-disjoint 并行 + 实现契约锁共享常量 + TDD-for-skills baseline RED 全 held ✅正向

- **现象**:本场把 watchdog 自我唤醒拆成**三层 file-disjoint 并行**(Agent A 决策记录层 ADR + 红线修订 / Agent B 行为 prose 层 skill + board.md / Agent C hook 牙齿层 verify-board.sh + 测试),用一份**实现契约**(`design_docs/plans/idle-self-wakeup-impl-contract.md`,临时 gitignored)当**总谱 / 单一真相源**锁定三 agent 必须逐字一致的**共享常量**(canonical hook 注入短语 `"arm a watchdog wakeup"` / `wakeup` schema 字段 / mechanism enum `cron|loop|monitor|shell` / ADR 编号 ADR-011)。两处机制各自兑现:
  - **三层零越界 + 接缝逐字一致**:三 agent 严格按契约 §3 的 file-disjoint 划分各改各域,**零互相覆盖**;端点用 `grep` 验跨层接缝(hook 注入短语 ↔ prose 锚点 ↔ external-coordinates 映射表),共享常量**逐字一致**(契约锁定的 canonical 短语在 hook / prose / 坐标表三处对齐)。
  - **TDD-for-skills baseline RED 三边界全 held**:Agent B 按 §6 强制先跑 pressure baseline——证明"没有该 prose 时,空转的 orchestrator 面对可能静默失败的 in_flight 会直接停/等而不 arm watchdog";实测在三个边界场景**baseline 全 held**(强模型从既有镜头能推出部分正确行为,**强模型天花板**),故**诚实不造 red-flag 行**(同 [[Finding #26]] 防造纪律——baseline 不失败就不编造 agent 不会违反的红线)。
- **根因(机制成功)**:① **multi-layer-planning + 实现契约当总谱**——把"被编排目标自己的 planning 规范"(此处=本仓的 ADR/skill/hook 三层分工 + 共享常量)写成 file-disjoint 域 + 逐字锁定的常量,让三个并行 agent 无共享状态也能接缝一致(`references/multi-layer-planning.md` 范式的兑现);② **§6 TDD-for-skills 防造**——baseline 是定性闸(哪条 rationalization 要堵),RED 全 held 时正确的处置是"不写堵漏 prose"而非"硬造一条红线"(否则稀释 reinject 每次全文重注的魂)。
- **影响**:正向——本场为 charter ①(异步并行多线程推进)+ ⑤(资源消耗合理前提下最大化实施效率)的**并行编排范式**添一组活证据:三层 file-disjoint + 契约锁常量 = 真并行(无串行依赖)且接缝可 grep 验证;与 [[Finding #12]](并行后端点必跑全套)、[[Finding #26]](TDD-for-skills 防造)同族。
- **处置(含蒸馏判定)**:**正向先例,判不新增 prose**——① "file-disjoint 并行 + 共享常量锁定"范式已在 `references/multi-layer-planning.md` + `references/dispatch.md`(两尺度 dataflow / 反过度工程护栏)文档化;② "baseline RED held → 不造红旗"已是 [[Finding #26]] 沉淀的 §6 TDD-for-skills 防造纪律 + `cc-master-skillsmith` body。再写会造双 SSOT(违 [[Finding #7]] 收敛)。定稿判定:**仅作正向素材入账**(与 #14/#26/#48 同列),不新增 prose。可作 README/demo"真并行 + 防造红线"的说服素材。
- **严重度 / 来源**:✅正向(机制验证·过程亮点)/ 一手(本场 watchdog 自我唤醒三层并行实现实录)。

## Finding #56 — codex(非-Claude 第二验收者)抓到 watchdog(v0.6.0)2 个真问题,而我们自己的充分验收全漏 ✅正向(机制验证)+ 2 should-fix 已修

- **现象**:watchdog 自我唤醒(v0.6.0,已 commit `c87dc5b`)过了**我们自己的充分验收**——读全 diff + 全套 `run-tests.sh` 绿 + 三层(hook 注入短语 ↔ prose 锚点 ↔ external-coordinates 映射表)一致性 grep 全过——判"done"。随后跑 **codex(第二端点验收者)对同一 diff** 复审,抓到 **2 个真问题**(都验证为真):
  - **[P2] 退役 watchdog 只 CronDelete job、漏清 `board.wakeup` 对象 → 陈旧残骸重开静默失败盲区**:verify-board hook 对 `wakeup` 是 **soft-observed(present = armed)**——见任何 root `wakeup` 对象就当"已 armed"、**静默不提醒**。但当时的清理指导只说"CronDelete 那个 job"、**没说从 board 移除 `wakeup` 对象**。于是 watchdog fire / CronDelete 后,陈旧 `wakeup` 对象残留 → 下一次"有可能静默失败的 in_flight"等待时 hook(与 compaction 后的 orchestrator)**误判仍有 watchdog armed**、静默掉本该发出的提醒 → **重开本功能要堵的静默失败盲区**。**活体已复现**:orchestrator 的 board 真留过一个"CronDelete 了 job 却没清 `wakeup` 对象"的陈旧记录。
  - **[P3] DESIGN.md ship-anywhere 不变式与 ADR-011 失同步**:`skills/master-orchestrator-guide/.design/DESIGN.md` 的 fitness 不变量段仍写"ship-anywhere 后台机制只限 shell / sub-agent / workflow → 决策程序不引入 agent-teams / scheduled routines 依赖"——与 ADR-011 矛盾(watchdog **确实**引入了本地 timer primitives:`ScheduleWakeup` / `CronCreate`)。
- **根因**:① **验收盲区(本条核心)**——我们三种自验手段(读全 diff / 全套测试绿 / 三层一致性 grep)各有结构盲区:diff review 看的是"改了什么"非"漏改什么"(陈旧 `wakeup` 是一条**缺失的清理纪律**、不在任何 diff 行里);全套测试只保 correctness 不保 quality(指导对不对、生命周期完不完整,见 AGENTS §10——`run-tests.sh` 回答"语义合不合 contract",答不了"清理纪律齐不齐");三层一致性 grep 验的是"已写的三层逐字一致"、抓不到"某层根本没写到清理这一步"。三者**对"缺失的纪律 / 跨 ADR-DESIGN 失同步"这类补集型缺口共同失明**。② **stale-wakeup 生命周期教训**——soft-observed(present = armed)的字段,其退役**必须把字段本身清掉**才算退役完整:留陈旧残骸 = 一面骗 hook 与未来自己"还在守着"的假旗。arm 那一半写得很全(双层记录 / 触发条件 / 工具降级链),退役那一半只写了 CronDelete job、漏了对称的"删 `wakeup` 对象"——**生命周期 arm/退役两端不对称**是病根。
- **影响**:**正向**——坐实 **codex-as-second-verifier 设计的价值**(AGENTS §7):非-Claude 端点验收者抓到 Claude 自己充分验收(读全 diff + 全套测试绿 + 三层一致性 grep)**全漏**的真问题,与 [[Finding #19]]/[[Finding #21]]/[[Finding #22]]/[[Finding #27]]/[[Finding #40]]/[[Finding #51]] 同族(codex 多轮逮单测 / 自验看不见的退化路径与文档契约缺口)。这是"分歧 = 高信号"在**清理纪律 / 跨文件失同步**维度的又一活证据——尤其 P2 是一条**会真重开盲区**的纪律缺口,不是纸面瑕疵。
- **处置(含蒸馏判定)**:**已修 2 条**——
  - **P2(回流 prose)**:`references/async-hitl.md` §"被唤醒后——退役 watchdog(两件一起做)" + `references/board.md` `wakeup` 字段文档 + `ADR-011` §2.2/§3.2,**明确且醒目地写**:**退役 watchdog = CronDelete job **且** 从 board 移除 / 清空 `wakeup` 对象(两件一起做,缺一不可)**,点破陈旧记录风险(残留 `wakeup` 让 hook 与 agent 误判仍 armed、对下一次 in_flight 等待静默掉提醒 → 重开盲区),强调**不变式:当前无 watchdog armed 时 `board.wakeup` 必须 ABSENT**。
  - **P3(改 DESIGN.md)**:`DESIGN.md` 该行**区分**两层:① 后台**派发机制**仍只 shell / sub-agent / workflow(不变);② **watchdog timer 例外**(ADR-011:本地 `ScheduleWakeup` / `CronCreate` 许可用于自我唤醒补盲区,云 routines / agent-teams 仍排除,background-shell 仍 floor),措辞与 AGENTS §3 新红线 5 对齐 + 交叉引用 ADR-011。
  - **蒸馏判定**:P2/P3 都是**已落地的具体回流**(prose + ADR + DESIGN);本条**不另开红线 / Rationalization 行**(验收盲区的纪律已是 AGENTS §7 codex 第二验收者 + §10"测试只保 correctness 不保 quality" + Finding #12"端点必跑全套"的既有沉淀,再写造双 SSOT,守 [[Finding #7]] 收敛)。
- **未来 hardening(本次不做,标 0.6.x 候选,teeth>discipline)**:**hook 端 self-heal——`verify-board.sh` 把 `fire_at` 已过期的 `wakeup` 视为陈旧**(即使 agent 忘清 `wakeup` 对象,hook 也能自愈、照常提醒"arm a watchdog")。
  - **为什么值得做**:本条的 P2 修法是**纪律型**(靠 prose 教 agent 退役时清 `wakeup`)——而 cc-master 的 ethos 是 **teeth > discipline**(确定性 hook 牙齿优于靠 agent 自律的软纪律)。陈旧 `wakeup` 残留正是"agent 忘了执行一条清理纪律"的典型失败面;给 hook 一道 self-heal 闸,即便纪律被忘也能兜底自愈,把这条盲区从"靠 prose 守"升级为"hook 牙齿守"。
  - **实现要点(portable,守红线 1)**:verify-board.sh 读 `wakeup.fire_at`,与当前 UTC 时间比——`fire_at` 已过期(过去)= 这个 watchdog 已 fire 过且没被清,视为陈旧 → **当作"无 armed wakeup"照常注入提醒**(self-heal:陈旧残骸不再骗 hook)。比较法用 **ISO-8601-UTC 字典序比较**(`date -u +%Y-%m-%dT%H:%M:%SZ` 取 now,与 `fire_at` 字符串直接 `[[ "$fire_at" < "$now" ]]` 比),**无需解析时间、portable、纯 bash**(守红线 1:不引 jq/python;不需 node)。
  - **它需要的格式要求**:`fire_at` **必须是严格 ISO-8601 UTC 同格式**(`YYYY-MM-DDTHH:MM:SSZ`,固定宽度、Z 结尾、无偏移),字典序才等价于时间序;现行 schema 示例 `"fire_at": "<iso>"` / `"13:15Z"` 须收紧为这个固定格式(否则字典序比较失真)。这是该 hardening 的**前置依赖**——做它时一并把 `wakeup.fire_at` 格式在 `board.md` schema 里钉成 strict ISO-8601-UTC。
  - **范围**:仍是 soft-observed 柔性边读法(present 但**未过期** = armed → 静默;present 但**已过期** = 陈旧 → 提醒;absent = 提醒),不动硬 waist(红线 2),武装闸不变(红线 6)。**本次不做,登记为 0.6.x 候选待排**。
- **严重度 / 来源**:✅正向(机制验证·codex 第二验收者价值)+ 2 should-fix(P2 逼近 must:会真重开盲区 / P3 文档失同步)已修 / 一手(本场 `feat/idle-self-wakeup` codex-review 收口)。

### #56 round-2 续 — codex 第二轮复审又抓到「完成态握手 fingerprint 不含 watchdog 维度」更刁钻的真 bug ✅正向(机制验证)+ P2 已修

- **现象**:#56 round-1 的两条修完后,跑 **codex 第二轮**复审,又抓到一个**更刁钻的真 bug**(已验证为真):`verify-board.sh` 的完成态握手用一个 **fingerprint**(`status_fingerprint()` 的 cksum)去重——同 fingerprint 已握手过就走 `allow_handshook_fp` **早退**路径、**在评估 watchdog clause 之前就返回**。但当时的 fingerprint **只算 task 状态三元组(id+status+blocked_on)、不含 `watchdog_needed`**。于是:若一个完成态已在**旧 fingerprint** 下握手过(典型场景:用户在某 `in_flight` 任务还在飞时**升级了插件**,该完成态已被 **round-1 旧逻辑**握手记进 `.stopcheck`),升级后的新 hook 见 fingerprint 仍匹配当前 task 状态 → 走 allow 早退、**绕过新加的 watchdog clause** → 一个有 `in_flight`、无 `wakeup` 的 board 仍能静默停下、不发 watchdog 提醒 → **重开本功能(以及 round-1)要堵的同一片静默失败盲区**。
- **根因**:**「新增一个走在 fingerprint 去重之后的 hook clause、却没把该 clause 的判定维度纳入 fingerprint」是一类结构性反模式**。watchdog clause(round-1 / v0.6.0 加)位于完成态握手的**早退闸之后**;只要 fingerprint 的输入不含 `watchdog_needed`,「该不该发 watchdog 提醒」这个新维度就被去重逻辑**透明地跳过**。round-1 的 8 条单测(WD-a..h)全是 fresh SID/home(无陈旧 `.stopcheck`),所以**第一次** Stop 必然到达握手、watchdog clause 照常触发——**升级/陈旧-fingerprint 这条退化路径正好落在 happy-path 单测与作者亲读的共同盲区里**(同 [[Finding #40]]「退化/边界路径 bug 单测系统看不见」)。
- **影响**:**正向**——codex **连续两轮真阳性**(round-1 抓退役清理纪律 + DESIGN 失同步,round-2 抓 fingerprint 维度缺失),进一步坐实 **codex-as-second-verifier 价值**(AGENTS §7;同族 [[Finding #19]]/[[Finding #21]]/[[Finding #22]]/[[Finding #40]]/[[Finding #51]]/[[Finding #52]])。尤其 round-2 这条是**会真重开盲区**的退化路径(升级中途带 in_flight 的真实场景),非纸面瑕疵。
- **处置(含蒸馏判定)**:**已修(P2)**——把 `watchdog_needed`(0/1)**折进 fingerprint 的 cksum 输入**(`status_fingerprint()` 在 task 三元组前加一行 `watchdog_needed:<v>`)。两重收益:① `watchdog_needed=1` 的完成态与同 task 状态但 `=0` 的有**不同 fingerprint** → 转入「需 watchdog」会触发该握手(含提醒);② **fingerprint 公式本身变了** → 任何 round-1 旧逻辑写的陈旧 `.stopcheck`(不含 watchdog 维度)算出的旧式 fingerprint **必然 ≠ 新 hook 算出的值** → 升级场景被**强制走一次 fresh 握手** → watchdog 提醒照常发。`watchdog_needed` 在 board 扫描循环里已先于 `status_fingerprint()` 算出,**无需调赋值顺序**。测试同步:`tests/hooks/test_verify-board-watchdog.sh` 加 **WD-i**(陈旧旧式 fingerprint 场景:in_flight+无 wakeup+`.stopcheck` 存旧 fp → 新 hook 仍 emit_block 且含 watchdog 提醒,**这是 codex 场景的回归**)+ **WD-j**(同 fingerprint 去重仍有效:watchdog_needed 相同时重复 Stop 仍正确去重、不变每拍唠叨);`tests/hooks/test_verify-board.sh` 的 `fp_of()` 镜像同步加 `watchdog_needed` 维度(+ `wakeup_is_object_t` 助手),既有 67 用例全绿。
- **蒸馏判定**:本条**不另开红线 / Rationalization 行**(验收盲区纪律已是 AGENTS §7 + §10 + Finding #12 既有沉淀,守 [[Finding #7]] 收敛)。但**新增一条通用教训值得记牢**(回流入本台账作纪律素材,不进 skill body):**新增一个 hook clause 时,若它走在 fingerprint 去重(或任何「同 key 早退」缓存)之后,必须把该 clause 的判定维度纳入该 key,否则去重会静默绕过新 clause**——这是 round-1 加 watchdog clause 时未同步更新 fingerprint 留下的债,与 [[Finding #50]]「修一个缺陷要查它在所有落点」、[[Finding #52]]「任何改并发行为的 fix 验证必须覆盖并发」同属「**改了 A 必须连带审 A 的所有依赖面**」家族。
- **严重度 / 来源**:✅正向(机制验证·codex 第二轮真阳性)+ P2(会真重开盲区的退化路径)已修 / 一手(本场 `feat/idle-self-wakeup` codex 第二轮 review 收口)。

## Finding #57 — 合并后 main 发版前验证发现预存 flaky 测试 S24(心跳新鲜度·时间依赖) · 低(预存·与 0.6.0 无关)

- **现象**:`feat/idle-self-wakeup`(#19 watchdog)merge 后,用户又把 **#18(board viz)一并 merge** 进同一 0.6.0 版本的 main。发版前在合并后的 main 上跑全套门验证两功能叠加状态——一次 `TESTS FAILED`、再跑却绿,**3 跑 2 绿**。失败是 `tests/hooks/test_flow.sh` 的 **S24**(minute-precision recent heartbeat dates as FRESH,心跳新鲜度判定),**分钟精度、时间依赖**,在分钟边界附近间歇 flip。
- **根因**:S24 是**预先存在**的时间依赖测试(`test_flow.sh` 自 #2 起,#18(`c966189`)/#19(`2a701fb`)对它**零触及**),与 0.6.0 watchdog / #18 board viz 都无关。属时间边界 flake——断言吃了 wall-clock 分钟精度(与 [[Finding #52]] temp-dir flaky 同属「环境/时序致偶发红」,但根因不同)。
- **影响**:差点把合并后 main 的一次 flaky 红误判为「两功能叠加搞坏了」(实则功能性全绿)。**正向教训**:① 合并两个同版本 PR 后、发版前**必须验证组合 main 的全套门**(各自 PR 绿不够,[[Finding #12]] 端点必跑全套延伸到 post-merge 集成);② **一红一绿先复现性定性**(3 跑)再下结论,勿单次红就慌、也勿单次绿就放行。
- **处置(含蒸馏判定)**:用户决策**照发 0.6.0**(main 对 0.6.0 内容功能性全绿,此 flake 预存且与本次无关、不该阻塞发版)、**flake 记 follow-up**(本条)。蒸馏=后续起**独立 change/PR** 按 `superpowers:systematic-debugging` root-cause S24(多半是新鲜度窗口 minute-precision 比较的边界 off-by-one),固定时钟注入或拓宽窗口,**勿仅拓宽掩盖**。本条**不进 skill body**,作台账 follow-up 素材。
- **严重度 / 来源**:低(测试纪律·预存 flake·与 0.6.0 无关)/ 一手(本场 0.6.0 post-merge 发版收尾验证)。

## Finding #58 — watchdog 在「前台指挥工作」上的 false-positive nudge:`in_flight` 误用于前台 self 工作 · 低(建模·正向自检)

- **现象**:post-merge 收尾阶段,orchestrator 把 ship 节点 V2(前台指挥**亲自执行**的收口工作)标了 `status:"in_flight"`、`mechanism:"self"`。下一拍 goal-hook 完成态握手按 v0.6.0 新规则(board 有 `in_flight` 任务且无 `wakeup` → 提醒 arm watchdog)**正确 fire 了 watchdog 提醒**——但这是 **false-positive**:V2:self 是前台指挥工作,不是「可静默失败的已派发后台任务」;真正在飞的后台任务(全套门 shell)是 harness 追踪、短而有界、会自动重唤起的。
- **根因**:hook 的 `watchdog_needed` 只能 keyed off board 里 task 的 `status:"in_flight"`,**无法区分**「已派发的后台 sub-agent/shell(真可能静默失败)」与「前台指挥正亲自推进的节点」。错在 orchestrator **误用** `in_flight` 标前台 self 工作——`board.md` 早定义 `in_flight` = 「已派发、正在后台跑」(隐含有真实 handle 的后台任务),前台指挥的 ship-执行不该套这状态。hook 本身按规则行事、**无错**。
- **影响**:**正向(dogfood 自检)**——边造边用自己的 watchdog 功能,亲历它在前台工作上的过度提醒,暴露 `in_flight` 语义被我自己用宽了。无产品损害(改回 V2:`blocked` 即消误提醒)。
- **处置(含蒸馏判定)**:即时改 V2 回 `status:"blocked"`(watchdog_needed 归 0、误提醒消失)。蒸馏判定=**判 `board.md` status enum 处是否加一句强调「`in_flight` 专指已派发后台任务(有真实 handle),前台指挥亲自推进的节点别套 in_flight」**——倾向轻量澄清或判已被「已派发、正在后台跑」隐含、仅作自律。列 **0.6.x 候选**,本次不改 skill body(守 [[Finding #7]] 收敛、勿为单次观察硬塞规则)。
- **严重度 / 来源**:低(建模·正向自检·无产品损害)/ 一手(本场 0.6.0 post-merge 收尾,边用 watchdog 边发现)。

## Finding #59 — `/cc-master:view` 的 view-server 对 board 读取无异常兜底,撞 orchestrator 连改 board 的瞬态半写即崩(exit 144)留下死 view · 低-中(分发的 read-only 工具健壮性)

- **现象**:本场(three-clear-directions 编排)起了 `/cc-master:view` 的只读 view-server(`skills/master-orchestrator-guide/scripts/view-server.js`,port 50411)给用户看 board DAG。随后 orchestrator 在一拍内**连改 3 次 board.json**(刷 heartbeat / 换 wakeup / append log,各一次 `Edit`)。几秒后 view-server **无声死掉(exit 144)**——stdout 只有启动那行 `cc-master board view: http://...`、**零 stderr**,端口 `curl` 已无响应。用户开着的浏览器 view 永久冻在死页(read-only 工具,它不会自愈,用户得自己察觉 + 我重起一个新 port)。
- **根因**:view-server 每 2s 轮询读 `board.json` 服给浏览器;**最可能是它对 board 文件读取 / `JSON.parse` 没包 try/catch**——`Edit` 工具落盘有个极短的「旧内容已截断、新内容未写全」瞬态窗口,2s 轮询正好撞上就读到**半写的非法 JSON**,`JSON.parse` 抛未捕获异常 → node 进程整个崩掉(exit 144 = 被信号/未捕获异常终止)。这与 [[Finding #54]]「坏 JSON 会让 viewer 静默永久冻结」同根:**board 作为高频被改的单一真相源,任何读它的常驻进程都必须把『读到瞬态半写/坏 JSON』当常态来容错**(读失败 → 保留上一份好快照 + 跳过这一拍,绝不崩),而非假设每次读都是合法 JSON。arm 侧(server 起得来)写得好,**容错侧(读循环抗瞬态)缺失**——又一例生命周期一端硬、另一端软(呼应 [[Finding #56]] arm/退役不对称)。
- **影响**:轻-中——纯 read-only 开发期可视化工具(不写 board、不碰编排正确性),崩了重起即可,无产品数据损害。但:① 它**随插件分发**(`skills/.../scripts/`),终端用户用 `/cc-master:view` 时同样会在「编排正活跃、board 高频被改」时撞崩——而那恰恰是最该看 view 的时候;② 崩得**无声**(零 stderr),用户只看到浏览器卡死、不知为何,体验差。
- **处置(含蒸馏判定)**:**即时应对**——board.json 稳定后重起新 view-server(port 50937)恢复用户的 view,本场未阻塞编排。**蒸馏判定=候选代码修复(回流 `view-server.js`):board 读取 + `JSON.parse` 包 try/catch,失败时保留上一份好快照、跳过本拍轮询、绝不让进程崩**(可选:stderr 记一行 warn 便于诊断)。**是否并入本 bundle(three-clear PR)待用户定**——它与 bundle 的 view/#9 timeline 主题相邻、修复面小(几行 try/catch),顺手并入合理;但属本场新发现、不在原议定 bundle 范围,**不擅自扩 scope**,surface 给用户拍。**红线**:纯改分发脚本的容错、不碰 hook(红线1 无关)、不碰 board 窄腰(红线2)。
- **严重度 / 来源**:低-中(分发的 read-only 工具健壮性·无产品损害但 user-facing 体验)/ 一手(本场连改 board.json 时亲历 view-server 崩)。

## Finding #60 — watchdog 用 output-size 停滞检测当存活信号,对「sub-agent 合法阻塞在长静默命令(run-tests)」误报卡死(=用户点名真痛「watchdog 提前 fire」)→ 改纯 ceiling + harness 完成事件双路 · 中(编排 watchdog 写法)

- **现象**:本场 T8(sub-agent 实现)在飞,orchestrator 等待前 arm 了一个 background-shell watchdog,用「输出文件 size 连续 6 次(=3min)不增长」当卡死信号。T8 跑到**最终全套 gate**(`bash run-tests.sh + claude plugin validate + skill-lint`,这命令几分钟、期间 sub-agent 阻塞等它返回、**不产任何中间输出**)时,输出文件 size 自然停增 → watchdog **误判 T8 卡死、提前 fire** 把我唤醒 recon。recon 一看 T8 健康、正阻塞在长 gate 命令上——**纯 false-positive**。这正是用户开场点名的两大真痛之一「**watchdog 提前 fire**」的**活体复现**。
- **根因**:**output-size 停滞不是好的存活信号**——sub-agent 合法地阻塞在一条长静默命令(run-tests / 大编译 / 网络等待)上时,输出本就该静默,与「真卡死/hang」在 output-size 维度**不可区分**。停滞检测把「正常的长静默」误当「死亡」,阈值再调都治标不治本(调长会漏报真 hang、调短会狂误报)。本质:watchdog 的职责被错配——harness **本来就在 agent 完成时发 task-notification 事件**(快路径、精确),watchdog 的**唯一**正当职责是补 harness 对「永不发完成事件的真 hang / 静默死 / 幽灵任务」的盲区(ADR-011 / `references/async-hitl.md` 的安全网定位),而真 hang 用一个**足够宽的纯时间 ceiling** 兜底即可,根本不需要(也不该用)output-size 这种脆弱的活性代理。
- **影响**:**正向(dogfood 自检 + 直击用户真痛)**——边用 watchdog 边复现了它最恼人的失败面,且定位到根因是「停滞检测」这个机制选择本身错,不是阈值问题。无产品损害(误报只是多唤醒我一拍 recon),但**多烧了 cycle + 正是用户要我们根治的痛点**,§9「效率没拉满必落账」正中。与 [[Finding #58]](watchdog 另一类 false-positive:`in_flight` 语义误用)同族、不同机制维度。
- **处置(含蒸馏判定)**:**即时应对**——本场当即把 watchdog 从「停滞检测」改为**纯 ceiling**(`until` 睡到固定时限再唤我 recon,无 output-size 检测),误报消失;依赖 **harness 完成事件当快路径 + 纯 ceiling 当真-hang 兜底**的双路。**蒸馏判定=回流落点待 D1 #7(探活/保活机制)讨论定**——#7 正是用户保留要前台共创的「一套完善的真保活/探活机制」设计题,本条是它的第一手证据,**处置不在此预判 #7 的设计**(那会越权设计闸);**候选回流**(待 #7 定):`references/async-hitl.md` §等待前 arm watchdog 补一句写法纪律「watchdog 用纯时间 ceiling(或足够慷慨的阈值),**勿用 output-size 停滞当存活信号**——sub-agent 合法阻塞在长静默命令时输出本就该静,停滞检测必误报;harness 完成事件已是快路径,watchdog 只需宽 ceiling 兜真 hang」,可能并 `references/dispatch.md` 的工具降级链。**本次只先落账 + 即时改法,正式回流随 #7。**
- **严重度 / 来源**:中(编排 watchdog 写法·直击用户点名真痛·dogfood 自检)/ 一手(本场 T8 在飞、watchdog 停滞误报亲历)。

## Finding #61 — agentic 录号 setup-token 需 TTY:整脚本包 PTY 又卡死 keychain 写(两步 TTY 需求相反)→ 只给 setup-token 包内部 PTY · ✅正向(机制验证·已端到端验证)+ runtime 地基修复

- **现象**:T18 dogfood(用户真账号 `qiwei.pan@shanda.com` 真跑)录备号时,agent 用后台 Bash 跑 `account-add.sh` → `claude setup-token` **hang**:即便用户在浏览器里认证成功,setup-token 也不退出、`$()` 永久阻塞、keychain 无项。第一次修复尝试——给**整个** account-add.sh 包 PTY(`script -q /dev/null bash account-add.sh`)——让 setup-token 走完了,**却换来 `security -w`(keychain 写)卡死**:有 /dev/tty 时 `security add-generic-password … -w` 会去 tty 提示「password data for new item:」+ 等人输入、**忽略** `printf | security -w` 喂的 stdin。两步 TTY 需求**正相反**。
- **根因**:① **setup-token 要 TTY**——它是交互式 TUI(Ink/React for CLI),需控制终端才能走完 OAuth 回环;agent 后台 Bash 无 TTY → 直跑 hang。② **`security -w` 要没 TTY**——它在见到 /dev/tty 时优先走交互提示读 tty、**抛弃** printf 喂的 stdin;脚本靠 `printf '%s\n%s\n' | security … -w`(stdin 双喂)写 keychain,**只在无 tty 时**才落回读 stdin。给整个脚本包一个 PTY 同时满足不了这两个相反需求——它把 setup-token 的 hang 换成了 keychain 写的 hang/存空,而且换到了**存密那一步**(最危险的地方:可能静默存空/脏 token,直到换号时才暴露)。
- **影响**:**正向(机制验证·已端到端验证通过)**——这是 [[Finding #T16/#48]]「建造后必 dogfood 才可信」家族的又一活体兑现:**纯 code 审(codex 五轮)发现不了这个 runtime 地基问题**——脚本静态读起来完全合理,只有在真机、真账号、agent 真后台 Bash(无 TTY)跑时才暴露 setup-token 的 TTY 依赖与两步相反的 TTY 需求。修复后端到端验证通过(keychain 真存项 + registry 真写 entry + 零 token 泄漏)。坐实 charter ②/⑤ 的录号基础设施在真 agentic 场景下可用。
- **处置(含蒸馏判定)**:**正解 = 只给 `claude setup-token` 包一个内部 PTY,不包整个脚本**——`script` 用 forkpty 造新 PTY、不需父进程有 TTY;setup-token 经内部 PTY 走完,account-add.sh 自身仍无控制终端,`security -w` 落回读 stdin。token 仍只活在 raw 变量、绝不回显(typescript 落 /dev/null)。**蒸馏判定(已落地三处)**:
  - **回流 account-add.sh**:抽 `run_setup_token_with_pty()` 封装内部 PTY 包装,**cross-platform robust**——BSD/macOS `script -q /dev/null <cmd>` vs util-linux `script -qec "<cmd>" /dev/null`(探 `script --version` 是否含 `util-linux` 选方言);`script` 缺失/PTY 失败 → fallback 无 PTY 直跑(诚实标注:agent 后台可能 hang,届时用户改在自己 TTY 终端跑,下游「提取失败→手动骨架」继续兜底)。注释写清「为什么只包 setup-token 不包整个脚本」(两步相反 TTY 需求)+ 这是 T18 现场发现。dry-run mirror 同步成 PTY 形态。
  - **回流 `account-management/SKILL.md`**:四件事表后加「录号的验证过正确路径」段(**判断型机制知识**)——agent 直接 Bash 跑能跑通、唯一手动步浏览器登录;PTY 只包 setup-token 绝不包整脚本(两步 TTY 需求相反);fallback 诚实兜底。
  - **回流 `commands/accounts.md`**:§4 对冲措辞更新为「内部 PTY 已解决·agent Bash 能跑通(T18 验证过)」,保留「提取失败→fallback 手动骨架」诚实兜底。
  - **TDD-for-skills baseline 结果(诚实标注)**:SKILL.md 新增的「PTY 只包 setup-token 不包整个脚本」机制知识跑了一遍 §6 pressure baseline(三压:11pm deploy 窗口将关 + 2h 沉没成本 + 疲惫,强制 A/B 二选)——**baseline 未失败(RED 不成立)**:强模型在脚本既有注释(line 338-342 已编码「两步相反 TTY 需求」)在场时,正确选了「只包 setup-token」(Option A)并明确驳回「整脚本包 PTY 更简单」的合理化。**故按 [[Finding #26]]/[[Finding #55]] 防造纪律,不为它造 Rationalization Table / 红旗行**(强模型天花板,baseline 不失败就不编造未被违反的规则);改以**reference 形态的机制知识**(how-to,非纪律规则)固化进 SKILL.md——机制知识的价值在「读 SKILL.md 而没开脚本的人也拿到这条 why」,不靠纪律闸守。
  - **回归牙齿**:`tests/hooks/test_account-add.sh` 加结构断言 pin 住「setup-token 经 `run_setup_token_with_pty` 包装路径 + cross-platform 两套 script 方言分支 + fallback 分支」,防回退把 PTY 包装删掉(setup-token 端到端真跑涉真 OAuth 无法 hermetic 测,但包装函数选型 + 平台分支可结构断言)。token 安全测试(无 echo 泄漏)仍绿。
- **严重度 / 来源**:✅正向(机制验证·runtime 地基修复·已端到端验证通过)/ 一手(T18 dogfood 真账号现场发现 + 现场修复 + 验证)。

## Finding #62 — 系统性 locale 雷:`set -u` × 裸 `$VAR` 紧贴多字节中文串 → bash 吞首字节成未定义名 → 成功路径仍 `unbound variable` 崩 · 中(ship-anywhere 可移植性·红线5 家族)

- **现象**:account-management 脚本(`account-add.sh` / `account-delete.sh`)在 `set -u`(nounset)下、正文带中文(多字节)info/err 串时,一个**裸 `$VAR` 紧贴一个多字节字符**(如 `... -a $EMAIL（不带 -w）`)会按 **bash build × 活动 locale** 把那个多字节字符的**首字节吸进变量名**——展开 `$EMAIL<byte>` = 一个**未定义名** → `set -u` 以 `unbound variable`、exit 1 **abort**,**哪怕 vault + registry 已正确写入**。端点验收实测的崩点是 `account-add.sh:340` 的 e2e file-store **SUCCESS 路径**(`tests/hooks/test_account-add.sh` lines 329-340 钉死,作者期复现 `line 340: EMAIL<byte>: unbound variable`, rc=1)。**locale 依赖**:macOS bash 3.2 在 UTF-8 下咬、在 C locale 下不咬;别的 build 反之——同一脚本在不同 locale 行为漂移,典型可移植性坑。
- **根因**:bash 变量名扩展遇裸 `$EMAIL（` 时,名字边界判定吃了 locale/byte 规则——多字节字符首字节被并进名字,得到从不存在的名,`set -u` 立即 abort。病根是**裸 `$VAR` 紧贴多字节字符无显式边界**;`set -u` + 中文消息串 + email 当标识(必含 `.`/`@`/中文相邻)三者叠加放大了它。注意:这条只在**带中文 prose 的脚本**+ **nounset** + **特定 locale** 三元交叉才现形——是真实 ship-anywhere 形态盲区(开发机 locale 不一定复现)。
- **影响**:中——会让**成功路径**(token 已安全落 vault、registry 已写)在收尾消息那一步崩 exit 1,用户看到的是"录号失败",实则副作用已发生(误导 + 可能引诱用户重跑造重复)。且 locale 依赖让它在某些机器静默潜伏、换台机器才暴——纯 correctness/可移植性缺口,属红线5 ship-anywhere 家族(脚本须在任意 locale 的宿主机上行为一致)。
- **处置(含蒸馏判定)**:**已在本轮(TR10 期)从源头修**,落点二处(均 source,非 prose):① **修法 = locale 无关的花括号定界** `${EMAIL}（` 取代裸 `$EMAIL（`——已在 `account-add.sh`(如 line 535 `${EMAIL}（不带 -w）`)、`account-delete.sh`(lines 132/191/192 `${VAULT_FILE}（` / `${KEYCHAIN_SERVICE}（` / `${EMAIL}_*`)落地;花括号显式锚定名字边界,与 locale/byte 规则无关;② **回归牙齿** `tests/hooks/test_account-add.sh`(§"LOCALE REGRESSION TEETH",lines 329-374)在 **`en_US.UTF-8` 与 `C` 两个 locale 下**各跑 add e2e 成功路径 + delete dry-run,断言 exit 0 + 无 `unbound variable`(因 byte-吸收是 build/locale 依赖,**必须两 locale 都跑**才稳),且 self-checking(把花括号回退成裸 `$EMAIL（` 会翻 RED)。**蒸馏判定 = 不回流 skill prose**——这是**脚本级编码纪律**(写脚本时 `set -u` 下裸 `$VAR` 紧贴非 ASCII 须花括号定界),太 granular 不进 SKILL.md 散文(它面向"换号决策/机制",非 bash 编码 footgun);已由**牙齿测试**(双 locale 回归)+ **脚本现修形态**承载,比 prose 更确定。记为永久 finding 作"红线5 ship-anywhere 在脚本 locale 维度的活体盲区"素材(与 [[Finding #52]]b 的"环境脆性登记"、[[Finding #61]] 的 runtime 地基修复同族——纯 code 审难发现、真机/特定环境才暴)。
- **严重度 / 来源**:中(ship-anywhere 可移植性·红线5 家族·成功路径误崩)/ 一手(本轮 account-management 端点验收钉到 `account-add.sh:340` 成功路径崩 + 双 locale 牙齿固化)。

## Finding #63 — 早期 account 测试没隔离 `CC_MASTER_HOME` → 会写进用户**真** registry 污染真号池 · 中(测试纪律·副作用隔离)

- **现象**:account-add.sh 的 SUCCESS 路径会往 `${CC_MASTER_HOME:-$HOME/.claude/cc-master}/accounts.json` 写一条非密 registry entry(`accounts-lib.defaultRegistryPath`)。早期测试**没把 `CC_MASTER_HOME` 指向隔离临时目录**——于是每次 `bash run-tests.sh` 跑 e2e 用例(如 `acctE2E …`)都会把测试账号**直接写进用户真实的 `~/.claude/cc-master/accounts.json`**,**污染用户活的换号号池**。
- **根因**:被测脚本有**真实文件副作用**(写 registry),而 registry 路径默认落用户 home;测试若不覆写 `CC_MASTER_HOME`,副作用就打到生产路径。这是"测试写到真 SSOT"的经典隔离缺口——与 [[Finding #52]] 的 temp-dir 泄漏同属"测试自身副作用未隔离/未清理"家族,但这条更危险:#52 是泄漏空临时目录(脏环境),这条是**写脏用户的真号池**(数据污染)。
- **影响**:中——污染用户真 registry(冒出测试账号 entry),用户 `account-list.sh` 会看到 `acctE2E` 这类幽灵号,需手动剔;且每跑一次测试就污染一次(单调累积)。无 token 泄漏(registry 只存非密指针·[[Finding #61]] 同纪律),但仍损害"测试不该碰生产状态"的硬纪律。
- **处置(含蒸馏判定)**:**已修(本轮)**,落点 `tests/hooks/test_account-add.sh` 顶部 §"REGISTRY ISOLATION"(lines 18-31):`TEST_HOME_DIR="$(make_project)"` + `export CC_MASTER_HOME="$TEST_HOME_DIR"` + `trap 'rm -rf "$TEST_HOME_DIR"' EXIT`——把所有 registry 写引到一次性临时目录并在退出清理。**一处精微教训(已编码进注释)**:cleanup 必须引用**专用的 `$TEST_HOME_DIR`**(从不 unset),而非 `$CC_MASTER_HOME`——因后续用例(如 (4d))会 `unset CC_MASTER_HOME` 测无 env 路径,helpers 的 `set -u` 下 EXIT-trap 里的 `"$CC_MASTER_HOME"` 会在退出时 `unbound variable` 崩(与 [[Finding #62]] 同类 nounset footgun)。**蒸馏判定 = 不回流 skill prose,记为测试约定**——"凡被测脚本有写 registry/vault/board 等生产路径副作用,测试必把 `CC_MASTER_HOME`(及同类 home 锚)export 到隔离临时目录 + EXIT-trap 清理,且 cleanup 引用从不 unset 的专用 var"已是**测试文件 setup/trap 的现行形态**(自承载),属 dev-only 测试纪律,太 granular 不进面向用户的 SKILL.md;作永久 finding 入账供未来新增 account 测试照搬(与 [[Finding #52]] temp-dir 隔离纪律同列)。
- **严重度 / 来源**:中(测试纪律·副作用隔离·会污染用户真号池)/ 一手(本轮 account-add 测试隔离修复)。

## Finding #64 — notification / sub-agent 自报「成功」与地面真相不符,只有查 git/工具结果才戳穿:镜头6 又一活体复现 ✅正向(判不单列·并入 [[Finding #17]]/[[Finding #46]]/[[Finding #56]] 引用)

- **现象**:本轮 account-management dogfood 过程中,完成通知 / sub-agent 自报"成功"在若干处与**实际地面真相**(git 状态 / 真实 function_results / 真 artifact 内容)不符——只有去查地面真相(读 diff、跑真测试、核真产物)才戳穿假绿。这是 SKILL A **镜头6"gate-green ≠ passed / 只信端点验收 / notification 会撒谎"** 的又一次活体复现。
- **根因**:与既有同族 finding 同根——notification/自报是**易朽的、可能撒谎的**信号层(sub-agent 把"我以为做完了"报成"成功",harness 完成事件也只证"进程退出"非"语义正确");唯一可信的是**端点亲验地面真相**。[[Finding #17]]/[[Finding #46]](phantom in_flight:board 标注/自报与真实派发脱节)、[[Finding #56]](codex 抓到我们自己"充分验收"全漏的真 bug)已是这条原则的反复沉淀。
- **影响**:正向(机制必要性复证)——再次坐实镜头6 不是镀金:本轮若信了自报"成功",会把若干带病/未真验的产物当 done。但**无新增信息维度**:现象、根因、处置全被 [[Finding #17]]/[[Finding #46]](phantom in_flight 家族)+ [[Finding #56]](充分验收仍漏)+ 镜头6 正文覆盖。
- **处置(含蒸馏判定)**:**判不单列为带新 prose 的独立 finding,以交叉引用形态入账**——镜头6 已在 SKILL A 正文(reinject 常驻),phantom in_flight / 自报失真已是 [[Finding #17]]/[[Finding #46]] 的纪律沉淀,codex 戳穿假绿已是 [[Finding #56]] 家族,**再写一条等价 finding 会造重复**(违 [[Finding #7]] 收敛纪律,且稀释台账信噪)。**蒸馏判定 = 不新增任何 prose / 红线**,仅作镜头6 的**又一次 live vindication** 登记(同 [[Finding #14]]/[[Finding #48]] 正向素材列)——价值在"账户管理这个新域里镜头6 仍兑现",而非新规则。
- **严重度 / 来源**:✅正向(镜头6 机制复证·判并入引用不单列)/ 一手(本轮 account-management dogfood 自报与地面真相不符)。

## Finding #65 — A2 版 account-add 首次被真测,是在「端点验收指向了**真** artifact」之后:验错对象 = 假绿 · 低-中(端点验收纪律·镜头6 维度)

- **现象**:A2 重构(email 当标识)后的 account-add **第一次被真正测到**,是在"端点验收钉到了**真** artifact"之后——此前的验收有可能指向了 **duplicate / stale 产物**(看了个不是下游真消费的副本/旧版),从而**误绿**。教训直白:端点验收(镜头6)必须把验收对象钉在**下游真正消费的那个 artifact** 上,验错对象 = 假绿,等于没验。
- **根因**:镜头6 的"只信端点验收"有个隐含前提常被忽略——**验收对象必须是真消费链上的那一个产物**。若手边有同名/相邻的 duplicate(旧 checkout、临时副本、stale 缓存),验收看了它、绿了,会误以为真产物也绿;而真产物可能根本没被那次验收触达。这与 [[Finding #56]]"diff review 看的是改了什么、非漏改什么"同属"验收手段有结构盲区"家族,但这条的盲区是**验收对象本身选错**(钉错 artifact),比"看法盲区"更前置。
- **影响**:低-中——A2 account-add 险些在"验了个非真消费产物"的假绿下被当 done;真测到之后才暴露此前验收对象可能是 duplicate。无最终产品损害(真测补上了),但暴露"端点验收对象选取"是镜头6 落地的一个易错点——尤其重构期(新旧版本并存、duplicate 多)。
- **处置(含蒸馏判定)**:**蒸馏判定 = 轻量强化端点验收纪律(候选回流 `references/resume-verify.md`)**——在端点验收/content-hash 小节加一句:「**验收对象必须是下游真正消费的那个 artifact**——重构/多版本并存期尤其先确认验的不是 duplicate/stale 副本,否则验错对象 = 假绿(等于没验)」。**但倾向先登记、回流与否随后续 account-management 收口者定**:若 `resume-verify.md` 既有"只信端点验收"表述已隐含"验真产物"则判**不回流**(避免双 SSOT·守 [[Finding #7]] 收敛),本条仅作镜头6 在"验收对象选取"维度的素材入账;与 [[Finding #56]](验收手段盲区)同族、不同维度(对象 vs 看法)。
- **严重度 / 来源**:低-中(端点验收纪律·镜头6 维度·重构期易错点)/ 一手(本轮 A2 account-add 首次真测时发现)。

## Finding #66 — ✅codex(非-Claude 第二验收者)跨多轮在「全套测试**绿**」前提下仍抓出一批真 P2(安全/正确性/一致性 bug):测试绿 ≠ 无隐性失败的强兑现 ✅正向(机制验证·[[Finding #56]] 更大规模续作)

- **现象**:account-management 全套测试(`tests/hooks/test_account-add.sh` / `test_switch-select.sh` / `test_accounts-delete-line.sh` 等)**绿**的前提下,codex(AGENTS §7 非-Claude 第二端点验收者)跨**多轮**(脚本注释可见 `codex 二审` / `codex round-3` / `codex round-4`)review 仍抓出一批真 **P2**(安全/正确性/一致性 bug),已带 `P2-N` 注释钉进脚本作回归锚。**grounding 核实(以仓库实读为准)**:`skills/account-management/scripts/` 下**在代码注释中可定位的 distinct P2 标号有 8 个**——`P2-1`/`P2-2`(switch-account.sh:换号时序解耦——先过全部非变更性 preflight 再落 registry、snapshot 与 setActive 拆成两次独立 save,避免"registry 标新号 active、session 仍旧 token"损坏态)、`P2-5`(file vault 读 token 行从 `grep -F` 升 `awk index($0,p)==1` 行首锚定——email 元字符 + 重叠标识下取错行→整行畸形当 token)、`P2-6`(绝不 `exec env VAR=val claude`——token 进 argv ps 可见,改 `export`+裸 `exec claude`)、`P2-7`(round-3:`claude` 可执行性 preflight 必在 registry 写之前,否则"registry 翻了却 exec 不了"损坏态)、`P2-8`(round-3:fallback 也写非密 registry entry 让备号对号池可发现)、`P2-12`(round-4:account-delete 的 registry-derived service/path 覆盖条件 bug)、`P2-14`(switch-account `2>/dev/null` 吞掉选号器自己生成的可操作警告)。**编号最大到 P2-14**(中间有跳号:P2-3/4/9/10/11/13/15 未在当前脚本注释定位到——可能修进了别处/合并了/编号未连续)。**诚实标注**:orchestrator 口述为"跨 5 轮抓 ~15 个 P2(P2-1~P2-15)";**在当前代码我能核实的是:distinct P2 注释 8 条、编号达 P2-14、codex 多轮(明确见 round-3 / round-4 + 二审)**——"5 轮"与"恰 15 条"的精确数字我未能在代码逐一定位,据 orchestrator 口述记,端点验收时可重点核这两个数字。
- **根因(机制成功)**:① **codex = 非-Claude 视角,与全套测试绿的分歧 = 高信号**(AGENTS §7/§8)——这批 P2 全在 `run-tests.sh` 绿的前提下被逮,坐实"测试只保 correctness 的语义层、保不了换号时序/argv 泄漏/locale 取行这类**隐性安全与一致性**缺口"(AGENTS §10);② P2 的性质(时序损坏态、token 进 argv、取错行注入畸形 token、preflight 缺失、警告被吞)多是**单测系统难覆盖的退化/边界/安全路径**(同 [[Finding #40]]"退化路径 bug 单测看不见");③ 多轮迭代(round-1→2→3→4)逐层揭露——前轮修完后轮又抓新面,印证第二验收者**不是一次性镀金而是持续真阳性源**。
- **影响**:**正向**——这是 [[Finding #56]](codex 抓 watchdog 2 个真问题、随后 round-2 又抓 fingerprint 维度)在 account-management 域的**更大规模续作**:从"2 问题/2 轮"放大到"8+ distinct P2 / 多轮(口述 ~15/5 轮)",且这批含**安全维度**(token argv 泄漏 P2-6、取错行注入 P2-5)——比 #56 的纪律/文档缺口更逼近 must-fix。与 [[Finding #19]]/[[Finding #21]]/[[Finding #40]]/[[Finding #51]]/[[Finding #56]] 同族,是"测试全绿 vs codex 仍抓真 bug"对比的又一硬证据,charter ⑤/③(安全 + 验收质量)的落地素材。
- **处置(含蒸馏判定)**:**正向登记 + P2 已逐条修(回归锚 = 脚本里的 `P2-N` 注释 + 对应测试)**。**蒸馏判定 = 不另开红线 / Rationalization 行,不新增 skill prose**——"codex 当第二端点验收者"已在 AGENTS §7/§8 + `references/resume-verify.md`(codex 第二验收者小节)文档化,"测试只保 correctness 不保 quality"已是 AGENTS §10 + [[Finding #12]] 沉淀,再写造双 SSOT(违 [[Finding #7]] 收敛)。本条作**机制更大规模兑现的正向素材**入账(与 [[Finding #56]] 同列、规模更大),"测试全绿 vs codex 抓 8+ P2"对比可作 README/§7 的强说服素材。具体每条 P2 的修法已就地编码在脚本注释(switch-account.sh / accounts-lib.js / account-add.sh / account-delete.sh 的 `P2-N` 段),不在台账复述细节。
- **严重度 / 来源**:✅正向(机制验证·codex 第二验收者价值·[[Finding #56]] 更大规模续作)/ 一手(本轮 account-management codex 多轮 review 收口;P2 精确数 8 distinct 已核实、"~15/5 轮"据 orchestrator 口述待端点复核)。

## Finding #67 — token-blind spike 实测证伪「订阅 OAuth token 可经通用 Bearer 通道(ANTHROPIC_AUTH_TOKEN / apiKeyHelper)注入」的纸面推断:订阅 token 只在专用 CLAUDE_CODE_OAUTH_TOKEN 通道生效 → apiKeyHelper 无重启换号对订阅号 RULED OUT · ✅正向(机制验证·实证 settle 换号架构·文档推断被实测证伪)

- **现象 / 实验**:为判定「能否让运行中 session 不重启就换订阅号」,跑了个 **token-blind 三测对照 spike**(account=一个 keychain 备号,直连 `api.anthropic.com`、无 `ANTHROPIC_BASE_URL`)。三测:(A) **对照**——`ANTHROPIC_AUTH_TOKEN=<乱码>` → **401 Invalid bearer token**(证明此 env 优先级真生效、没静默回退 keychain login,**对照有效**);(C) **spike**——同号**真订阅 token** 经 `ANTHROPIC_AUTH_TOKEN` → **401 Invalid bearer token**;(B) **复证**——**同一个真 token** 经 `CLAUDE_CODE_OAUTH_TOKEN` → **SUCCESS**(成功返回·token 本身有效)。**关键对比**:同一个真 token,经专用通道 SUCCESS、经通用 Bearer 通道 401。
- **根因**:订阅 OAuth token(`sk-ant-oat…`)只在专用 `CLAUDE_CODE_OAUTH_TOKEN` 通道生效——该通道附带了通用 `ANTHROPIC_AUTH_TOKEN`(= `Authorization: Bearer` 直注)/ `apiKeyHelper`(= `x-api-key` + `Authorization: Bearer` 双注)所**没有**的 OAuth 专属处理(很可能是 OAuth 特有的 header/beta 标记或 scope 协商)。因 apiKeyHelper 走的正是通用 Bearer/x-api-key 注入,对订阅 token 必然同样 401 → **apiKeyHelper 无重启换号对订阅号此路不通**。**grounding 核实(以仓库实读为准)**:`skills/account-management/scripts/switch-account.sh:685-686` 末行用的正是 `export CLAUDE_CODE_OAUTH_TOKEN="$OAUTH_TOKEN"; exec claude …`(专用通道 + exec 重启),印证「订阅 token 走专用通道」这一既有设计前提;更强的旁证在同脚本 `:584-585`——它**防御性 `unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN`**,注释明言「标准两名任一存在都会**顶掉** `CLAUDE_CODE_OAUTH_TOKEN`(阶梯⑤)→ 切号静默无效」,即仓库设计早已把通用 Bearer env 与专用 OAuth env 当作**两条互不相通的优先级阶梯**对待,与本 spike 实测一致。`AGENTS.md` 红线5 ship-anywhere 排除清单(Bedrock/Vertex/Foundry 是模型后端、非 CLI 宿主)可引。
- **影响**:**✅正向(实证 settle 了换号架构)**。结论链:(1) 此前基于 Claude Code 文档的推断是「OAuth 是 Bearer token、经 `ANTHROPIC_AUTH_TOKEN`/`apiKeyHelper` 应该能通」——**被本 spike 实测证伪(401)**,是 [[Finding #61]]「建造后必 dogfood 才可信」/ 镜头6「gate-green/纸面 ≠ 真成立」家族的又一兑现:连看似权威的文档推理也得实证落地才可信。(2) **架构定论(不再 speculative)**:**无重启换订阅号 = 必须前置代理**(Orca 式 `ANTHROPIC_BASE_URL` broker·代理持 OAuth token 在上游走专用通道,这正是 Orca 无缝换号的真因);**CC 原生免代理的换号只有 exec 重启 + resume 这个 Tier-2 floor**(现 `switch-account.sh`),其结构受限于「用户触发的 session 边界」——agent 自驱 pacing 换号(不重启)**无 CC 原生解**(订阅通道只剩 startup-immutable 的 `CLAUDE_CODE_OAUTH_TOKEN` + 交互式 `/login`)。
- **处置(含蒸馏判定)**:**蒸馏判定 = 记为永久 finding(实证基线)+ 架构结论判 ADR-candidate-待定**。换号架构「Tier-1 代理无重启 / Tier-2 exec-restart floor / cc-master 不自建 swap(指挥不演奏:换号**决策**归 cc-master、token swap **演奏**归 broker)」是结构性决策、**ADR 级**,但**当前不写 ADR**——待用户拍定 0.8.0 scope 微决 B1/B2 + post-0.8.0 代理集成方向后再落 ADR,避免记录未定的决策(adrs/AGENTS.md「别记未定的决策」)。本 finding 只记**实证事实**(哪条通道通/不通)这一不会变的地面真相。**不新增 skill prose / 红线**——这是机制实证,不是新行为规则;apiKeyHelper/通用 Bearer 对订阅 token 不通是「事实」非「纪律」,无需 Rationalization 行(同 [[Finding #61]]「baseline 不失败就不造未被违反的规则」防造纪律)。与 [[Finding #61]](dogfood 推翻纸面)、[[Finding #56]](第二视角抓纸面漏的真问题)同族,交叉引用。
- **严重度 / 来源**:✅正向(机制实证·settle 换号架构·文档推断被实测证伪)/ 一手(本轮用户授权下 token-blind spike 实测;通道事实经仓库 `switch-account.sh:584-585/685-686` grounding 核实)。

## Finding #68 — account-add 用 `claude setup-token` 录号是灾难级错源:① 重认证把用户登出(401) ② 结构上不产生 refreshToken(无重启换号死依赖它) → rework 为 keychain「Claude Code-credentials」直读完整 blob · ✅正向(机制验证·已端点验过) + 灾难级错源根除

- **现象**:account-add 录号的捕获源原本是 `claude setup-token`——真账号 dogfood 实测它是**坏的录号源**,两宗灾难:① **它重认证、覆写官方登录** → **把用户当前登录态登出**(后续官方调用 401),录个备号把主号工作态搞崩;② token-blind spike(只看字段名/布尔、绝不回显值)实测 `setup-token` 铸的 token **结构上不含 refreshToken**——而 cc-master 的无重启换号(switch 覆写官方共享凭证三存储、运行中 claude 惰性 re-read·[[Finding #67]] 之后的新机制)**死依赖 refreshToken** 续期(keychain blob 的 access token 仅 ~8h),拿不到 refreshToken = 切进去很快认证失败、换号形同虚设。
- **根因**:**`setup-token` ≠ `/login`,结构不同**。`setup-token` 铸的是**长寿命 headless token**(给 CI/headless 场景),走的不是交互式 `/login` 的完整 OAuth 授权码回环,故**不产生 refreshToken**、且其认证动作会**覆写**官方共享登录态(登出用户)。spike 进一步实证**捕获源应在哪**:token-blind 三测对比——(A) `~/.claude/.credentials.json` **文件**里 `claudeAiOauth.refreshToken` **字段在但值为空**(残缺副本);(B) macOS **keychain**「Claude Code-credentials」(`account=$USER`) 经 `security find-generic-password -w` 返回的 blob 是 `{accessToken(sk-ant-oat),refreshToken(sk-ant-ort·非空),expiresAt,scopes,subscriptionType,rateLimitTier}` = **完整 + 有效 refreshToken**。结论:**唯一可靠捕获源 = keychain「Claude Code-credentials」(account=$USER)**——不是文件、不是 setup-token;且只有真 `/login` 走完整 OAuth 才在 keychain 写下非空 refreshToken。
- **影响**:✅**正向(灾难级错源被真账号 dogfood 揪出并根除)**——这是 [[Finding #61]]/[[Finding #67]]「建造后必 dogfood 才可信、纸面/gate-green ≠ 真成立」家族的又一兑现:**测试全绿 + codex 三轮 review 都没逮到这个错源**——因为单测喂的是 mock/stub token、codex 静态读脚本看不出「setup-token 不给 refreshToken + 会登出用户」这种**只有真账号、真 keychain、真 OAuth 才暴露的 runtime 地基事实**(同 [[Finding #61]] 的 TTY 地基、[[Finding #62]] 的 locale 雷——纯 code 审难发现、真机才现形)。镜头6「只信端点验收」的又一活证:这次端点验收指向了**真 keychain**而非 mock,才戳穿假绿。坐实 charter ②/⑤ 的录号基础设施只有在真 agentic + 真账号下验过才可信。
- **处置(含蒸馏判定)**:**rework 为 keychain 直读**(已端点验过),落点二分——
  - **回流 production 脚本 `account-add.sh`**(本次未由我改、已实现+端点验过):捕获源改为 `security find-generic-password -w -s "Claude Code-credentials" -a "$USER" | node …`(token-blind 经管道直读完整 blob),严格校验**非空 refreshToken**(取不到 → FAIL + 提示「多半没真 `/login`、setup-token 不给 refreshToken → 请 Orca/claude login 登录后重跑」,绝不存残缺 blob);只读不写官方凭证 → **不扰动用户登录**(旧 setup-token 登出副作用整套 moot,无需快照/恢复登录);新增**身份匹配 guard**(读 `~/.claude.json` oauthAccount.emailAddress 须 == `--email`,防把当前登录号 B 的 blob 错标成 A);非 mac fallback 读 credentials.json 文件(但其 refreshToken 可能空·校验拦下)。
  - **回流文档(本次蒸馏落点)**:`commands/accounts.md` §4(add/refresh 段重写为 keychain 直读 UX、删 setup-token/PTY/浏览器/TTY 整段 moot 内容)+ `skills/account-management/SKILL.md`(四件事表「录号/续期」行 + 「录号机制:keychain 直读」段 + token-blind 命门 #2 改为 keychain 读管道喂 node)+ `references/vault-security.md`(捕获源 + agentic 录号安全闭环改 keychain 直读)。
  - **TDD-for-skills baseline 结果(诚实标注)**:SKILL.md 新增的「身份匹配 guard——要录 X 必须当前登录在 X」是判断型 prose,跑了一遍 §6 pressure baseline(三压:11:47pm 交付窗口 13min 后关 + 11h 沉没成本 + 疲惫,强制 A/B 二选「直接录(机制能跑通会成功退出) vs 停下 surface 用户」)——**baseline 未失败(RED 不成立)**:强模型正确选了「停下、不录、surface 用户」(选项 B),明确驳回「机制能跑通 = 务实赶窗口」的合理化(识破「成功退出 ≠ 语义正确」「沉没成本谬误」「录入凭进号池是不可逆 + 污染共享基础设施的写操作、红线4 延伸须先问用户」),甚至自行推导出「脚本该自身固化这道 guard」。**故按 [[Finding #26]]/[[Finding #55]]/[[Finding #61]] 防造纪律,不为身份 guard 造 Rationalization Table / 红旗行**(强模型天花板·baseline 不失败就不编造未被违反的规则);身份 guard 已是**脚本自身固化的护栏**(account-add.sh 读 blob 前硬 guard),文档以**机制知识形态**(how-to/why)记录,不靠纪律闸守。
  - **不另开红线**:换号「无重启凭证覆写」(switch 覆写官方三存储·运行中 claude 惰性 re-read)是 [[Finding #67]] 之后的新机制,本 finding 顺带把 `cost-and-pacing.md` 的换号 lever 从旧「drain→换 token→exec 重启→`--resume` 续板」7 步改为「无重启凭证覆写」4 步(在飞工作不再骑在换号边上、无孤儿 reconcile)——这是机制叙述更新,非新纪律。
- **严重度 / 来源**:✅正向(机制验证·灾难级错源根除·已端点验过)/ 一手(真账号 dogfood + token-blind spike 实测;rework 已实现+端点验过,本轮我只同步文档·未改 production 脚本)。

## Finding #69 — keychain 写 OAuth blob 用 `security -w` 从 stdin 读 → readpassphrase 硬截 128 字节 → vault 存成残片(丢 refreshToken·非法 JSON);3 处中招含官方 store 覆写(会 brick 登录);测试全绿因 `security` stub「存啥读啥」没建模 128 截断 · ✅正向(根因级·真 switch dogfood 揪出) + faithful-stub 纪律

- **现象**:无重启换号的 **switch 路第一次真跑**(此前 add 路反复阻塞、switch 从未端到端 dogfood),`switch-account.sh --email <A>` 当场失败两症:① `refresh: vault blob 非法 JSON`(从号池读 A 的 blob JSON.parse 失败,而 A 是当天刚 keychain 直读录入的、本该合法);② `line 1029: refresh_rc�: unbound variable`(bash 崩)。**token-blind 结构探针**(只报长度/起始/key 名布尔、绝不回显值)实测:A 与 B 的号池 vault blob **都恰好 128 字节、含 `accessToken` key 但不含 `refreshToken` key、非法 JSON**;同机官方「Claude Code-credentials」blob 471 字节、两个 key 都在、合法。→ 号池里是个 **128 字节就被砍断的 JSON 残片**。
- **根因**:macOS `security add-generic-password -w`(**末位不带值、从 stdin 读密码**)走 `readpassphrase`,**硬上限 128 字节**。完整 OAuth blob ~471 字节 → 写进去只剩前 128 字节(`{"...accessToken":"sk-ant-oat01-<砍断>`,还没写到 refreshToken)。**假数据 spike(纯 dummy·零真 token)铁证**:同一 446 字节 dummy,stdin 双喂 `printf '%s\n%s\n'|security -w`→readback **128 截断**;stdin 单喂→**0**(readpassphrase 需换行结尾);`security -w "$值"`(**值作 argv 参数**)→readback **446 完整 + parseOK**。**3 处全中招同写法**:① `account-add.sh:store_blob_keychain`(L299·已证实存成 128 残片)② `switch-account.sh:writeback_vault` keychain 分支(L689)③ `switch-account.sh` 官方 store ③ 覆写(L908·**最危险**:把 `{"claudeAiOauth":{...}}` 截成 128 残片写进**官方登录** keychain → claude 读不出 → **brick 登录**,且 `security` 返 0 不触发 L912 那段"③ 失败回滚①②"→ 静默灾难)。这次纯靠 switch 先在 vault 的"非法 JSON"处栽了、没走到覆写官方那步,才**侥幸没 brick 登录**。附带的 `$refresh_rc·`(L1029·`$var` 紧贴中点 U+00B7)是同源 locale 雷([[Finding #62]] 家族):某些 locale 下 bash 把多字节首字节 `0xC2` 吞进变量名 → `set -u` unbound 崩。
- **影响**:✅**正向(根因级 bug 被真 switch dogfood 揪出)**——又一条 [[Finding #61]]/[[Finding #68]]「建造后必 dogfood 才可信、纸面/gate-green ≠ 真成立」铁证,且**比同族更触目**:此 bug 让无重启换号的**核心动作(凭证覆写)结构上不可能成功**,且潜伏着 brick 用户登录的灾难,却**测试全绿 + codex 多轮 review([[Finding #66]] 的 8+ P2)全漏**。漏因双层:(1) **`security` stub「存啥读啥」没建模 128 截断**——单测喂的写/读对称,真实 readpassphrase 的 128 cap 在 stub 里不存在,故 stdin 写法在测试里"正确"、在真机截断(同 [[Finding #61]] TTY 地基、[[Finding #62]] locale 雷:mock/静态审看不见、真机才现形);(2) **缺真 round-trip 测试**(写完整 blob→读回→断言完整长度+合法 JSON+含 refreshToken)——没有这道"写进去能不能原样读出来"的断言,128 截断就无人把守。codex 静态读脚本看不出 readpassphrase 的字节上限(那是 `security` 二进制的运行时行为、非脚本文本可见)。坐实 charter ②/⑤(无重启换号基础设施 + 验收质量)只有真账号 + 真 keychain round-trip 验过才可信。
- **处置(含蒸馏判定)**:**修复(TR30·派发 sub-agent 实现中,本 finding 写于修复在飞期)**——
  - **回流 production 脚本**:3 处 keychain 写全改 `security add-generic-password -U … -w "$blob"`(**值作 argv 参数**,保留 `-U`/`-l`);修 L1029 → `${refresh_rc}` 花括号定界 + 扫两脚本所有可执行行 `$var` 紧贴非 ASCII 全花括号化;修正"blob 经 stdin 喂、不进 argv"那批误导注释为新 argv 姿态。
  - **回流测试纪律(本条核心蒸馏)= faithful-stub + round-trip 双防线**:`security` stub **忠实建模真实行为**(stdin `-w` 无值 → 只存前 128 字节模拟 readpassphrase 截断;`-w "<值>"` argv → 存完整);加 round-trip 断言用例(生产写路径存 >128 字节 dummy → 读回 → 断言完整+合法 JSON+含 refreshToken)+ 反向断言(旧 stdin 写法在 faithful stub 下应给 128 截断,锁死回归)。**教训普适化**:**stub 撒谎 = 假绿之源**——stub 必须忠实建模被 stub 物的**会咬人的真实行为边界**(字节上限/截断/错误码),否则测试只在验"我以为它怎么работает",不在验真实;凡 stub 外部二进制(`security`/`claude`/`codex`)的写路径,**都得配一条真 round-trip 或 faithful-stub 断言**(候选回流 `references/resume-verify.md` 端点验收小节、与 [[Finding #65]]"验对象须真消费产物"同族·不同维度=验**手段**须忠实 vs 验**对象**须真)。
  - **设计抉择(用户拍 A·token-blind 红线细化)**:官方「Claude Code-credentials」条目**必须单条完整 blob**(claude 用 Keychain API 当一条读、**不可 chunk**)→ `security` CLI 写完整 >128 字节**唯一办法是值作 argv 参数**(`-w "$值"`),而那让 token 在 `security` 进程存活的几毫秒出现在 `ps` 可见 argv,与 token-blind 铁律字面冲突。用户拍 **A**:铁律细化为「**token 绝不进 agent context / transcript / log / registry**」(这才是铁律真正要防的——token 落进 agent 上下文会被模型侧记录/持久化/外泄),**接受写 keychain 时 token 经 `security` 子进程 argv 的 sub-second 本机局部暴露**(可读你 argv 的同用户攻击者本就能直接读你的 keychain 与 0600 凭证文件、非新暴露面;B 选项=造 Swift Keychain-API helper 避 argv 被判过度工程:依赖 Xcode CLT 不保证在、加编译产物、脆)。**蒸馏判定 = 此为 ADR-candidate**(token-blind 边界从"绝不经 argv"细化为"绝不进 agent context,接受写 OS keychain 的局部 argv")——结构性安全决策,但**待 TR30 修复落地 + 端点验 + codex 二审通过后再落 ADR**(adrs/AGENTS.md「别记未定的决策」);本 finding 先记**实证事实 + 已拍抉择**这一不会变的地面真相。
- **严重度 / 来源**:✅正向(根因级·无重启换号核心动作的结构性 bug + brick-登录灾难潜伏被真 switch dogfood 揪出·测试全绿+codex 多轮全漏)/ 一手(本轮真账号 switch dogfood·token-blind 结构探针 + 假数据 keychain 写法 spike 实测;修复 TR30 派发中)。

## Finding #70 — board-graph CLI 进 skill prose(PR-3):强模型 baseline 是天花板(RED 没失守)→ prose 价值 = trigger/consistency/显式判据(为退化/compaction 后 agent 补具名),非堵合理化 ✅正向(天花板·诚实不造红线)

- **现象**:`board-graph.js`(机器算临界路径/float/并行度/impact/rollup 的运行时带外 CLI)早已实现并 ship 到 `skills/master-orchestrator-guide/scripts/`,但 grep 全 prose **零命中**——它就是 `status.md` / `decomposition.md` 里那句「要真算 float 请走带外脚本」中那个**无名脚本**。PR-3 把它具名化、织进魂与 references 的指针网前,先按 §6 TDD-for-skills 跑 pressure baseline(三压:time + sunk cost + exhaustion),验「没有该 prose 时 agent 会不会选错」。**baseline 结果 = 强模型天花板,RED 没失守**:强 agent 会(a)自己发现 `board-graph.js` 这个工具存在、(b)用「拓扑复杂度」自发判心算 vs 机器算(大钻石图升级机器算、平凡单链心算)、(c)不在平凡图上仪式性跑 CLI(自带反 busywork 直觉·镜头 4)。即:加判据 prose 前,强模型本就大致选对。
- **根因**:① **强模型天花板**——「该不该跑一个分析工具」是强模型从既有镜头(2 拆图 / 3 并行度 / 4 反 busywork)能自洽推出的判断,**没有一条 rationalization 在强模型下稳定把它合理化掉**(不同于 [[Finding #46]] 的 phantom in_flight、[[Finding #44]] 的假串行边那种压力下反复复发的真红线)。故判据段若按「堵合理化」写重型 Rationalization Table / Red Flags,会**造一条强模型不需要的红线**(违 Iron Law·稀释每回合重注的魂),同 [[Finding #55]]/[[Finding #26]] 的防造纪律。② **但天花板 ≠ prose 无价值**——价值轴换了:(a) **trigger / discoverability**——退化模型 / compaction 后细节蚀掉的 agent **发现不了一个 prose 从不具名的工具**;`status.md` 此前只说「走带外脚本」不点名 `board-graph.js`,这个不具名旁注 = 退化 agent 的 discoverability 缺口(它不会去 `ls scripts/` 翻一个没人告诉它存在的脚本);(b) **consistency**——具名 + 统一判据让强弱模型、跨 session、跨 compaction 都拿到同一套「拓扑复杂时机器算 / 平凡时心算」口径,不靠每个 agent 各自重新发现;(c) **显式判据**——把「拓扑复杂度」这个锚显式写下,比让每个 agent 私下心算「这图算不算复杂」更稳。
- **影响**:✅正向——给「**prose 价值不止『堵合理化』一种**」添一条活证据:当 baseline 证明强模型本就选对(天花板),正确处置**不是不写 prose**(那会丢掉 trigger/consistency/discoverability),**也不是按堵漏写重型纪律**(那会造强模型不需的红线),**而是按 trigger/reference 写**——具名工具 + 中性判据 + 显式锚,服务退化/compaction 后的 agent 与跨 session 一致性。与 [[Finding #55]](baseline RED held → 不造红旗)同族但**结论分叉**:#55 的处置是「仅作正向素材、不新增 prose」(已有 SSOT 覆盖),本条是「新增 prose 但按 trigger 而非堵漏写」(工具此前**零 prose 具名** = 真有 discoverability 缺口要补)。这条分叉本身是蒸馏物:**「baseline RED held」不等价于「不写 prose」——还要看缺的是『堵漏』还是『trigger/具名』**。
- **处置(含蒸馏判定)**:**PR-3 已落地,按 trigger/reference 写、不写堵漏**——① 新建 `references/graph-analysis.md`(工具 SSOT:§1 它是什么/落点/不是什么 · §2 怎么调(`${CLAUDE_*}` 绝对引用各 `--cmd`)· §3 CPM 诚实性 `weight_source` measured/mixed/unit/cycle · §4 owner rollup 衔接(gate 在 hook、advisory 在 CLI、概念在 board.md)· §5 ★何时机器算 vs 心算判据(**拓扑复杂度锚·两侧**:非平凡交错 fork/join 钻石图 → 机器算;平凡单链/小图 → 心算够用、跑 CLI 反 busywork·违镜头 4)· §6 诚实天花板 + 不是 gate);与 `decomposition.md` **严格单向引用**(概念 SSOT ↔ 工具 SSOT、绝不双向复述·守 [[Finding #7]] 收敛)。② 魂(SKILL.md)只加**两条中性指针**(镜头 2 临界路径/float、镜头 3 T₁/T∞),措辞「可心算可机器算」——**绝不暗示机器算更优 / 心算是偷懒**(否则诱导平凡图过度跑工具),≤2 行净增(魂每回合重注·越短越好)。③ `status.md` §3 把「带外脚本」具名为 `board-graph.js`(命令体祈使语气·Finding #43),保留心算默认快路径 + 给具名出口。④ `decomposition.md`/`dispatch.md`/`external-coordinates.md` 各加单向指针 / 导航条目。**蒸馏判定 = 判据 prose 入 reference(按需读),不进魂**——判据是 judgment-bearing 但非高频踩坑红线,进魂 = 过载常驻手册(两侧悬崖里的「过载魂」侧);魂只留「工具存在 + 在哪读」的指针。**不写重型 Rationalization Table / Red Flags**(强模型不靠它纠错、没有 RED 失败可堵·守 Iron Law)。
- **严重度 / 来源**:✅正向(天花板·诚实不造红线·prose 价值轴 = trigger/consistency/显式判据)/ 一手(PR-3 baseline + 集成实录·强模型 baseline RED held)。

## Finding #71 — TF2「全仓升 ${CLAUDE_SKILL_DIR}」前提错:markdown **文档互链**须保持相对(skill-lint 死链检查强制 + GitHub 渲染需要),${CLAUDE_*} 只给 prose 里 agent 当**字面执行**的脚本引用 · ❌→端点验收当场纠正

- **现象**:0.9.0 收口的 TF2(用户拍方向=「全仓统一升 `${CLAUDE_SKILL_DIR}`」)按记录 scope「把分发 skill 里裸 `[text](references/x.md)` 链接升为 `${CLAUDE_SKILL_DIR}/references/x.md`」执行——把 `account-management/SKILL.md` 的 5 个 markdown 文档互链 target 升成 `${CLAUDE_SKILL_DIR}/references/x.md`。改动**看似合理**(对齐 §12「skill 引用自己目录资产用 `${CLAUDE_SKILL_DIR}`」),但**重跑端点闸即 FAIL**:`skill-lint: FAILED — 5 violation(s)`,逐条 `dead link → ${CLAUDE_SKILL_DIR}/references/x.md (no file ... relative to this skill)`;run-tests 连带 FAILED。
- **根因**:**§12 的 `${CLAUDE_*}` 要求被误推广到了 markdown 文档互链上**。两类引用本质不同:① **prose 里 agent 当字面路径执行/读取的引用**(如「跑 `node ${CLAUDE_PLUGIN_ROOT}/skills/.../board-graph.js`」、跨 skill 脚本)——装机后相对用户 cwd 解析会死链,**必须** `${CLAUDE_*}`(Finding #38/#39/#50 的本体);② **markdown 文档互链** `[text](references/x.md)`——GitHub 按文件位置相对渲染成可点链接、skill-lint 有一道**死链检查**(把 link target 当相对 skill 目录的真实文件去解析、解析不到即违规)。对②,**相对路径才是正确形态**:`${CLAUDE_SKILL_DIR}/references/x.md` 在 lint 时不是真实文件(env 未展开)→ 死链,在 GitHub 上也渲染不成可点链接。即 §12 的 `${CLAUDE_SKILL_DIR}` 适用①不适用②,TF2 把它套到②上**与 skill-lint 死链检查正面冲突**。
- **影响**:✅正向(端点验收当场抓住·零外泄)——又一条「看似成功 ≠ 真成功 / 只信端点验收」铁证(同 [[Finding #61]]/[[Finding #68]] 家族):改动**纸面对齐 §12 字面**、`git diff` 看着干净,唯有**重跑 skill-lint/run-tests** 才暴露它破坏死链检查。也澄清了一个易混边界:**「自包含」对脚本执行引用 = `${CLAUDE_*}`,对文档互链 = 相对路径**——两者治的不是同一种断链(前者防 cwd 解析死链、后者本就靠相对解析且被 skill-lint 守)。TF2 的记录前提(「markdown 链接升 `${CLAUDE_SKILL_DIR}`」)本身有误,非执行失误。
- **处置(含蒸馏判定)**:**当场 revert**(5 链接全回相对·重跑闸恢复 `ALL TESTS PASSED` + `skill-lint 0 violations`);**TF2 判为 no-op**(分发 skill 的 markdown 文档互链本就该相对、已正确、skill-lint 一直在守;orchestrating 魂 + authoring 用反引号 prose 提及更非链接,升它们既无必要又会胀魂)。CHANGELOG 的 TF2「Changed」条目撤除。**蒸馏判定**:此为**边界澄清**而非新纪律——§12 已隐含「文档互链相对、脚本执行引用 `${CLAUDE_*}`」(skill-lint check(4) 只查跨 skill **裸**引用、死链检查守文档互链相对解析),无需新增 prose;但**值得在 AGENTS.md §12 一句话点明这条二分**(候选:scripts 执行引用 vs markdown 文档互链的不同自包含形态),免再误推广。**不回流为红线**(skill-lint 已机械守住、再加 prose 是冗余)。
- **严重度 / 来源**:✅正向(端点验收当场纠正·边界澄清)/ 一手(0.9.0 TF2 执行实录·skill-lint 死链检查暴露)。

## Finding #72 — account switch 一号切入-切出后下次再切入 token 失效(rc=4):根因=vault↔官方存储**单向失同步**(claude 自主 refresh 轮转 RT、写官方存储但绝不回流 vault)→ 切出 token 抢救修复 · 🔧根因级(机制 hermetic + 真账号 live spike 双验·端到端通过)

- **现象**:号池里「用过的号」逐个变切不进的死号——某号切入用一阵、切出换别号后,下次再想切回它,`switch-account.sh` 主动 refresh 即 `rc=4`(oauth 端点拒绝 refresh token)、硬失败不覆写任何存储,该号实质 brick(需手动 `--refresh` 重录完整 blob 才能再切入)。
- **根因**:cc-master vault 是官方共享凭证存储的**一次性快照副本**(录号那刻从官方 keychain「Claude Code-credentials」拷来)。换号 token 数据流本是**单向**的——切入号方向**闭环**(refresh → writeback 切入号 vault → 覆写官方存储),但**缺反向回流**:运行中的 claude 在 access token 临近过期(~8h)时**自己惰性 refresh**(无重启换号架构正依赖此行为),服务端**轮转 refresh token**(旧的吊销、发新的),claude 把新 blob 写回**官方存储**(`account=$USER`)、却**绝不**回流 cc-master vault(claude 不知 vault 存在);切出时也只写 token-blind 配额快照、**不抢救 token**。于是切出号 vault 停在「切入那刻 writeback 的值」、其 refresh token 早被 claude 自主轮转吊销 → 下次切入用它即 refresh 失败(rc=4)。
- **影响**:🔧根因级——号池随使用**单调退化**,每个号切出一轮就有变死号风险,违背「号池可循环复用」的核心价值;修前唯一缓解 = 每次切回前手动 `--refresh`(违背自动化初衷)。
- **处置(含蒸馏判定)**:加 `rescue_switchout_token`——覆写官方存储**之前**(此刻 `account=$USER` 仍是切出号被 claude 更新到最新的 blob)把它读出(mac keychain 主路径 + credentials.json fallback·解包 `.claudeAiOauth` 成 vault 期望的裸 blob)→ **身份 guard**(`~/.claude.json` `oauthAccount.emailAddress` 须==切出号·防把别号 token 写进切出号 vault 污染号池)→ token-blind 回写**切出号** vault(参数化 `writeback_vault` 接受目标号 vault 上下文),补「官方存储 → 切出号 vault」反向流、与既有「切入号 vault → 官方存储」闭环。best-effort(无切出号 / 读不到有效 blob / 身份不匹配 / 回写失败任一步仅告警跳过·绝不阻断换号)。机制 hermetic 验证(`tests/hooks/test_switch-select.sh` case 31 抢救 happy-path + 31b 身份 guard·反向 teeth 验过:禁用抢救则 31 CORE 转红)。**蒸馏判定**:机制层落 `references/vault-security.md` 切出抢救小节 + `SKILL.md` 换号流程(红线3:换号机制归 account-management·决策无需介入「自动 best-effort」·不进 orchestrating 魂);**不回流为红线**(best-effort 机制·非纪律约束)。
- **✅ 已坐实(真账号 live spike·2026-06-25·本 session 亲跑端到端)**:repo 脚本 + 真 keychain + 真 OAuth 端点(`platform.claude.com/v1/oauth/token`)、token-blind(只比 RT 的 sha12·全程 recovery 备份)、收尾还原原 active·零遗留死号。逐环:① **端点轮转坐实**——切入 cc-02 时 switch-in refresh 把 RT 轮转(rt_sha `b3d73b2ed219`→`0a0829cfc70a`·旧 RT 独立 refresh 返 **HTTP 400** = 服务端已吊销),证 Finding #72 病根机制(refresh 轮转+吊销旧 RT)为真;② **人为造病根态**——把已吊销旧 RT 写回 cc-02 vault → vault=死 / 官方=活;③ **rescue 治愈**——切出 cc-02 时 rescue 把官方活 RT 救回 cc-02 vault(rt_sha 死→活·日志实证`rescue: 已把官方存储最新 blob 回写切出号`);④ **死号复活**——切回 cc-02 **rc=0 成功**(修前此步必 rc=4)。鉴别力 airtight:旧 RT 已证 HTTP 400 死透 + hermetic 反向 teeth,双证「无 rescue 则不治愈」。**唯一未直接观测**(已由「用户原始死号现象 + 端点轮转坐实」联合强蕴含):claude **自主** refresh 写回官方存储那一环(spike 用切换机制模拟)——claude 要持续工作必把新 RT 持久化到官方存储(其唯一持久处),残留缺口极小;100% 闭合可选 8h 被动 dogfood。即便端点某情形不轮转,把官方最新 blob 回写 vault 也**幂等无害**(修复不依赖该确定性)。
- **严重度 / 来源**:🔧根因级修复(机制 hermetic + **真账号 live spike 双验**·premise 端点轮转当场坐实)/ 一手(真 switch 死号现象 + 跨 session 续作:实现实为**本** session 据 `vault-security.md` 存活设计从零落地——前序 session 在**严重信道污染**下误把「函数已实现 + 测试曾全绿」记进 memory 为 done,实则 git/grep 地面真相显示函数从未落盘、测试 case 不存在,唯独立只读核实戳穿·[[Finding #64]] 家族「自报成功 ≠ 地面真相·只信端点验收」的又一活体)。

## Finding #73 — board v2 hook 收编(bash→node):JSON.parse 根除 awk-深扫盲区(一整类)+ 并行 subagent 移植 + cksum 指纹字节级复现 + 端点亲验 · ✅正向(收编真红利 + 行为等价纪律)

- **现象**:v0.10.0 board v2 迁移把 `reinject` / `verify-board` / `posttool-batch` 三个 bash hook 收编为 node(`.sh`→`.js`,经共享 `hook-common.js` + `board-model`)。v1 这三个 hook 各自带一份手写 awk「字符串/转义/方括号双深度」扫描(`owner_region` / `tasks_region` / `pending_user_decisions` / `owner_wip_violations`)——存在的唯一理由就是**避免全文 grep 把 agent-shaped 载荷里的字段误读为顶层**(归档板 `log[]` 嵌套 `"active":true` 冒充 owner·CODEX7;task-local `log[]` 里的 `"status":"stale"` 冒充顶层 task·reinject Case J/Q;nested `wip_limit` 冒充板级·posttool codex round-2)。收编后 **node `JSON.parse` + 直接读 `board.owner.active` / 遍历 `board.tasks`** 让「嵌套字段不冒充顶层」**结构上天然成立**——一整类误读盲区由数据模型解析根除,数百行 awk 体操归零(reinject 213→? · verify-board 665→337 · posttool 381→149 行)。三 hook 测试 + 全套 `run-tests.sh` + `plugin validate` 全绿。
- **根因 / 机制**:① **awl-手写-扫描是 [[Finding #5]] 家族的脆弱面**——「用 awk 串解析 JSON 避全文 grep 误判」本就是 ADR-006 点名「deps 图/结构校验该用 node」的同类用例;每个 bash hook 一份扫描 = 多份漂移 + 每份都是误读盲区的温床。`JSON.parse` 是这类的正解:解析忠实于结构,「嵌套 ≠ 顶层」不靠手写深度计数而靠语言。这是 [[Finding #61]]/[[Finding #69]]「stub/手写解析撒谎 = 假绿之源」的**对偶正面**——忠实解析根除一类误判。② **但收编 ≠ 无脑替换**——`verify-board` 的 Stop 指纹握手(`.stopcheck` sidecar 跨回合/跨 session 比对「完成态有没有变」)依赖 **POSIX `cksum`(CRC-32)字节级一致**:换 node 必须**字节复现** CRC-32(poly 0x04C11DB7 / MSB-first / 长度附加)+ 指纹输入逐行重建(板按名排序=glob 序、token 按 object-key 序),并对真 `cksum` 验过字节对齐——否则跨 session 指纹不匹配 → 每次都多走一次自检握手(fail-safe 方向,但非等价)。**「行为等价移植」里真正承重的不是『重写更干净』,是『字节级复现 load-bearing 行为』**。
- **影响**:✅正向——(a) 给「收编消除漂移」添一条根因级活证据:JSON.parse 根除的不是「一个 bug」,是**一整类** awk-误读盲区(CODEX7 + Case J/Q + nested-field 冒充);(b) 验证了「**并行 subagent 大移植 + orchestrator 端点亲验**」这条编排范式在真任务上成立——两个文件互斥的 hook(posttool/verify-board)并行派 sub-agent,各带 canonical 范式(`reinject.js` + `hook-common.js`)+ **各自的大测试套当规格兼安全网**,orchestrator 不信 leaf 自报、端点亲跑全套 `run-tests.sh` + `plugin validate`([[Finding #12]] 并行后端点必跑全套);(c) 三个 sub-agent 都**诚实标注了判断点**(指纹空白边差异走 fail-safe 方向 / watchdog `board.watchdog` 优先 `wakeup` fallback / empty-board 定义比 v1 更严)——judgment_calls「自决 + 可逆披露」姿态的真实预演。
- **处置(含蒸馏判定)**:**收编落地 + 全绿 + ADR-013 转 Accepted**。蒸馏三条——① **「字节级 load-bearing 行为(如 cksum 指纹)跨语言移植时,必须对原实现真验字节对齐」**(候选回流 `references/resume-verify.md` 端点验收小节,与 [[Finding #69]]「stub 须忠实建模会咬人的真实边界」同族:这里是「移植须忠实复现会咬人的字节契约」);② **「bash hook 串解析 JSON → 优先 node JSON.parse」**已是 ADR-006 精神,本 finding 坐实其根除「嵌套冒充顶层」一整类盲区的红利(不新增红线,作 ADR-006 的正向案例);③ **武装闸集中化**(`hook-common.js` 的 `isArmed`/`boardMatches`/`listMatchingBoards`)使红线 6 grep 门 pattern 演进加 `listMatchingBoards`(已记 AGENTS.md §3 v2 收编补)——「机制集中化 → 代理检查随之更新、红线语义不弱化」(类比 ADR-006 更新「no node」)。**遗留 follow-up(非回流红线)**:`design_docs/mechanisms/hook-{reinject,verify-board,posttool-batch}.md` 的 body 仍描述 awk 内部(category/源码路径已改 node·body 内部待刷)。
- **严重度 / 来源**:✅正向(收编真红利根因级 + 并行 subagent 移植 + 字节级等价纪律)/ 一手(v0.10.0 P4.6 收编实录·三 sub-agent 并行 + orchestrator 端点亲验全绿)。

## Finding #74 — Track A 触发 eval 对「建议型」cc-master skill 是结构性死信道(loaded-env floor):不可作 description 发布门,质量靠 pressure baseline(定性)+ 兄弟 Do-NOT-use 定性 review 守 · 中(工具效率·eval 可信度)

- **现象**:对 `using-ccm` / `slicing-goals-into-dags` / `dev-as-ml-loop` 跑 Track A(各 28-29 query × 3 run),结果是铁律式 pattern——**每个 positive(should_trigger=true)rate≈0/3,每个 negative 平凡 PASS**,accuracy≈50% 全是「negative 凑数过 + positive 集体趴地板」,对 description 质量**零信息量**。
- **根因 / 机制**:正中 eval README 2026-06-10 记录的 floor 三因——① `run_eval` 的 `find_project_root()` 走到 `$HOME`、`claude -p` 带用户全局栈(全局 CLAUDE.md + ~100 个竞争 skill)当噪声;② 当前模型对「建议型 query」(怎么拆 / 该不该 / 怎么写好)直接凭知识回答、**不去 invoke 一个 body 只是 description 的 stub command**(连 `--bare` 也复现 0);③ 检测器在**首个** tool_use 即判 False。cc-master 这批 skill 全是 advice-shaped,query 必是建议型 → 结构上踩满 floor。
- **影响**:Track A 对这类 skill **结构性失灵**;before/after 同坐 floor 时比对无意义,盲调 description 会拟合死信道。诚实标注:用户点名关切的「dev-as-ml-loop 不被纯 ML 理论题误触发」在 floor 上两条 ML-理论 near-miss negative 都 PASS(没误触发)——**无红旗但属弱证据**(floor 上啥都不触发)。
- **处置(含蒸馏判定)**:蒸馏——**「建议型 cc-master skill 的 description 质量,靠 ① pressure baseline(定性:确认堵哪条 rationalization)+ ② 兄弟 skill Do-NOT-use 子句交叉的定性 review 守;Track A 仅在隔离 eval 环境(非 loaded $HOME)才有信号,不作 description 改动的发布门」**。回流落点:`grounding-skill-evals` 的「Track A 天花板」段已述 floor,本 finding 把结论从「可能塌成 0」坐实为「对**全部建议型 cc-master skill** 结构性死、故不作发布门」(候选补一句进该 skill;不新增红线)。**不回流**为硬门——它本就非 CI 门。
- **严重度 / 来源**:中(工具效率·eval 可信度)/ 一手(v0.10.0 D/E/F 三 skill Track A 实跑,全坐 floor)。

## Finding #75 — 面向「一次写对」的派生操作手册,校验规则要给**全集**(从引擎 lint SSOT 逐条对账)而非抽样;且全集表是机械派生物、必进抗漂移锁步面 · ✅正向(效率根因 + 抗漂移闭环)

- **现象**:`using-ccm` 升级「一体两面」时,面2 `board-model-guide.md` 初稿按「概念 / 字段 gap」组织,只覆盖了 **18/43** 条 FMT/GRAPH/BIZ 校验规则(只覆盖被 16 条 gap 点到的);用户一针见血:agent 用 CLI 编辑字段时会撞**未列规则**反复 `exit 3` 低效重试。引擎 `board-lint-core.ts` 实有 43 条。
- **根因 / 机制**:操作手册按「内容主题」组织,自然只覆盖被点名的规则——但「一次写对、不试错」这个目标要求的是规则的 **closure(全集)**,不是抽样。漏的 25 条(`FMT-ACCEPTANCE` / `FMT-DEPS` / `FMT-ESTIMATE` / `FMT-EXECUTOR` / `FMT-ID` / `FMT-TYPE` / `BIZ-TIME-ORDER` / `BIZ-DECISION-PACKAGE` …)恰是 agent 编辑字段最常碰的。**消灭试错的前提是规则可穷举且已穷举**。
- **影响**:✅正向——补一节「校验规则全集速查」(每条 `id / level / 触发 / 怎么一次写对`),**从引擎 `board-lint-core.ts` + `board-model.ts` 的 `INVARIANTS` 逐条对账**(`comm` 比对确认零漏零编造、level 从 `INVARIANTS` 的 `level` 字段取不靠猜)。但全集表是**机械事实** → 引擎改一条规则它必漂 → 已纳入 §6 `ccm ⟷ using-ccm` 抗漂移锁步面(引擎改一条规则 / 字段 tier,board-model-guide 规则表必同步一条)。**顺带**:发现 `board.md` 残留 `schema cc-master/v1`(引擎 + 全部测试 canonical 为 `v2`)——SSOT 归位(`@ccm/engine` board-model 为协议 canonical SSOT、board.md 降派生叙事)后**派生叙事滞后引擎**的一个实例,修正 + 印证「board.md 非 SSOT、须跟引擎走」。
- **处置(含蒸馏判定)**:蒸馏——**「面向『一次写对』的派生操作手册,校验/约束规则给全集(从引擎 lint SSOT 逐条对账生成),不是抽样;全集表是机械派生物,必进抗漂移锁步面」**。已回流:AGENTS.md §6 锁步段(把 `board-model-guide.md` 规则表列入 ccm 改 lint 规则时的同 PR 同步面)+ `using-ccm/.design/DESIGN.md` 演化锚。✅机制验证。
- **严重度 / 来源**:✅正向(效率根因 + 抗漂移闭环)/ 一手(v0.10.0 using-ccm 一体两面 dogfood·用户实测「撞规则反复试错」痛点驱动)。

## Finding #76 — codex 独立第二评委 9 轮逮 27 真问题(含 1 P1)全是我单层端点全绿漏网的:坐实「看似成功≠真成功」+ completeness-sweep 收敛更快 + 深子系统长尾不收敛时 ship 阈值是**用户决策** · ✅正向(成功机制根因级验证)+ 中(flaky 计时测试污染整合门 / tail 截断藏真因)

- **现象**:v0.10.0 两轨(board.policy + usage/estimate 引擎)实现完毕后进 codex 硬化收尾。我自己的端点门**每轮全绿**(ccm 400+ 测试 / `run-tests.sh` ALL PASSED / `plugin validate` / `skill-lint`),但 `codex-review.sh --base 02fe681` 作独立第二评委**逐层揪出 9 轮共 27 个真 correctness 问题(含 1 个 P1 安全)**,全是单层端点全绿漏网的:单位口径裂(3 站)/ conformal 双重 calibration / 文档化 flag 静默忽略 / 过期窗口误判 / `--as-of` backtest 泄漏(多站)/ CCM_BIN 绕过 / policy 闸读错板(P1)/ policy 闸跑在 vault 读之后(least-privilege)/ calibration 按 raw 记录数选层 / token VAC 量纲错乱 / throughput 漏算闲置日……findings **逐轮 narrow**(新类→sibling 遗漏→被 completeness-sweep 预清)**但没收敛到零**:R6(1P1+2P2)→R7(1P2+1P3)→R8(2P2)→R9(2P2),最终**用户拍板「修完即 ship」止于 R9**(不跑 round10)。
- **根因 / 机制**:① **单层端点验收(哪怕 gate 全绿)对 subtle correctness 系统性失明**——测试没覆盖的语义 bug、self-report 乐观、实现理解与落地偏差,都让一道「绿」骗过你。这是 SKILL A 镜头 6「看似成功≠真成功·第二视角必要」的活体(本场是其最强证据:每轮我全绿、codex 仍逮真 bug)。② **completeness-critic sweep 比 per-finding whack-a-mole 收敛快**——codex 揪一个 finding 后,fix agent 顺带审计全 namespace 的同类(flag-audit / 过期闸 / `--as-of` / CCM_BIN 一致性 sweep),一次扫掉 sibling 类,否则同类逐轮冒。③ **深子系统(hand-rolled OR/ML 估算引擎)的 findings 是「无限长尾」型不收敛到零**——每轮仍 ~2 个新深 edge;何时止于「够好可 ship」是**用户的质量-vs-ship 决策**,非 orchestrator 单边无限续磨。
- **影响**:✅正向——(a) 给镜头 6「第二评委 / 多层交叉验收对 subtle correctness 必要」添最强活证据(单层全绿 9 轮全漏);(b) 给「长尾不收敛子系统的 ship 阈值=用户决策」一个活体编排范式:orchestrator 按用户「自驱无需讨论」standing 指令**续修不阻塞**(R6-R9 真·离散 bug 直接派 fix-agent),但到**连续 3 轮(R7/R8/R9)非收敛**这个预告 trigger 时**转阻塞式 AskUserQuestion** 把「续磨 / 修完即 ship / as-is ship」交用户(发版授权终归用户·绝不自授权);(c) 顺带踩两个坑:**flaky 计时测试 (21)(test_switch-select.sh 20s refresh-timeout 断言)污染整合门判定**——`run-tests.sh` 首跑 `TESTS FAILED`、重跑 `ALL PASSED`(round-9 改动纯 ccm、不碰 hooks/content,逻辑上不可能真失败 + 单跑 test_switch-select 286/0 + fix-agent 早已 flag 其并发 flaky → 判 flaky 非真失败);且**首跑 `2>&1 | tail -6` 截断藏了真失败点**逼我全量重跑落文件才看清。
- **处置(含蒸馏判定)**:蒸馏——① **codex 第二评委 + completeness-sweep 的价值**已在 SKILL A 镜头 6 + AGENTS §7,本场坐实为最强活证据;**新增洞察「深子系统长尾不收敛 → ship 阈值转用户决策(连续 N 轮非收敛即从『自驱续修』升『阻塞 surface 质量-vs-ship』)」**值得回流(候选落 `async-hitl.md` 的 HITL 边界或 `resume-verify.md` 第二评委段·具体按 curating/skillsmith 判)。② **flaky 计时测试侵蚀整合门可信度**——「绿/红=过/不过」的前提是 gate 确定性;wall-clock 计时断言(20s timeout)是结构性 flaky 源(候选 0.10.1:(21) 去 wall-clock 依赖或 quarantine 出 `run-tests` 主门 + 回流测试纪律「整合门不得含 flaky 计时断言」)。③ **验收脚本输出别 `| tail` 截断**——截断藏真因逼重跑;纪律:整合门输出落全文件再 grep 失败点(本场已据此重跑确认)。④ **遗留 0.10.1 follow-up**:estimate maxBoards cap 在 corpusAsOf 前截断的深 edge(round-7 fix-agent flag·须改引擎签名·out-of-scope 仅记)。**不回流为红线**(都是已有镜头 6 的强化 + 测试卫生·非新硬约束)。
- **严重度 / 来源**:✅正向(成功机制根因级验证 + 长尾 ship 阈值用户决策范式)+ 中(flaky 计时测试污染 gate / tail 截断藏真因)/ 一手(v0.10.0 codex 9 轮硬化收尾实录·本 session 亲跑 + 用户拍板 ship 阈值)。

## Finding #77 — `ccm board update` 的 board-discovery flag-dependent 分叉:同一 verb `--goal` 假报 NotFound 而 `--wip-limit` 成功 · 低(命令面一致性)

- **现象**:v0.10.0 发版前 E2E 亲跑,在 `ccm board init` 建的**未认领板**(`owner.session_id:""`)上做隐式(无 `--board`)`board update`:`--goal "X"` **一致失败** `error: No active board owned by session …(也无未认领 active 板)`(A/C/F 三次复现·session 全程非空 sid·指针目录空),而同一 verb 的 `--wip-limit N` **成功**(E/G);对比 `task add` / `task ls` / `board graph` / `board next` 隐式在同一未认领板上**都成功**。即同一 verb 因传不同 flag 走了两条 board 发现路径——无任何设计理由。
- **根因 / 机制**:`goal` 是**全局 flag**(GLOBAL_OPTIONS),对绝大多数 verb 它是「按 goal 子串发现哪块板」的消歧过滤器(`goalSubstr`),故 `_common.ts` 的默认 resolve(runWrite/runRead)一律把 `ctx.values.goal` 当 `goalSubstr` 喂 `discover.resolveBoard`。但 `board update` / `board init` / `cadence open` 把 `--goal` **重载成 payload 字段**(命令 spec 的 `field:'goal'` 在 `Object.assign(GLOBAL_OPTIONS, spec.options)` 中胜出)。`board update --goal "X"` 时,payload `--goal` 漏进发现当 `goalSubstr`,按「现有 goal 含 "X"」过滤——fresh-init 未认领板现有 goal 不含新串 → `goalMatches` 假 → 被滤掉 → 两层匹配的 unclaimed 档落空 → 假 `NotFound`。`--wip-limit`(无 `--goal`)`goalSubstr` 为 undefined → 不过滤 → 命中未认领板。`board init` 早已用自定义 `initResolve` 绕开(本就不发现),`board update`/`cadence open` 没有。错误文案「也无未认领 active 板」也是假信息(板其实在,被 goal 过滤掉了)。
- **影响**:正常编排流不触发——bootstrap arm 时板被盖成本 session 的 `owner.session_id`,后续全走精确 sid 命中,`--goal` 过滤恰好也命中(同板 goal 含自身);只有「手动 `ccm board init` 建未认领板 + 隐式 update --goal」这条手测路径碰得到。但它是命令面一致性硬伤(同 verb 跨 flag 行为不一)+ 假错误信息误导,不修则 v0.10.0 留瑕。
- **处置(含蒸馏判定)**:本次修——`board update`(及同病的 `cadence open`)发现时**忽略 payload `--goal`**,经共享 `resolveBoardIgnoringGoal(ctx)`(除省 `goalSubstr` 外与默认 resolve 完全同一条两层匹配)统一所有 flag 的发现路径(**收口到单一 `resolveBoard`**);并修 `NotFound` 文案在 goal 过滤所致时诚实标注「已按 goal 过滤」。补 CLI 回归测试(board update --goal 在 fresh-init 未认领板隐式成功 + 各 flag 发现一致 + discover 文案诚实)。蒸馏——**「同一 verb 跨不同 flag 的 board-discovery 必须一致;一个 flag 既是全局发现过滤器又被某 verb 重载成 payload 时,该 verb 的发现必须忽略它、收口到单一 `resolveBoard`(别让 payload 漏进发现)」**。回流落点:`using-ccm/references/command-catalog.md`(全局 `--goal` 行 + board update 段注明这三个 verb 把 `--goal` 当 payload、发现忽略它)。**不回流为红线**(命令面一致性约束·非新硬约束;由 CLI 回归测试守)。
- **严重度 / 来源**:低(命令面一致性 + 假错误信息)/ 一手(v0.10.0 发版前 E2E 亲跑·flag-dependent 精确钉死)。

## Finding #78 — 本地用 `act` 测 tag 触发的 release workflow,act 复用本机真 `gh` 凭证 + tag 事件 → `action-gh-release` 真把 draft v0.10.0 publish 了(意外 outward 发版);防线=测 workflow 必用非-tag 事件 + dispatch 派外向验证须框死护栏 · ⚠️高(意外 outward 不可逆·已完全撤回)+ ✅正向(授权闸 + 诚实上报 + 只读核实三道链守住)

- **现象**:v0.10.0 发版前,派 agent 本地验 tag 触发的 `ccm-release.yml`(确认能正确编译+打包制品)。agent 用 `act` 在本地 Docker 预演,第一次喂了 **tag 事件**(`refs/tags/v0.10.0`)。act 自动复用本机 `gh` keyring 的**真 token**,workflow 里 `softprops/action-gh-release` step **真动了真 repo**:把本是 **draft** 的 `nemori-ai/cc-master` release **v0.10.0 publish 了**(标 Latest)+ attach plugin zip;而 v0.10.0 未合并进 main(只在 feature 分支)、tag 还指向旧 main commit `4016310`——一个不该公开、内部自相矛盾的发版。
- **根因 / 机制**:① **`act` 不是干净沙箱**——它把本机环境/凭证(`gh` token / `GH_TOKEN`)透传进容器,workflow 里调真 GitHub API 的 step 就**真对真 repo 生效**,非模拟。② **tag 事件触发了 attach**——attach step 的 `if: startsWith(github.ref, 'refs/tags/')` 守卫被 tag 事件满足 → 真执行。③ **我 dispatch 没框死护栏**——prompt 说了「用 act 跑 Linux job」却**没明令「只用非-tag 事件、绝不让真凭证触发 outward step」**,把「本地测=安全」当默认假设,而 act + 真凭证打破了它。
- **影响**:⚠️一次真·意外 outward 发版(premature publish);但**两道防线守住没扩大**:(a) **agent 诚实第一时间上报** + 试 remediation 时**被 auto-mode 授权闸正确拦下、没绕过**(印证「outward 不可逆动作必经显式授权·绝不自授权」红线在 sub-agent 层亦生效);(b) orchestrator 端**先只读 `gh release view` 核实真状态再 surface**,用户授权后才执行撤销(`gh release delete-asset` + `gh release edit --draft` + `git push origin :refs/tags/v0.10.0`),发版前态全恢复(isDraft=true·assets=[]·tag 删·v0.9.2 回 Latest)。**正向**:授权闸 + 诚实上报 + 端点只读核实这条链,把意外 outward 控制在「可完全撤回」。
- **处置(含蒸馏判定)**:① **harness 已立防线**(`scripts/test-release-local.sh` 头注「血泪 footgun」+ STAGE 3 故意用「非-tag」push 事件让 attach 按其 `if` 守卫声明式跳过;文档化 `workflow_dispatch` 安全真-runner 路径=推上去 GH 手动触发、非-tag 跳 attach、不发版)——本地验 workflow 的安全口径已固化。② 蒸馏——**「派 agent 本地测 outward-facing CI/workflow(尤其 release / 任何调真 API 的 action)时,dispatch prompt 必须框死 outward 护栏:用非-tag / 非-触发条件的安全事件、隔离/不透传真凭证、明令绝不让真凭证触发 outward step;`act` 复用本机真 gh 凭证、不是干净沙箱」**。回流落点:候选进 SKILL A `dispatch.md`(派外向验证的护栏)或 §7 带外验收纪律旁。③ **不回流为红线**(dispatch 派活护栏 + 既有「outward 必经授权」红线的延伸·非新硬约束)。
- **严重度 / 来源**:⚠️高(意外 outward 不可逆·premature 公开发版)但**已完全撤回** + ✅正向(授权闸 + agent 诚实上报 + 端点只读核实三道链守住、可控)/ 一手(v0.10.0 发版前本地 release workflow 验证实录·本 session 亲历 + 用户授权撤销)。

## Finding #79 — CI release 的 SEA 构建漏先 build `@ccm/engine`,bundler externalize 引擎 → 首发 4 个 SEA 全挂 `ERR_UNKNOWN_BUILTIN_MODULE`;本地 release harness 因 engine dist 已在而掩盖了 CI fresh-checkout 失败 · should-fix(release-blocking·已修) + ✅正向(端点 recon 逮到 gate-green≠passed)

- **现象**:v0.10.0 首次 tag 触发 `ccm-release.yml`,4 个 build-sea job(darwin-arm64/-x64·linux-x64/-arm64)**全 failure**,package-plugin 独活 → softprops 发了个只含 plugin zip、0 个 ccm 二进制的残缺 release。失败日志:bundler「treating @ccm/engine as external」→ postject 注入后 smoke `ccm --version` 报 `Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: @ccm/engine`。
- **根因 / 机制**:workflow 的 "Build CLI" 步用 `pnpm -C ccm/apps/cli build`(= 直接 `tsdown`、**不经 turbo**),只建 apps/cli 自己、**不建上游 `@ccm/engine`**。CI fresh checkout 下 engine 的 `dist/` 不存在 → SEA bundler(tsdown.sea.config)解析不到 `@ccm/engine` → 当外部依赖**不 inline 进 SEA** → 运行时 SEA 无 node_modules、找不到引擎而崩。`ccm-ci.yml` 过是因为它 `turbo run build` 全量(dependsOn `^build` 先建 engine),release workflow 没复用同口径。**关键**:本地 `test-release-local.sh` 验过 SEA 能建能跑——但那时 engine `dist/` 早被反复 build 过、已在,**掩盖了「fresh checkout 不先建 engine」这个唯一在干净环境才现形的失败**(gate-green ≠ passed 活体复现·镜头 6)。
- **影响**:⚠️首发 release 残缺(用户 `install.sh` 下不到 ccm 二进制、装不上)。但 4/5 资源是 watchdog + 端点 recon 主动逮到的(非用户报障),按发版收口流程 re-release 修复(删坏 release + tag → 修 workflow → 重打 tag),arm64/linux 全平台最终齐。
- **处置(含蒸馏判定)**:本次修——"Build CLI" 改 `pnpm -C ccm build`(turbo 全量·`^build` 先建 engine 再建 cli),workflow 注释钉死「**必 turbo 全量、非 `-C apps/cli`**」+ commit message 直引根因(PR#44·main bfee890)。蒸馏——**「外向 CI 构建 SEA / 单文件二进制时,bundle 前必须先建全部工作区上游包(`@ccm/engine`);只 build 叶子包会让 bundler 把未建的工作区依赖 externalize、运行时崩——而本地若 dist 已在则完全测不出,故 release workflow 的构建口径必须与全量 CI build 一致,本地验证须在 fresh-checkout 等价环境或先 `rm -rf dist` 再跑」**。回流落点:纯 CI 配置 bug + 镜头 6「本地 harness 绿 ≠ CI 绿 / fresh-checkout 才现形的形态盲区」的**又一活证据**(与 [[Finding #29]]/[[Finding #38]] 真实环境才现形同族)。**不回流为红线**(CI 构建口径 + 既有镜头 6 的强化·非新硬约束;由 workflow 注释 + ccm-release.yml 守)。
- **严重度 / 来源**:should-fix(release-blocking·已修) + ✅正向(端点 recon 逮到 + gate-green≠passed 复现)/ 一手(v0.10.0 发版 workflow 失败实录·本 session 亲跑 gh api 挖单 job 日志定根因 + PR#44 修复 + re-release)。

## Finding #80 — v0.10.0 `ccm board archive` 对**未迁移的 legacy v1 板** schema 硬拒(`FMT-SCHEMA` v1≠v2),归档/退役 legacy 板无 fallback;直接 flip `owner.active` 才完成归档 · should-fix(升级路径·本次已绕过)

- **现象**:收尾归档一块 0.9.2 版建的 active 板(`schema:"cc-master/v1"`)时,`ccm board archive --board <v1板>` 跑 lint 预检报 **1 个 hard error** `FMT-SCHEMA schema 必须是 "cc-master/v2"(当前 "cc-master/v1")`(+ 39 个 warning:v1 的 log kind 如 `milestone`/`ledger` 不在 v2 枚举)→ **archive 中止、`owner.active` 没 flip**(复核仍 `true`)。
- **根因 / 机制**:v0.10.0 的 `boardArchive` mutation 走 `runWrite` 带全量 board-lint 闸,schema 必须 v2。legacy v1 板(rework 前建)若**没先经 `as-master-orchestrator` bootstrap 做 v1→v2 迁移**就直接 archive,撞 schema 硬闸即拒。即「归档」这个本该只需 flip 一个 flag 的退役动作,被绑上了「板必须 v2 合规」的全量 lint 前置——对一块正要退役、不再复用的板是过严前置。
- **影响**:真实用户从 0.9.x 升级、home 里有 active v1 板时,直接 `ccm board archive` / `/stop` 会 fail(除非先经 as-master-orchestrator bootstrap 迁移该板)。本次是一次性退役,直接 `node` flip `owner.active=false`(archive 的核心效果就是这个 flag·非删除·内容保全)完成归档,复核全 project 0 块 active。
- **处置(含蒸馏判定)**:本次绕过(直接 flip flag)。蒸馏——**「退役/归档一块板(owner.active→false)不应要求该板通过全量 v2 schema lint:archive 是 terminal 动作、只需翻 active flag,对 legacy v1 板该有 fallback——要么 archive 路径放宽/跳过 schema-version 硬闸(只校验能定位 + owner 字段),要么 archive 时自动先做 v1→v2 迁移」**。回流落点:候选进 ccm `board archive` 引擎(`boardArchive` 的 lint 闸对 archive 放宽 schema-version 硬 error·或 migrate-on-archive)+ `using-ccm` 命令面注明「v1 legacy 板需先 bootstrap 迁移才能用 v0.10.0 verb 操作」。**不回流为红线**(升级路径健壮性·非新硬约束;0.10.1 候选 follow-up)。
- **严重度 / 来源**:should-fix(升级路径·本次已绕过)/ 一手(v0.10.0 收尾归档 legacy v1 板亲历·本 session)。

## Finding #81 — `usage-pacing.js` 号池 ambient 把「换号决策权」错归 agent(「切不切的决策…由你的认知判断」),与成熟后的 LBHOOK + policy 自主换号设计相悖 + 违 ADR-018 P3「ambient 不夹 steering」 · should-fix(agent 指导措辞·已修)

- **现象**:`usage-pacing.js` 的号池 ambient(pacing 一出声且有可切入备号就在尾部统一附加的 `<ambient source="usage-pacing">`)末尾写「换号机制由 ccm account switch 机械执行…;**切不切的决策 / 配速由你的认知判断**,这是事实告知,不替你决策」。同款 decision-attribution 还出现在两处 `kind='switch'` 的 advisory warn body(「切换/续派由你的认知判断」)——这些 warn 恰在 LBHOOK **未**自动切号的路径上与号池 ambient 同时注入,直接自相矛盾。
- **根因 / 机制**:这条措辞是 LBHOOK(hook 按 policy 自主机械换号·ADR-016)成熟**之前**的遗留——彼时换号确是 agent 的一个 pacing lever、「切不切」由 agent 拍。成熟后的设计跨所有 regime 都**不给 agent「逐次换不换」的自主决策权**:配额墙(5h 临界)时由 hook 按 `board.policy` 自主机械执行 + 事后通知(LBHOOK·line 1041-1068);`policy=deny`(机制硬闸 exit7)或 7d 硬总闸时作为**用户决策** surface 给用户拍(line 1069-1075 / 697-711)。agent 的认知判断权在**配速**(档/WIP/defer)+ 经用户授权调 policy + surface,**不在逐次换号**。号池 ambient 却把换号决策权回归 agent,既与机制设计相悖、又是 ADR-018 §13 P3 违规(`<ambient>` 该是**纯事实**,却夹了「切不切由你判断」这个 decision-attribution steering)。
- **影响**:给 agent 的指导**不对**——一个忠实读 ambient 的 orchestrator 会以为「逐次换不换」是自己该拍的认知判断,而机制层其实已按 policy 自主/用户拍把这个决策从它手里拿走;在 LBHOOK 未自动切的路径上,矛盾的两段(warn 说「切换由你判断」+ ambient 修正前也说「切不切由你判断」)同时注入,放大误导。属「给 agent 的指导不对」(非测试可见·dogfood 抓出)。
- **处置(含蒸馏判定)**:本次修——号池 ambient 措辞拆开纠正为「**配速**(档/WIP/defer)由你的认知判断;**换号**在配额墙由 hook 按 board.policy 自主机械执行+事后通知你(policy=deny 或 7d 硬总闸时作为用户决策 surface 给你拍),不由你逐次拍板」,保留号池事实(N 个备号 / ccm account switch 机械执行 / token-blind);两处 `kind='switch'` warn body 同步对齐(「切换/续派由你的认知判断」→ 同款分工措辞)。蒸馏——**「hook 注入给 agent 的 ambient 必须是纯事实告知,绝不夹『某决策由你拍』这类 decision-attribution(ADR-018 P3:ambient 别偷夹 steering);凡涉及换号,措辞须与 LBHOOK + ADR-016 policy 的权责划分逐字一致——配速归 agent 认知判断、换号归 hook 按 policy 自主或用户拍,agent 无逐次换号决策权」**。回流落点:`usage-pacing.js` line 1101-1103 号池 ambient + line 437/734 switch warn 措辞(已修)+ 对齐 ADR-018 P3「ambient 不夹 steering」。**不回流为红线**(既有 ADR-018 P3 + ADR-016 权责划分的强化·非新硬约束;由本文 §13 作者纪律 + ADR-016 守)。
- **严重度 / 来源**:should-fix(agent 指导措辞·已修)/ 一手(本次 dogfood·用户发现遗留措辞与成熟后 LBHOOK/policy 设计相悖)。

## Finding #82 — pacing 砍加速侧(ADR-024)的 pressure baseline:2/2 capable-model run 都选 Hold(RED 未复现)→ 加速 advisory 是冗余噪声、agent 自推 no-busywork,故翻转立在冗余+正确性而非纪律危害·**绝不编造未发生的红线** · ✅正向(天花板·诚实不造纪律)

- **现象**:ADR-024 把 pacing 从双侧走廊翻转为「单侧(减速)+ 换号 + 停」,核心动作是**砍掉整个 underuse 加速侧**。按 §6 TDD-for-skills,砍一条纪律型指导(加速 advisory)前先跑 subagent pressure baseline 验「没有该翻转 / 在旧加速 advisory 下,capable agent 会不会真被诱导去加速填窗口」——2 runs、capable Opus-class 模型、三压(time + sunk cost + exhaustion)、强制 A/B/C 三选一、与本仓 skill 隔离。**结果:两次都选 Hold**,agent **主动 overrule** 了加速 advisory,明确推理「有号池时一次 `switch` 就换来新的满血 5h 窗口,故单窗口『欠用』不是真稀缺」+「为把用量填到走廊 90% 而加速 = manufacture busywork(正是那条反模式)」。即 **RED 未复现**(pressure-testing.md §9 强模型天花板:capable 模型在单个决策点就自推出有纪律的选择)。
- **根因 / 观察**:① **强模型天花板**——「配额欠用该不该加速去填」是 capable agent 从既有 no-busywork 纪律(SKILL A 镜头4 / 指挥不演奏)+ 号池世界模型能自洽推出的判断,**没有一条 rationalization 在强模型下稳定把『不加速』合理化掉**(不同于 [[Finding #46]] phantom in_flight、[[Finding #44]] 假串行边那种压力下反复复发的真红线);恰相反,压力下 agent 反而**更清醒地**认出加速 advisory 与 no-busywork 冲突、主动拒它。② **加速 advisory 是冗余/误导噪声**——它非但没在防一个 capable agent 会犯的错,反而是 agent 每次都得**花 cycle 去 overrule** 的干扰项;号池让「单窗口欠用」在架构上根本不是问题(一次 switch = 新窗口),走廊加速侧建在一个已不成立的单账户前提上。
- **影响**:✅正向——**翻转理由被 baseline 反转**:砍加速侧**不是**作为「纪律危害修复」(no-busywork 纪律已在 SKILL A 承重、baseline 证其压力下守住),而是立在两条别的地基上——(a) 加速 advisory 是 capable agent 必须浪费 cycle 去 overrule 的冗余噪声;(b)「欠用-带池」这个态在架构上更该由 `switch`(有真活时消费下一份配额)服务,而非编造工作去填。与 [[Finding #70]](board-graph baseline RED held)/[[Finding #26]](模型分层零失败)同族:baseline 证强模型天花板时,正确处置不是「按堵漏写重型纪律」——那会**造一条强模型不需要的红线**,违 skillsmith Iron Law(编造未被违反的规则 = 稀释每回合重注的魂)。
- **处置(含蒸馏判定)**:蒸馏判定——**因 RED 未复现,不发明任何新的 judgment-bearing skill prose / Rationalization-Table 行 / Red Flag**(编造一个未发生的失败 = skillsmith iron law 下的谎)。本次改动落**引擎 + reference 词汇**:`ccm/packages/engine/src/usage/pacing.ts` 新 verdict enum + 池感知接线、`usage advise` 输出字段、`usage-pacing.js` hook 消费、`pacing-and-estimation`/`using-ccm` 手册的 verdict 表 + 字段锁步——**不动 SKILL A 魂的纪律段**。no-busywork 纪律已在 SKILL A 承重且经本 baseline 证压力下守住,无需为翻转再补一条。ADR-024 §1/§3 已诚实记这条 baseline determination(方向:砍冗余噪声 + 池态归 `switch`,非纪律危害修复)。**不回流为红线**(RED 缺席·守 Iron Law·天花板诚实不造纪律)。
- **严重度 / 来源**:✅正向(天花板·诚实不造纪律·翻转立在冗余+正确性)/ 一手(ADR-024 pressure baseline·2 runs capable-model·三压·强制 A/B/C·2/2 Hold·RED 未复现)。

## Finding #83 — `ccm task update --set/--set-json` 裸 dotpath 落 **board 顶层**而非该 task,help 文本与命令语境双重暗示「设的是这个 task 的字段」→ orchestrator 把 `decision_package` 误写到 board 根,且 render 照报「task 已更新」零提示 · should-fix(CLI 易误用·文档密度·已修)

- **现象**:orchestrator 给 awaiting-user 节点挂采访包,按直觉敲 `ccm task update HOOKPAR-PR --set-json 'decision_package={…}'`——命令 render 报「task 已更新: HOOKPAR-PR」,但包落在了 **board 根**;随后 `ccm task block --on user` 撞 `BIZ-AWAITING` hard(task 上没包),排查两轮(先疑 #60 回归、读引擎源码)才发现 `applySet` 的契约是「dotpath 第一段决定作用域:`tasks[<id>].<field>` → task;否则 → board 顶层」——**`task update` 的 positional `<id>` 对 `--set/--set-json` 完全不参与 scoping**。正确写法是 `--set-json 'tasks[HOOKPAR-PR].decision_package={…}'`(id 得在 path 里再写一遍)。
- **根因**:三重暗示叠加成陷阱:① 命令名是 `task update <id>`,普通 flag(`--title`/`--artifact`)都作用于该 task,用户自然外推 `--set` 同理;② help 文本只说「通用设 ✎ 标量(path=val)」,**不提裸 path 落 board 顶层、不提 task 字段须 `tasks[<id>].` 前缀**;③ 写错时 render 照报「task 已更新: <id>」,零信号提示值其实落了 board 根。契约本身(cli-design §3.5 通用逃生口 board-rooted)自洽,但它与 `task update` 语境组合后的**易误用面**没有任何一层兜。
- **影响**:board 根被静默污染一个无人消费的顶层对象(viewer / discuss 都读 task 级包,根级包是死数据);awaiting-user 闸被 hard 挡时报错指向「缺 decision_package」而非「你写错了地方」,误导排查方向;清理还发现 `ccm board update` **没有** `--set/--set-json`(顶层 flexible 字段只能反用 `task update` 的裸 path 逃生口清理,别扭)。
- **处置(含蒸馏判定)**:**已修**(机制层候选①全量落地,ccm changeset `ccm-set-scoping-finding-83`)——`task add/update <id>` 的 `--set/--set-json` 裸 dotpath 现在 scope 到该 task(`mutations.applySet/applySetJson` 增 `defaultTaskId` 作用域参数;显式 `tasks[<其它id>].field` 前缀保留跨 task 逃生口;🔒 判据不变且裸 `--set status=…` 现被拒 exit 3 而非静默写顶层 junk);`ccm board update` 新增 `--set/--set-json` 作板级顶层 ✎ 字段正门;两处写入后非 `--json` 输出回显实际写入的逻辑 path(`set tasks[T7].decision_package`·`mutations.logicalSetPath`),消除零信号;registry help 文本写明 scoping;`jc add`/`cadence update`/`cadence open` 维持 board 顶层语义不回归。文档层同 PR 锁步 `using-ccm`(§6):`references/command-catalog.md` 增 scoping 语义总段 + 逐 verb 落点说明 + 「给 task 挂 decision_package」正例;`SKILL.md` 心智锚 2/3 + footgun 速查、`references/board-model-guide.md` footgun 1/4 同步改写。本轮曾以 `tasks[HOOKPAR-PR].decision_package` 正确写法绕过 + 根级残留置 null。
- **严重度 / 来源**:should-fix(易误用面·静默错落点·已修)/ 一手(2026-07-07 HOOKPAR-PR 收口实测,board 20260707T081546Z-4904)。

## Finding #84 — managed cross-harness worker 只授权 worktree content、漏掉 linked-worktree 的真实 Git metadata 与 artifact 根，导致 worker 能编辑却在 `index.lock` EROFS、也写不了主仓报告 · should-fix(cross-harness launch contract·本次 preflight/compiler 已修，dispatcher 接线待后续)

- **现象**:在隔离 worktree 派 Codex worker 时，managed sandbox 能写 worktree 内容，却不能写 `.git` gitfile 指向的主仓 `<common>/.git/worktrees/<id>`；`git commit` 创建 `index.lock` 当场报 EROFS。任务还要求把报告写回主仓 `design_docs/plans/`，该根同样不在 worker 写集。worker 因而实现可完成、却不能按 work order commit/report。
- **根因**:原权限模型把「workspace」误等同于 worktree content tree，未建模 Git linked-worktree 的分裂写面：per-worktree admin dir + common objects/refs/logs；也没有把 worktree lease 的显式 artifact roots 编译进 provider permission mapping。更危险的早期 spike 还允许 CLI 接收 caller-prebuilt facts，并拟授权整个 common `.git`，既可伪造 writability，又扩大到 config/hooks 等不必要敏感面。
- **影响**:cross-harness worker 的“可写 workspace”是假绿：edit 通过不代表 stage/commit/report 闭环成立；失败发生在任务末端，浪费配额且把节点推入 uncertain。若粗暴授权 whole `.git`，则又把工程可用性问题变成权限越界风险。
- **处置(含蒸馏判定)**:本次新增 `ccm/attempt-write-set/v1` 纯编译器 + `ccm attempt write-set` 可执行本地 preflight：安全解析 gitfile/commondir/gitdir backlink，拒 symlink/escape/main-worktree/缺失/只读，实际临时文件探针验证写权限；只授权 worktree content、per-worktree gitdir、common objects/refs/logs 和 lease 内显式 artifact roots，任何失败返回零 usable roots；Codex/Claude fixture mapping 保留 account/credential/network/push/PR/merge/release/undeclared-path deny floor。公共 `--request` facts 注入已删除，whole common `.git` 永不授权。**诚实缺口**:public CLI 的 caller-supplied lease 不是 trusted manager lease；production dispatcher 尚未在 spawn 前消费此 plan，故成功也固定 `launch_ready:false`，并保留 opt-in RED 直到 trusted lease store + provider driver mapping + only-spawn-effect seam 接通。蒸馏落点是 cross-harness runtime contract/spec + `using-ccm` command catalog，不新增 master-orchestrator judgment 红线。
- **严重度 / 来源**:should-fix(跨 harness worker 无法形成 edit→stage→local commit→artifact 闭环；权限边界安全相关)/ 一手(2026-07-13 本 board Codex linked-worktree dogfood 的 `index.lock` EROFS + 报告根不可写)。

## Finding #86 — 本机 `cursor-agent` 已安装且用户已手工 auth，`ccm harness list` 却只探 Cursor IDE surface 而报「Cursor 未安装」 · should-fix(cross-harness inventory 诚实性·已修)

- **现象**:2026-07-13 本机一手复现：`command -v cursor-agent` 命中 `/data/qiwei/.local/bin/cursor-agent`（可执行 symlink → `/data/qiwei/.local/share/cursor-agent/versions/2026.07.09-a3815c0/cursor-agent`），用户已在该 CLI 手工 auth；但旧 `ccm harness list --json` 的 `cursor` 条目只探 `cursor` binary + `~/.config/Cursor` + `~/.cursor/plugins/local/cc-master`，因此输出 `installed:false`、`cli.name:"cursor"`、`reason:"cursor CLI not found and Cursor config/plugin directories not present"`，完全看不见真实存在的 headless worker surface。
- **根因**:`HarnessAdapter` 的安装模型只有每品牌一个 `cli` / `installed` descriptor，Cursor adapter 又把这个单 descriptor 具体绑在 IDE/plugin surface 上；没有先分 execution surface，于是不同生命周期 / invocation / auth / quota 契约的 Cursor IDE plugin 与 Cursor Agent CLI 被错当成一个东西。这正是 cross-harness 能力模型已禁止的越级等式：IDE/plugin installed ≠ headless available，binary installed ≠ authenticated/quota known。
- **影响**:中-高——surface inventory 的候选域从起点就丢掉一个真 worker，后续 routing 不可能选它；同时若简单把顶层 Cursor `installed` 改成「任一 binary 存在」，又会让 only-agent 机器误进 IDE plugin install/upgrade，并容易伪报认证、配额或自动切号能力。
- **处置(含蒸馏判定)**:**已修**——`ccm harness list/current` 保留顶层 harness `installed` 的 IDE/plugin 分发语义，新增 `surfaces[]` 独立报 `cursor-ide-plugin/ide-plugin` 与 `cursor-agent/cli-headless`，顶层加 `installedSurfaces[]`；headless 只以可执行 `cursor-agent` presence 翻真，报 binary name + PATH 命中绝对路径，`authentication`/`quota` 固定 `unknown/not-probed`，`accountMutation=forbidden`，`accountAutoswitch`/`pluginDistribution=unsupported`。TDD 矩阵固化 only-agent / only-IDE / both / neither / symlink / non-executable，JSON + text render + machine registry 同步；真机 smoke 只跑只读 inventory，零 provider call / credential 读写 / login/logout/switch / remote mutation。**蒸馏判定 = 回流到契约 + 派生操作手册，不新建 skill / 红线**：领域边界落 `design_docs/cross-harness-orchestration-capability-model.md` §7.1 + `design_docs/harnesses/cursor.md`，用户命令语义落 `using-ccm/references/command-catalog.md`；这是现有「surface 先分面、相邻事实不互推」契约的实体化，无新的 judgment-bearing 方法论需进 skill。
- **严重度 / 来源**:should-fix(中-高·cross-harness 候选丢失 + 能力诚实性·已修)/ 一手(2026-07-13 真机 `command -v` + 旧 `ccm harness list --json` RED，本 worktree 矩阵测试 + 只读真机 smoke GREEN)。

## Finding #87 — statusline DEV-GUARD 无边界向上扫描,并发 test worker 在共享 temp root 留下瞬态 `.git` 即把别的独立安装目录误判为 dev · 中(并发测试稳定性·安装判定)

- **现象**:并发跑 ccm engine / CLI 测试时,共享的 `os.tmpdir()` 根可能短暂出现另一个 worker 创建的 `.git`。本场一手现场为空目录 `/tmp/.git`;baseline `pnpm --dir ccm --filter @ccm/engine test` 稳定落在 **505/507**,`looksLikeDevInvocation: 安装路径 → 非 dev` 与 `autoInstall: 安装路径 → 正常装` 两项失败;同一路径换成不带该共享祖先 marker 的 temp root 即绿。
- **根因**:`looksLikeDevInvocation(binPath)` 从 binary 所在目录一直扫到文件系统根,只要任一祖先存在 `.git` / `pnpm-workspace.yaml` / `turbo.json` 就判 dev。这把「项目拥有的仓库边界」和「多进程共享的系统 temp root」混为同一信号:`/tmp/.git` 的存在不能证明 `/tmp/<isolated-worker>/home/.local/bin/ccm` 属于它。单纯调 sleep / retry / 串行度只会隐藏这个证据边界错误。
- **影响**:并发 full suite 存在跨 test-file 假红,且测试结果取决于共享主机的瞬时文件系统状态;同类环境下还会让本应自动安装 statusline 的稳定安装路径被误 suppress。真实 worktree 或 temp root **子目录内**的真仓库仍需继续 suppress,不能为治假红把 DEV-GUARD 拆掉。
- **处置(含蒸馏判定)**:已做领域边界修正:`looksLikeDevInvocation` 仍扫描系统 temp root 的所有子目录,但到达 `os.tmpdir()` 本身时先停、不采信该共享目录的 marker,也不继续扫更广祖先;`/worktrees/` 快路与真实子仓库判定保持。回归用私有 `TMPDIR` 模拟共享 root 上的瞬态 `.git`,使 RED 不再依赖真 `/tmp` 此刻是否被污染,并单独钉住「共享 root 不采信」与「其下真实 repo 仍采信」。**蒸馏判定=不回流 runtime skill prose**:这是 ccm 内部 DEV-GUARD 的证据边界 + 并发测试仪器问题,已由源码注释与 deterministic 回归测试承载;向面向用户 orchestrator 的 skill 加这一实现细节只会增噪。
- **严重度 / 来源**:中(并发测试稳定性·安装判定·不破坏数据)/ 一手(2026-07-13 full engine suite 复现 + 空 `/tmp/.git` 地面证据 + deterministic RED)。

## Finding #88 — `BIZ-EXECUTOR-HANDLE` 对 future `ready` / `blocked` subagent/workflow task 也报缺 handle，把「在飞接驳证据」误写成「执行者类型必填字段」并诱导 phantom handle · should-fix(高信号 warning 假阳性·已修)

- **现象**:一块板为未来工作提前选了 `executor:subagent|workflow`，任务仍在 `ready` 或 `blocked`、尚未调用任何派发工具时，旧 `BIZ-EXECUTOR-HANDLE` 已发 warn。此时根本没有可记录的真实 handle，操作手册又写成「subagent/workflow 必给」并在 `task add` 示例预填 `<句柄>`，会把 agent 推向 placeholder / 主会话 id 等 phantom handle。
- **根因**:rule 只看 `executor ∈ {subagent,workflow}` + handle 空，没有把 handle 的真实不变式与任务生命周期绑定。`executor` 是 future 计划；`handle` 是真实派发后才存在的 resume 接驳证据。只有 `status=in_flight` 才声称后台工作已在跑，旧谓词把两个不同时刻压成了同一条件。
- **影响**:warning 从「在飞任务换 session 后可能接不回」的高信号退化为 future DAG 常态噪声；更坏的是，为消 warn 预填的 phantom handle 会让 resume recon 相信一份虚假证据，比缺字段更难诊断。
- **处置(含蒸馏判定)**:**已修**——引擎谓词收窄为 `status=in_flight ∧ executor∈{subagent,workflow} ∧ handle 空`，保持 warn level，不改 executor enum / 状态机，不自动填 handle。RED/GREEN 用 `blocked|ready|in_flight × subagent|workflow|external|user|master-orchestrator × handle|空` 30 格矩阵固化；同步 `INVARIANTS`/rule message/字段元数据与 `using-ccm` 的 board-model-guide、command catalog、三 host 示例，明示「先真实派发 → 回填返回的真实 handle → 再转 in_flight」。**蒸馏判=回流引擎契约 + 派生操作手册，不新增 skill 纪律**：这是已有 resume/dispatch 不变式的机械事实校准，不需要新 Rationalization Table / Red Flag。
- **严重度 / 来源**:should-fix(高信号 warning 假阳性·已修)/ 一手(board task `fix_ccm_executor_handle_state_scope`·本 worktree RED 首个失败格为 `blocked/subagent/missing handle`)。

## Finding #84 — review 任务“执行完成”被当成“验收批准”：`REQUEST-CHANGES`/空 verdict 仍可满足 deps、自动解锁 integration · must-fix(交付正确性)

- **现象**:一手运行板 `20260710T063512Z-232847` 的 `review_xh_c1_shadow_route_final` 在独立终审给出 **`REQUEST-CHANGES`** 后，仍以 `status=done`、`verified=true`、非空 review report artifact 记录“审查工作已执行完成”；其下游 `xh_c1_precontext_integration` 的 acceptance 明确要求两个终审都 `APPROVE`，但任一后续 ccm 写命令触发 `reconcileGating` 时，只看到 review dep 已 `done`，曾把该 integration 从 `blocked` 自动翻成 `ready`。现场日志在 `2026-07-13T04:27:37Z` 明记 `P1=5/P2=1`、实现“不通过”，随后只能人工把 review 节点 `done→stale` 才重新关闸。若 review artifact 为空、verdict 缺失或 `null`，当前引擎同样没有机器字段可区分，仍只凭 `status=done` 放行。
- **根因**:`reconcileGating`、`board-graph-core.readySet` 与 `BIZ-STATUS-DEPS` 的共享完成口径只有 `isDoneStatus(task.status)`；board 模型没有一份显式、可机判的“该依赖受 review verdict gate 约束”声明，也没有与执行完成正交的 review verdict。于是两个不同领域事实被压进同一个 `done`：① reviewer 已产出报告（execution completion）；②报告结论满足下游 acceptance（approval）。`done + verified + artifact` 只能证明前者，无法证明后者。
- **影响**:负向终审或 silent/empty review 可让未获批准的 producer 进入 integration / delivery 链，直接打穿“gate-green ≠ passed”与“空 review 不放行”的端点验收纪律；错误还会被自动门控扩散为可信的 `ready` 状态，跨 compaction 后尤其难被发现。此案下游描述本就写着“只整合已获独立 APPROVE”，因此不是措辞灰区而是高风险 correctness bug。
- **处置(含蒸馏判定)**:采用**附加、正交、默认兼容**的依赖闸，不改 `status`/`deps` 字段、状态枚举或窄腰 tier：review task 显式声明柔性 `dependency_gate:{kind:"review",required_verdict:"APPROVE"}`，reviewer 执行结果另记柔性 `review_verdict`；共享具名谓词统一供 `reconcileGating` / `readySet` / `BIZ-STATUS-DEPS` 判断依赖是否满足。规则为：无 `dependency_gate` 的旧 task 保持 `status=done` 即满足（legacy compatibility）；显式 review gate 只有 `status=done && review_verdict==="APPROVE"` 才满足，`REQUEST-CHANGES` / 缺失 / 空串 / `null` / 非法值全部 fail closed。ccm CLI 提供具名 flag 原子声明 gate、记录 verdict，lint 校验形状/枚举；engine/CLI 测试先 RED 覆盖四类边界，`using-ccm` 同步门控心智与命令面，附 ccm changeset。**蒸馏回流**落 `@ccm/engine` board model/reconcile/graph/lint + `using-ccm` 操作视图；**不回流为 SKILL A 新红线**，因为“空/负向 review 不放行”纪律已存在，本次缺的是机制牙齿，重复 prose 会造双 SSOT。
- **独立复审 P1 闭环**:首版把 `review_verdict` 存成无 attempt 生命周期的 task 状态，旧 `APPROVE` 会穿过合法 `done→stale→ready→in_flight→done` retry；若新一轮 `task done` 不带 verdict，writer 原样保留旧批准并再次解锁下游。修复把既有 `stale|failed|escalated→ready` 具名为统一 attempt boundary：跨边即清 current verdict，且 `task done` 未给 `--review-verdict` 时显式保持缺失，双层防止陈值复用；新 `REQUEST-CHANGES` 仍关门、新 `APPROVE` 正常开门。旧 verdict 可由 retry 审计归档，但归档证据绝不参与 current gate。RED/GREEN 同时覆盖 mutation、handler 与真 CLI 完整状态序列；未依赖 Finding #85 的新 retry 命令，后续具名 retry 复用同一 boundary/helper 即可整合。
- **严重度 / 来源**:**must-fix(交付正确性·未批准代码可被自动解锁进入 integration)** / 一手(2026-07-13 本场 cross-harness dogfood，task + verify log + reconcile 行为三点同源证据；现场已人工 `done→stale` 止血，机制修复由独立节点承接)。

## Finding #85 — task 从 `stale` 重跑时沿用旧 `finished_at`/`artifact`/`verified:true`,形成「正在执行且已有旧完成证据」的矛盾态;手工 `--set verified=false` 又把布尔写成字符串 · should-fix(lifecycle 正确性·审计完整性)

- **现象**:一手节点 `review_codex_7d_pacing_final` 已完成并带 `finished_at`、旧 artifact、`verified:true`;上游变化后按现有合法状态机走 `done → stale → ready → in_flight`,`ccm task start` 只重盖 `started_at`,三项旧 terminal evidence 原样保留。最终同一 task 同时声称「本轮正在跑」和「旧轮已完成且验真」。尝试用 `ccm task update <id> --set verified=false` 修补时,通用标量逃生口按字符串写入,得到的是 `verified:"false"`;必须改用 `--set-json verified=false` 并另行手清 `finished_at`/`artifact` 才能恢复一致。
- **根因 / 机制**:状态机只声明 status 的合法边,CLI `transition()` 只写目标 status、进入 `in_flight` 时盖 `started_at`、进入 `done` 时盖 `finished_at`;它没有「attempt 边界」这一条领域动作。于是 `stale → ready` 被当成普通字段翻转,没有原子撤销当前 task 上一轮的 terminal evidence,也没有把旧证据迁入 append-only 历史。通用 `--set` 又是有意的 string scalar 入口,拿它补布尔天然类型不安全;要求 orchestrator 记住 `--set-json` + 三个字段的手工组合,等于把一个承重 lifecycle invariant 外包给调用者。
- **影响**:board、viewer、status report 与续跑 agent 都可能把旧 evidence 当成本轮事实,造成假绿、错误收口或错误端点验收;`started_at > finished_at` 还触发时间顺序 warning。手工多命令修补不是原子的,中途任一步失败都会留下新的半重置状态;直接覆盖/删除旧字段又让「上一轮为什么被判 stale、当时验了什么」失去可追溯性。
- **处置(含蒸馏判定)**:**已修**(`retry-attempt-evidence` changeset)——采用 additive 具名 lifecycle verb + 状态机原子 reset:新增 `ccm task retry <id...>`;引擎声明 retry transition(`stale|failed|escalated → ready`),所有合法 retry transition 共用同一原子语义——把上一轮 `started_at`/`finished_at`/`artifact`/`verified` 连同来源 status 序列化进 append-only `board.log` 审计条目,再清时间/产物并把 `verified` 重置为**布尔** `false`,retry mutation 请求落 `ready`;既有 deps 门控随后决定最终持久态为 `ready` 或 `blocked`,human/JSON 都逐 task 回显这个最终态。同步 CLI help、`using-ccm`、board v2 spec、测试与 ccm changeset。**蒸馏判定 = 回流机制/操作手册,不回流 judgment-bearing skill 红线**:这是状态机/类型/审计的确定性不变式,应由 engine+CLI 机械强制并在 `using-ccm` 教精确命令,不要求 agent 靠纪律记四步手修;不新增 narrow-waist 字段、不改 status enum/deps 语义。
- **证据**:clean main `1f8ccc5` + 已安装 `ccm 0.20.0` 的隔离 `/tmp` 板一手复现:`task done --artifact /tmp/old-review.md --verified` 后依次 `set-status stale`、`set-status ready`、`task start`;`task show --json` 仍返回 `status:"in_flight"` + 旧 `finished_at` + 旧 artifact + `verified:true`;再跑 `task update --set verified=false` 后同字段变为字符串 `"false"`。复现板已删除,未触碰本场 orchestration board。TDD RED 精确失败于缺 `RETRYABLE_STATUSES`/`retryTask`/handler/registry 及 generic stale→ready 未清 `finished_at`;GREEN 后 engine 508/508、CLI 定向 145/145,真实 CLI 隔离板验证 retry 后当前 task 仅留 `status:ready` + 布尔 `verified:false`,旧四项证据完整进入 `ccm/task-retry/v1` log。独立 review 唯一 P2 又发现 deps 未完成时 human render 错报中间态 `ready`;补充 RED 后以 reconcile 后的 `next` 逐项渲染,批量 E2E 同时观测 `GATED → blocked, FREE → ready`,对应 JSON/持久态一致。最终 `pnpm -C ccm build/typecheck/lint/test`、`bash run-tests.sh`(`ALL TESTS PASSED`)、skill/glossary lint 与 Claude plugin validate 全绿。
- **严重度 / 来源**:should-fix(lifecycle 正确性 + 审计完整性)/ 一手(2026-07-13 `review_codex_7d_pacing_final` stale 重跑实录 + clean-main 隔离板复现)。

## Finding #89 — Linux fd-path 通过不能证明 Darwin 可执行；统一 `fexecve` 补丁又因 Darwin 无该 API 双架构编译失败 · high(跨平台 verified-exec 假绿·tiered 修复待 PR 真机 gate)

- **现象**:GitHub Actions run `29250071954` 的真实 macOS arm64 与 x64 runner 都完成 SEA build、stage、activate、resolve，唯独 invoke 同样失败为 `spawnSync /dev/fd/3 EACCES`；同一失败也命中 handler runtime 的 pathname-swap TOCTOU 用例。第一版修复试图让 Linux/Darwin 共用 `fexecve`，但 follow-up run `29265829855` 的 `build / darwin-arm64` 与 `build / darwin-x64` 又同时在 native helper 编译期失败：Apple SDK 没有公开 `fexecve`，编译器只建议 `execve`。两个 run 共同证明 Ubuntu 详细 suite 只能为 Linux 最后一跳背书，不能外推 Darwin。
- **根因**:Node 保持 verified image fd 并不等于各 OS 都允许 fd 伪文件路径执行，也不等于各 POSIX OS 公开同一 descriptor-exec primitive。原实现把 Linux 成立的机制误提升为跨平台能力；第一版修复又把 Linux 的 `fexecve` 当成 Darwin API，虽然安全目标正确，平台契约仍是假的。release macOS job 原先只跑 `--version`，没有跑 stage→activate→resolve→invoke；加入真机 gate 后才连续暴露这两层错误。首轮同 run 的 APFS `stat`/systemd fixture 是测试仪器假红，已与产品根因分开。
- **影响**:ccm 在 Darwin 可安装、可 stage/activate/resolve，却无法启动已激活 runtime；若退回“重验 pathname 后普通 spawn”，会重新打开 verify→spawn 的 native pathname swap TOCTOU。只修 macOS 特判也会制造两个安全语义不同的 backend。
- **处置(含蒸馏判定)**:采用用户批准的 `tiered-path-attested` contract，不再伪造一刀切安全能力：Linux 保留 `linux-exact-fd-v1`，由 build-attested helper `fexecve` pinned fd，对 active pathname replacement 报 `resistant`；Darwin 使用独立 `darwin-path-attested-v1`，在最后 native handoff 内 `O_NOFOLLOW` 打开 pathname、比对 pinned/path fd 的 vnode identity + revision（含 `st_gen`）、重算 SHA-256、再次复核后立即 pathname `execve`。由于内核仍会在 userspace check 后重解析 pathname，Darwin 对 active same-UID replacement 诚实报 `residual`；要求 exact-object 的调用方用 `--require-assurance exact-object`，Darwin 在 child 创建前 typed `RUNTIME_INVOKE_ASSURANCE` fail closed。`resolve`/`doctor` 公布 assurance；macOS arm64+x64 workflow 同时检查 helper source/symbol/metadata、downloaded SEA invoke、mutation denial与 strict denial。本地 Linux 只证明 exact-fd 分支，Darwin 编译/endpoint 仍必须由 PR 真机 gate 背书。**蒸馏判定=回流 supply-chain spec + build/runtime contract + using-ccm reference + mutation/qualification gate，不新增 orchestrator skill 纪律**：这是平台执行 primitive 与证据边界，不是 agent judgment 方法论。
- **严重度 / 来源**:high(双架构产品 endpoint 阻塞·安全不变式相关；tiered 代码本地 Linux 绿，Darwin 支持资格待 PR 真机 arm64+x64 gate)/ 一手(GitHub runs `29250071954`、`29265829855` + 本 worktree spec/RED/GREEN/native mutant)。

## Finding #90 — Codex board-guard 把 `apply_patch` hunk 正文里的任意 `.board.json` 文本当真实写目标,误拦非 board hook 开发 → 目标分类必须只读结构化 file header · should-fix(开发阻断·已修)

- **现象**:dogfood 修改 `plugin/src/hooks/bootstrap-board/implementations/claude-code/bootstrap-board.sh` 时,`apply_patch` 的 `*** Update File:` 明确指向这个非 board 脚本,但删除/新增的 hunk 正文恰好包含 `.board.json` 字符串、regex 或真实 board 示例路径。Codex PreToolUse `board-guard` 仍把调用分类成 `board-write-single-path` 并硬拒,使正常 hook 开发无法继续;同形多文件 non-board patch 也会误拒。
- **根因 / 机制**:`applyPatchTouchesBoard()` 没解析 patch 结构,而是把整个 `tool.input` `JSON.stringify` 后对 `.board.json` / boards directory 做正则与 substring 扫描。它把控制面(file target header)和数据面(hunk content)混成一串文本,所以「正文谈到 board」与「目标真是 board」在分类器里不可区分;同时 malformed envelope 又可能因没有 board 字符串而放行,安全方向两头都错。
- **影响**:中——误报是 hard PreToolUse deny,会直接阻断 bootstrap/guard/lint 等最常需要处理 `.board.json` 文本的 hook 开发;若为消误报简单删掉 apply_patch 分支,又会让 Codex 绕过 `ccm` 唯一写关卡直接 Add/Delete/Update/Move 真 board,破坏 ADR-025 的纵深防线。
- **处置(含蒸馏判定)**:**已按 fresh review counterexample 持续聚焦返工；Round 6 exact-head 独立终审已完成，current-main exact-head 交付复审确认 runtime P0/P1=0，唯一剩余 P2 是本台账的编号 / 处置状态清理，尚未合并**——`plugin/src/hooks/board-guard/implementations/codex/board-guard-core.js` 只从 `*** Add File:` / `*** Delete File:` / `*** Update File:` / `*** Move to:` 收集 source/destination,hunk body 永不参与目标分类。返工用 Codex CLI 0.144.2 的真实 `apply_patch` filesystem effect 校准 section grammar 与跨语言边界:Add 的现有 body 行必须 `+` 前缀(空 Add 合法)、Delete 无 body、Update hunk 非空且非空行须 context/add/delete 前缀、`End of File` 只跟非空 Update hunk且后续非空内容从 `@@` 起;`Begin Patch` 后只容一个非空 `Environment ID`。显式状态 lexer 精确复现 Rust Unicode White_Space(含 U+0085、不含 U+FEFF)、top-level 两侧 vs Update control 只去尾空白、最多两枚物理行尾 CR、`End of File` 后 whitespace-only gap;hunk line 仍读 raw prefix。目标分类另只复现实测 filesystem-effect 的 embedded TAB/CR 删除,不清洗 FEFF/VT/FF 等其他字符,因此 Add/Delete/Update/Move 真 board target deny、non-board target allow,而 leading-space header-looking board 文本仍是 data。结构化写入同时枚举 `file_path`/`path`/`filename`,任一 board 即 deny,冲突/无效 multi-alias fail closed。三 host shell 判定也删除 command-word `ccm` 豁免:普通 `ccm --board` 无 shell write operator 继续 allow,`ccm ... > board`/`>> board` 因 shell 绕过 ccm 写关卡一律 deny。focused + parity fixtures 固化上述边界。**蒸馏判定=不回流 skill prose/不新增红线**——用户 agent 的「board 只走 ccm」纪律不变;最确定承载仍是 hook CONTRACT + host-native parser + 三端 parity 牙齿,避免把实现细节塞进 runtime skill。
- **Round 6 rootedness 追加闭环**:fresh reviewer 继续发现 effect cleanup 的顺序差一层——raw TAB/CR 开头、随后是 `/absolute-looking-board-path` 的 target 会先被 0.144.2 判为 relative,再删控制字节并落到 patch cwd 下的 shadow;旧 guard 却先全局删 TAB/CR、再 `path.resolve`,把合法 shadow 误升格成真实 absolute board 而 hard deny。现改为 raw target 先 `path.resolve` 固定 rootedness,再只删实测 TAB/CR;Add/Delete/Update 与 Move source/destination 都用安装版 parser 做 byte/effect parity,并以 default-reachable wrong-order mutant 锁住顺序。header colon 后第二个普通空格仍是 literal leading-space target,绝不借本修复 collapse。未 dogfood live board:本轮用户显式禁止触碰 live board,所以只在 disposable home/cwd 验真实 filesystem effect;此限制与证据边界一并留痕。
- **合并后缓存备注**:PR #105 修复期间，安装中的 cc-master `0.16.0` 旧缓存再次把同形非目标 patch context 误拦；地面比对确认旧缓存仍走整段 `JSON.stringify` 扫描，而本 worktree 已含 #104 合并后的 structured target parser。故本次归类为 installed cache stale 的既有 finding 复现，不是 current-main regression，也不重复建修复任务。
- **严重度 / 来源**:should-fix(硬拒正常开发、但未放松 board 安全闸·已修)/ 一手(dogfood task `fix_board_guard_patch_content_false_positive` 真实 `bootstrap-board.sh` patch repro + round 6 fresh review counterexample,2026-07-13)。

## Finding #91 — provider supervisor 的 pending promise 没有自己的 event-loop liveness,本地全量假绿而干净 CI 提前退出 · must-fix(CI 阻断·candidate 已关闭已知反例，待 fresh 终审)

- **现象 / evidence**:PR #105 的两次 `ccm-ci` 在 `provider-child-supervisor.test.ts` 首个纯 timer timeout case 取消，报 `Promise resolution is still pending but the event loop has already resolved`，其后 9 个 lifecycle case 被 parent 连带取消；而开发机 Node 24.18 单文件与本地全量均绿。复核 workflow 后确认 action 自身虽提示 Node 24 runtime，项目 test 实际由 `setup-node` 固定为 Node **22.23.1**；同版隔离运行稳定复现原错误。进一步用无其他 refed handle 的独立子进程 probe，在 Node 22.23.1 与 24.18 都以 unsettled top-level await / exit 13 确定性 RED，排除了单纯 runner 版本猜测。
- **根因**:`superviseProviderChild()` 把 startup/idle/hard timeout、TERM→KILL grace、reap watchdog 与 cleanup poll 的全部 timer 都调用了 `unref()`。JavaScript pending promise 本身不保持 Node event loop 存活；本地测试进程里其他 test/child handle 偶然托住了这些 timer，干净 shard 到纯 fake-child timeout 时没有旁路 handle，于是 supervisor 尚未产生 fail-closed timeout、reap 证据或 rejection，进程就先结束。首轮修复移除 `unref()` 后，fresh endpoint review 继续以 fake clock 抓到同一 owner 不变式的长延迟分支：`scheduleAt()` 对 >`2_147_483_647ms` deadline 分段 re-arm 时只把 hard timer 的新 handle 回写 slot，startup/idle 仍指向已经触发的旧 handle；terminal clear 因而留下 ref'ed orphan。Round 2 slot writer 关闭此分支后，下一轮 fresh review 又抓到 reentrant effect 顺序：custom tree 可在 `signal('SIGTERM')` 内同步 `close`，或 `onClose` finalizer failure 可由 cleanup poll 同步完成 typed reject；旧 `beginTermination()` 却在这些 terminal clear 返回后才登记 grace timer，制造 ownerless ref'ed late-arm。Round 3 又证明只保护 effect 内部仍不够：首个 stdout byte 调 `markSpawned()`，`onStarted` 抛错并由 synchronous TERM→close 完成 terminal clear 后，外层 `collect()` 仍继续 `observeActivity()`、late-arm idle timer；同类 caller 若在 `tree.isAlive()` 等外部 seam 返回后不复核 postcondition，也可能覆盖 primary error 或重复 termination effect。Round 4 进一步抓到 callback invocation 本身不是原子 effect：`onStarted` / stdout consumer 内先同步 `close(0,null)`、再 throw 时，旧 `onClose()` 会在 callback 返回前 resolve success，随后 `fail(consumer_error)` 被 `settled` guard 吞掉；若 callback 内先 error+close 再 throw，同样由 JS reentrancy 偶然决定 `spawn_error` 而非 callback contract 的 `consumer_error`。Round 5 则证明只延迟 terminal 裁决还不够：queued close/error/abort/parser failure 尚未 drain 时，`settled/primaryFailure/closed` 都未变，旧 provider-work gate 因而继续接收 terminal 后的 data/end/spawn、更新 bytes、arm activity/idle 并调用 consumer；close 成功结果甚至被 late bytes 污染。Round 6 再抓到 drain 自己可重入：队首 close 在内部 stdout finalizer 触发 consumer callback，callback `finally` 会递归 drain 其间追加的 error/abort，于是后到 failure 反超先到 close、把 FIFO success 翻成 `spawn_error`/`cancelled`；多个追加 effect 还会放大递归深度与顺序不确定性。现有 handler 的 600 秒 ceiling与真实 `ChildProcess` 通常异步 close 都会遮住部分反例，但 supervisor 自身接受这些 custom seam，不能拿默认实现的偶然时序替代合同。
- **影响**:普通 CI 被阻断；更承重的是，当 provider child/测试替身没有可维持 event loop 的 OS handle，supervisor 可能在 timeout 或进程树清理完成前消失，违背“失败路径 bounded settle + cleanup/reap 证据”的控制面合同。靠调整测试顺序、加 sleep 或保留无关 handle 只能继续隐藏产码缺陷。
- **处置(含蒸馏判定)**:**candidate 已关闭当前已知反例，待 fresh endpoint 终审**——supervisor-owned timers 在 supervision promise resolve/reject 前保持 Node 默认 ref 状态；`scheduleAt()` 接收所属 slot writer并在 lifecycle 已 terminal / failing 时拒绝 initial arm 与 recursive re-arm。`beginTermination()` 在 `signal()` 返回后复核 `settled`，未终结才在 cleanup poll 前登记 grace timer。更上层建立统一 `canContinueProviderWork()` postcondition：`markSpawned()` 显式返回 caller 能否继续，`collect()`、activity/idle arm、operational scheduler 与 ordinary stream-end finalizer在 terminal/failure/closed **或 pending terminal** 时一律 dormant；独立的 `canDrainTerminalEffects()` 只守 callback depth/settled，让 FIFO drain、`processClose()` 自身 finalization和reap proof不被队列反向锁死。`treeGone` 只可 false→true 单调推进。consumer callback 的 invocation boundary仍以 depth+FIFO 原子化：callback throw先固定 `consumer_error` primary，最外层返回后排空 terminal proof；正常 return维持首 terminal顺序，嵌套 callback、duplicate close、error+close与callback-induced abort不二次 settle。drain 另由 `drainingTerminalEffects` 的单 owner transaction guard 持有，且以 `try/finally` 保证异常时释放；处理中的 callback 只能向队尾追加，嵌套 drain 立即返回，只有外层 loop 按原序继续。若队首 effect 已 settle，后续 effect 统一清空忽略；若队首是 failure，则仍保持 failure-first。这里仍不越过证据声称“所有可能 terminal path 已证明”：当前机械证据覆盖 normal、long-delay、signal true/false、first-byte/spawn `onStarted`、stdout/stderr parser、abort、child error、sync close+return/throw、nested callback、error+close、callback-induced abort、pending terminal后的valid/invalid data/end/spawn/timer expiry、close internal finalizer 追加单个/多个 error/abort、`onClose` success/incomplete UTF-8 failure、tree probe与poll/reap seam，最终全称判断交给独立终审。没有新增常驻 keepalive wrapper、没有放宽 timeout、没有改变 TERM→KILL/process-tree authority，也没有延迟 callback 之外的正常 child事件。**蒸馏判定=回流产码不变式注释 + deterministic lifecycle test，不回流 runtime skill prose**：面向 orchestrator 的 supervisor/工业化指导没有缺口，本次是 ccm 实现违反既有合同；重复写 skill 只会把内部 timer 机制泄漏给用户 agent。
- **验证指针**:`ccm/apps/cli/src/provider-child-supervisor.ts`（ref 生命周期、slot owner、callback postcondition/atomic drain、ordinary/drain双gate、不可重入单 owner FIFO、单调tree proof与终态清理）、`ccm/apps/cli/test/provider-child-supervisor.test.ts`（无旁路handle + long-delay + synchronous callback arbitration/freeze/drain matrix）；Node 22.23.1 与 24.18 下，long startup/idle/hard均从active orphan=1收敛为0；signal/poll late-arm从grace=1收敛为零；first-byte `onStarted`从idle=1收敛为零，tree probe从重复TERM收敛为一次；Round 4的10个throw场景收敛为typed `consumer_error`，10个return/control维持原success/FIFO failure；Round 5的20个late-work场景从全部错误执行consumer或污染结果收敛为consumer计数不增、close结果bytes保持0/原值、全部active=0，throw/FIFO primary仍按合同且fake clock推进后无late SIGKILL/poll；Round 6 在双 Node 下把6个 close-first normal-return 确定性 RED（后到 error/abort/multiple 抢先）收敛为先到 close success，另10个 callback-throw 与 failure-first controls 维持合同，active=0 且 fake clock 推进后无 late effect；full ccm/root/plugin gates以同commit最终证据为准。
- **严重度 / 来源**:must-fix(CI 阻断 + provider timeout/process-tree 生命周期正确性·candidate 已关闭已知反例，待 fresh endpoint 终审)/ 一手(PR #105 两次 GitHub Actions clean-run 失败 + 本机 Node 22.23.1/24.18 deterministic RED→GREEN + 六轮独立终审反例,2026-07-13)。
