---
point: deadline.guards-and-boundary
---

## 权威陈述

<!-- ccm:k:start point:deadline.guards-and-boundary -->
下表每一行都是真实压力场景里**被命名并拒绝的诱惑**（不是编造的失败）——强模型能自己推翻它们，但跨 compaction 失忆、更浑浊的真实局面、或更弱的执行者未必。抓到自己在想左列，回到决策程序。

| 诱惑（DDL 场景下真实浮现的拉力） | 现实 |
|---|---|
| 「切片已验收、DDL 还有时间——顺手把它做得更完整 / 更亮眼一点。」 | 那是拿交付窗口换没人要的产出。「还有时间 / 更完整 / 收个漂亮尾」是关于你的完成感、不是关于 acceptance——acceptance 才是目标函数。已验收切片是最值钱的资产，派新活即 un-verify。增强进 `follow-up`。 |
| 「以后肯定要加更多 X——现在搭抽象比以后返工便宜。」 | YAGNI。从单个用例猜的接缝多半是错的，你会付两遍。「我熟这套能快速搞定」与「它该不该上临界路径」无关。简单性买回进度：把最不可靠的估时节点移出临界链。 |
| 「折中——只做那个『快又低风险』的一半 / 半就绪的薄抽象。」 | 半让步仍是让步。「快又低风险」正是让非 acceptance scope 混过闸的那句话；「half ready」通常是「错形、伪装成完成」，还制造 false sense of done。要么在 acceptance 内、要么进 backlog。 |
| 「现在还不确定会延期、报上去像杞人忧天——等这几个任务跑完再看。」 | 门槛是 actionability 不是 certainty。等确定，用户的延期 / 缩范围 / 分阶段选项已过期。cost 不对称：早报错了只花几分钟（可恢复），瞒着错了不可逆。「怕显得杞人忧天 / 累」是自利压力、不是进度证据。 |
| 「我先悄悄把最不关键的几个任务砍了、把 margin 抢回来，就不用惊动用户了。」 | 那既瞒了风险信号、又替用户做了 ownership 级决定。descope / extend / phase 是用户拥有的承诺决定——surface 成 `decision_package`，别自己吸收。 |
| 「DDL 逼近——把这几个任务串起来跑更稳妥。」 | 串行化不省 token 总量、只拉长 makespan。省的是降档 / 控 WIP / 推迟 float，不是焊死并行（消费机制见 `pacing-and-estimation`）。一条边指不出被下游消费的具体上游产物就删掉。 |

## 单向引用边界（别复述）

- **你（这份魂）** = 何时锁倒排约束、何时 surface 延期风险、何时 replan、scope 裁决——deadline-aware **决策**。
- **`slicing-goals-into-dags`** = 怎么把「从 DDL 倒排 + 收口任务进 DAG」切成纵切薄增量（纪律 1/2/7 的切分手艺）。
- **`pacing-and-estimation`** = 消费 `ccm estimate deadline-risk` 只读 verdict（band / margin / on_time_probability / 诚实字段），纪律 4/5 的读数机制——ccm 出 verdict、你决策。
- **`using-ccm`** = `ccm goal deadline` 命令面 + deadline 字段取值 / 校验规则。
- **`engineering-with-craft`**（纪律 3 手艺内容）/ **`dev-as-ml-loop`**（纪律 9 循环形状）/ **`references/goal-contract.md`**（识别·确认·过期·Delta Classifier·amendment）/ **`references/decomposition.md`**（CPM·float）/ **`references/async-hitl.md`**（decision_package）——各管一段，你在决策点引用，不复述其正文。
<!-- ccm:k:end point:deadline.guards-and-boundary -->
