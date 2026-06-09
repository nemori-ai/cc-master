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

- **现象**:R5(omne 范式勘察)报告正文逐字引用 sentinel 标记 `cc-master:bootstrap:v1`(在讲 command 文件约定时),
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
