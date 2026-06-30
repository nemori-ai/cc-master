# ADR-019 — Skill portfolio 重排：退役 account-management（C）+ 新增 pacing-and-estimation（H）+ 切 A/H 边界

> Status: **Accepted**（用户拍板「SKILL3 抽 1 个顶层 skill `pacing-and-estimation`、PHASE4 退役 account-management」·2026-06-29）
> Date: 2026-06-29
> Scope: 分发 skill 集 7→7（-C +H·成员变更）。新增 `skills/pacing-and-estimation/`（SKILL.md + DESIGN.md + OBJECTIVE.md + 4 references + evals/）；退役 `skills/account-management/`（整册删除，含 scripts + 6 个测试它的 plugin-side 测试）；SKILL A 抽走消费机制、留决策锚（镜头 5/2 正文不删 + 决策程序 §(f) 牙齿不动 + 新建 `references/cost-decisions.md` 承换号决策锚 + 删 `references/cost-and-pacing.md`）；SKILL D（using-ccm）吸收 account 操作面（command-catalog 加 namespace account + 新 reference `account-pool.md`）；`/cc-master:accounts` 命令**直接退役删除**（用户拍板·非瘦成 wrapper）；AGENTS §2/§3/§6/§12/§N + skill-lint.sh 七名单同步。**hook 一字不动**（pacing/换号是 ✎/带外·hook 不读 skill 边界）。
> Source: `design_docs/plans/2026-06-29-skill-portfolio-rework.md`（过 curating 设计闸 + orchestrator 复核背书）；用户拍板覆写 2026-06-26 报告「estimate/usage 消费做成 A 的 reference」判定。
> Co-signed: user (owner)

---

## 1. Context

cc-master v0.9.x 的分发 skill 版图是 A–G 七个。两块在飞重构同时咬到这张版图：

- **ccm `account` 引擎已落地**（add/refresh/delete/list/switch + 8 模块引擎·`@ccm/engine/account`·git `a463d0a`/`4a8be4e`），换号机制的 SSOT 已迁进 ccm。SKILL C（`account-management`）的 bash 脚本（`switch-account.sh`/`select-account.js`/`accounts-lib.js`…）**降为冗余旧实现**——agent 不再直接跑它们，改跑 `ccm account`，token 全在 ccm 子进程。
- **ccm `usage`/`estimate`/`baseline` 只读 advisory namespace 已落地**（ADR-015），pacing 走廊数学 + OR/ML 估算收口进 `@ccm/engine`。但**消费这些 advisory 的指导**此前埋在 SKILL A 的 `references/cost-and-pacing.md` 里——它跳层、不被 router 召回；尤其 **estimate 整轴在任何编排决策点完全零提及**（2026-06-26 前序报告 §3 根因 2「整轴缺席」），agent「该 forecast 工期 / 查 EVM 偏差」时默认想不到（out-of-mind）。

2026-06-26 前序报告曾按 curating 启发式判 estimate/usage 消费「不新建 skill、做成 A 的 reference」（理由：触发语境与「正在编排」同一 → pure-augmentation → reference）。**用户拍板覆写**：抽成顶层 skill 以求**可发现性**（顶层 `description` 可被 router 召回 vs 埋进 reference 永不触发）。本 ADR 记录这次结构决策，不 re-litigate WHETHER（用户已拍板「要做」），只定 HOW + 边界。

设计张力（决定本 ADR 三取舍的根）：

- **冲突仲裁（AGENTS §4）：用户显式指令 > skill 默认启发式。** curating 的「pure-augmentation → reference」是默认启发式；用户拍板「抽顶层求可发现性」是显式指令——后者优先。
- **抽顶层不能掏空 A 的魂。** A 的 Probe 价值在编排路径与红线（指挥不演奏 / gate≠passed / 该问就问），不在「usage verdict 怎么读」——切线必须把决策锚留 A、只抽消费机制。
- **退役 C 不能丢机制 / 丢安全。** C 的内容必须四路归位（操作面 / 概念叙事 / 实现 / 决策），且退役前确认 ccm `account switch` 承接了 ADR-016 的 policy 硬闸。

## 2. Decision

