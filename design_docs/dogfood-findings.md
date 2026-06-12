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

> 基线健康(无问题留痕):`claude plugin validate .` ✔;`run-tests.sh` 46 条 bash 断言 + 6 条 node 全绿;
> 三个 hook 纯 bash、无 jq/node;reinject 对诱饵同名键鲁棒;verify-board 的 `"id"` 计数不误算 session_id/log;
> bootstrap dual-sentinel 稳;authoring-workflows 的 5 template + API 契约自洽。**确定性骨架是健康的。**

---

## Finding #1 — skill frontmatter 的 YAML 被「冒号+空格」打挂,skill 以空 metadata 静默加载 ✅已修

- **现象**:`claude plugin validate .` 报错 —— `skills/orchestrating-to-completion/SKILL.md` 的 YAML
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

- **现象**:V 阶段首次真跑 `scripts/eval-trigger.sh orchestrating-to-completion`(20 query × 3 run,uv 3.12 + claude CLI):
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

- **现象**:对 POLISH-SOUL 产出做端点验收、逐行亲读 `skills/orchestrating-to-completion/SKILL.md` 时,发现 Vision-index
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

## Finding #34 — armed-gate 把 empty-session_id 的 active 板孤儿化;权威核实反证 codex 半个前提,对称 degrade 收口 ✅已修

- **现象**:codex CODEX12 指出 session-scoped 武装闸(`owner.session_id==stdin sid`)会把**未匹配 session_id 的 active 板静默孤儿化**,称这破坏「插件宣称的 board-based resume」:① 用户在「全新会话 restart」→ stdin sid 不匹配 → reinject 跳过 → resume 失效;② 升级时旧 active 板 `owner.session_id:""` → 不匹配 → 孤儿化。
- **根因 / 权威反证**:**先对官方文档权威核实(claude-code-guide,承 Finding #30 铁律:平台语义不凭断言)**,结论把 codex 的两幕**劈成一真一伪**——① **伪**:`claude --resume`/`--continue` **保留原 session_id**(`SessionStart.source:"resume"`,session_id 不变),compaction 也保留(`source:"compact"`);官方 resume/compaction 路径下 gate 照常匹配、reinject 照常工作。「全新独立会话接管旧板」**无官方范式**(sessions are independent),armed-gate 在全新会话休眠**正是设计目标(红线 6)**——ADR-007 的 Alternatives 早已**明确否决**「任何 active 板即武装」。所以 codex 第一幕建立在「resume 会换 session_id」这个**错误前提**上。② **真**:当 board 的 `owner.session_id` 为**空串**(bootstrap 若在缺 session_id 的 stdin 上建板就会盖空、或迁移/手改)时,它对任何非空 stdin sid 都不匹配 → **永久孤儿化**。这是真缺口——原 degrade 只对「stdin sid 空」放行,**没对称覆盖「board sid 空」**。
- **影响**:一块 `owner.session_id:""` 的 active 板会被所有 session 精确匹配的 hook 永久无视——orchestrator 起不来、reinject 不重注、goal-hook 不兜底。低概率(bootstrap 正常会盖非空 sid)但真实(缺 sid 的 UserPromptSubmit stdin 会触发)。
- **处置**:**对称化 degrade**——`owner.active 且 (stdin sid 空 ∨ board owner.session_id 空 ∨ 二者字面相等)` 即武装(4 hook:3 bash `board_matches` 各加 `[ -z "$board_sid" ] && return 0`、node `isArmed` 加 `if (!owner.session_id) return true`)。**只放行 empty-session_id(未认领板),「非空但不匹配」仍休眠**——端点亲手复现:`owner.session_id:""`+非空 stdin → 收养(block/warn);`owner.session_id:"OTHER"`+不同 stdin → 仍休眠(红线 6 防线一字未动,没退化成被否决的「任何 active 板即武装」)。同步两文档:ADR-007 §2.3 扩成对称 degrade + 新增「官方语义裁决」小节(resume/compaction 保 session_id、`source` 字段、sessions independent——故 resume 路径照常、全新会话休眠是设计目标、只 empty-sid 需收养),board.md 加一小段续跑三态(SSOT 指回 ADR-007)。
- **教训(固化)**:① **平台语义核实能反证 reviewer 的前提**——codex 是强 reviewer 但它对「resume 是否换 session_id」的隐含假设是错的;承 #30/#32,**任何「跨会话/续跑/事件在哪触发」类断言都要对官方文档端点验收**,核实结果可能让一条 finding 从「修代码」缩成「修半条 + 把另半条记成 by-design」。② **degrade/兜底逻辑要查对称性**:已为「我方(stdin)缺值」兜底时,对面(board)缺同一字段往往也要兜——单边兜底是常见盲区。③ **by-design 与 bug 要写进 ADR**:全新会话休眠是设计目标,不写明就会被一轮轮 reviewer 反复当 bug 提;ADR-007 现已把官方语义裁决固化,后人不必再 litigate。④ 承 #30/#32:本 PR 第三例「平台语义经权威核实改变结论」(#30 推翻研究文档、#32 坐实 codex、#34 半推翻 codex)——三种走向都只有真查官方才得到。
- **严重度 / 来源**:should-fix(empty-sid 板孤儿化,低概率真实;另半条 by-design 澄清)/ 一手(codex 第二端点验收 CODEX12 + 官方文档权威核实,本 PR)。