**SKILL portfolio 7→7：退役 `account-management`（C）、新增 `pacing-and-estimation`（H）、把消费机制从 A 抽进 H 而决策锚留 A、account 操作面归 D。**

### 2.1 新增 H（`pacing-and-estimation`）—— Probe 准入

三必维：D1 audience=插件用户面（进 `skills/` 分发）·D2 单一职责=消费 ccm 只读 advisory 配速+估算·D3 Probe A:strong + B:strong → 准入。

- **Probe A（增量）= Strong A.1（新领域知识）**：`ccm usage advise` / `estimate forecast` 等全自研命令的输出 schema 与 verdict 语义（throttle/accelerate/hold/hard_stop、p50/p80/p95、CPI/SPI、CI/CRI/SSI）+ 四档模型相对 multiplier + 5h/7d 信号源链 + 估算诚实字段——agent 先验不携带、推不出、必须教。
- **Probe B（覆写）= Strong B.2（触发覆写）**：estimate 整轴 out-of-mind（前序报告 §3 根因 2），顶层 description 的 router 可发现性正是克服「想不到去查」的机制。
- **注**：A.3（新路径）弱 + B.1（倾向覆写）弱——pacing/tiering 的 subagent pressure baseline 实证**零失败**（model-tiering ×6 / usage-pacing ×2）→ H **不配重型 Rationalization Table**（skillsmith 铁律：无 RED 不造纪律 prose）。H 是 Craft B 心智模型 + A 机械配方，命名锚为主、命令面/档位表下沉 reference。

### 2.2 退役 C（`account-management`）—— Probe 塌缩

C 原本双 strong，但两个 strong 形态都被 ccm 迁移抽空：

- 原 **Strong A.2（新能力·选号算法 / 无重启切号配方）** → 配方已是 ccm 引擎内部实现，agent 只需 `ccm account switch` 一条命令 → A.2 **塌缩**。
- 原 **Strong B.1（倾向覆写·token 安全命门）** → agent 已不直接碰 token（全在 ccm 子进程）→ 被覆写的默认失败触发场景消失 → B.1 **塌缩**。
- 两 strong 塌缩 → C 从双价值掉到装饰（Weak+Weak）→ 退役。**不是「为简化而砍」**，是 Probe 复判后 C 确实已不站得住。

内容四路归位：① 操作面 → D 的 command-catalog（namespace account 5 verb）+ `/cc-master:accounts` 命令**直接退役删除**（账号操作全归 `ccm account` CLI·用户直接敲·token-blind；自动切号在 usage-pacing hook 机械触发；知识在 using-ccm/account-pool.md → 一个 agent-facing 命令零增量零覆写 = 装饰，故删而非瘦成 wrapper）；② 实现 → 已在 ccm 引擎 `@ccm/engine/account`（不复述）；③ 概念叙事（号池模型 / 录号 why / refreshToken 硬要求 / 选号方法论 / vault 两形态 + 明文 floor）→ D 新 reference `account-pool.md`；④ 换号**决策**（lever 阶梯 / policy 授权 / 绝不自授权）→ A 的新 reference `cost-decisions.md`。**C 的重型 token 安全 Rationalization Table 退役不复活**——它守的「agent 手改 vault / cat token / set -x 泄漏」触发场景已随「agent 不再直接跑 token 脚本」消失。

### 2.3 切 A/H 边界

> **决策锚 + 镜头留 A；消费机制知识抽进 H。** A own「**该不该**减速/加速/换号/replan」的判断（镜头 5 全文 / 镜头 2 一行 / 决策程序 dispatch §(f) 7d 闸 / 换号 lever 阶梯）；H own「**怎么读** ccm 这些 advisory 的 verdict 字段、模型档位、信号源、诚实字段」的消费机制。

- **留 A**：镜头 5/2 正文一字不删（只把指针从 `cost-and-pacing.md` 改指 `pacing-and-estimation` skill）；决策程序 §(f) 7d 硬总闸**牙齿不动**（AGENTS §5：决策程序骨架结构性改动走红线级 PR 人审）；换号决策锚下沉 A 的新 `references/cost-decisions.md`；Rationalization Table pacing 条目留 A。
- **抽 H**：旧 `cost-and-pacing.md` 整篇（model-tiers / usage-signals / pacing-levers）+ 新估算消费（estimation.md）。旧 `cost-and-pacing.md` 删除（避免双 SSOT）。

### 2.4 退役 C 的测试归位

ccm `account` 引擎有自己的 CI 测试套件（`ccm/**/account-*.test.ts` + `handler-account*.test.ts`）。plugin-side 测试 C 旧 bash 脚本的 6 个测试（`tests/hooks/test_account-add.sh` / `test_switch-select.sh` / `test_account-list.sh` / `test_accounts-delete-line.sh` / `tests/content/select-account.test.mjs` / `accounts-lib.test.mjs`）随脚本一并删除——它们测的是被退役的冗余旧实现。`usage-pacing.js` hook 不受影响（它**内联**最小 registry 读取算 effective-N，不 require 已删的 `accounts-lib.js`；`test_usage-pacing.sh` 自建 accounts.json fixture，保留）。

## 3. Consequences

### 3.1 Positive

- estimate 整轴从「out-of-mind」升为顶层可发现 skill（B.2 落地）；pacing/估算消费有单一可召回归宿。
- C 的装饰重量去除；换号机制单一 SSOT 在 ccm 引擎（不再 skill prose + 引擎双份）。
- A 更瘦（reinject 友好）：抽走消费机制后魂仍 Strong+Strong，魂在编排路径与红线。

### 3.2 Negative

- account 操作面与号池概念叙事现分散在 D（操作面 + 概念）+ ccm 引擎（实现）+ A（决策锚）——靠单向引用闭合，跨界 review 成本。
- H 的模型档位表 / 信号源是会 stale 的事实快照（SSOT 在 `claude-api` skill / 官方文档 / ccm 引擎），需随之锁步（scaffolding 定位已承认）。

### 3.3 Neutral

- 分发 skill 数不变（7→7）。Track A trigger eval 与 pressure baseline 的实际跑（需 uv + claude CLI subagent dispatch）作 pre-release 检查、非发布门（Finding #74：advice-shaped query 本就难触发，Track A 不作 H 的 gate）。

## 4. Alternatives Considered

### 4.1 抽 3 个 skill（pacing / estimation / usage 各独立）

否。usage/estimate/baseline 在 orchestrator 视角是「同一拍要一起看的两组只读 advisory」——bounded-context 单一。拆 3 个触发 D2 失败（每个都不是完整职责）+ 过度碎片化 + 3 个 advice-shaped description 互抢触发。**抽 1 个 `pacing-and-estimation` 是对的粒度**（用户拍板）。

### 4.2 把消费知识留作 A 的 reference（2026-06-26 报告判定）

否（用户覆写）。前序报告漏判了 **B.2 触发覆写**（只跑了「触发语境同一 → reference」启发式，没把「estimate 整轴 agent 默认想不到」这条 B.2 跑出来）。reference 埋在 A 里**确定**不被召回；顶层 skill **至少有机会**被 router 召回。决策矩阵 Strong A + Strong B = 必建。

### 4.3 退役 C 保留瘦壳

否。两个 strong 形态都被 ccm 迁移塌缩 → 瘦壳 = 装饰重量。整册退役。

## 5. Related

- 立项计划：`design_docs/plans/2026-06-29-skill-portfolio-rework.md`（curating 设计闸 + Probe A/B + 重叠检测）。
- 覆写对象：2026-06-26 `skill-optimization-for-ccm-namespaces` 报告的「做 reference」判定。
- ADR-005（两 skill 分离原则·现扩到七个·成员 -C +H）；ADR-015（ccm usage/estimate/baseline 只读 advisory 引擎·H 消费的对象）；ADR-016（policy 硬闸·换号决策归 A、机制硬闸现由 ccm `account switch` 承接·exit 7）；ADR-014（ccm 解耦·account 引擎是消费方边界）；ADR-010（双侧走廊·H 消费其 verdict）。
- curating-skill-portfolios（cross-major review owner）；cc-master-skillsmith（craft 自分类 + 无 RED 不造纪律铁律）。

## 6. References

- skillsmith 铁律「无 RED 不写重型纪律 prose」+ curating Probe A/B 决策矩阵（`Strong A + Strong B = 必建`）。
- Finding #74（advice-shaped query 难触发·Track A 不作 H 发布门）。
