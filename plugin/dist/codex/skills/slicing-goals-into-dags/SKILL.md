---
name: slicing-goals-into-dags
description: 'Use when you (orchestrator) carve a goal/epic into a board DAG —— 当你要把一个目标 / epic 切成 board 任务依赖图时:怎么拆、先做什么、任务多大粒度、纵切还是横切、怎么尽早 ship 可用增量 + 最大化并行。教敏捷切分的道与品味:纵切薄增量(非横切技术层)、walking skeleton、粒度为并行与验收而定、按价值/风险排序、切片映射到 cadence/iteration。Triggers: "这个目标怎么拆 / 先做什么后做什么"、把 epic 拆成 board、定任务粒度、纠结纵切 vs 横切、想尽早 ship 一个可用增量 / 想拉满并行度。Do NOT use when 一张已切好的 DAG 怎么排期 / 算临界路径(那是 master-orchestrator-guide 的 decomposition 一段)、切好后怎么派发(master-orchestrator-guide)、单个 task 怎么实现到验收(dev-as-ml-loop)、怎么用 ccm 把 task 写进 board(using-ccm)。'
---

# slicing-goals-into-dags —— 把目标切成一张好 board DAG

> 这是把一个目标 / epic **切**成 board 任务依赖图的**敏捷方法论与品味**——回答"怎么拆出一张好图",不是"一张已成形的图怎么排期"(那是 master-orchestrator-guide 的 decomposition 一段)。
>
> **职责边界:** **切**(carve)归本 skill;**排**(schedule:CPM / 临界路径 / 并行度计算)归 master-orchestrator-guide 的 board 协议 reference;**派**(dispatch)归 master-orchestrator-guide;**执行**单个 task 到验收归 dev-as-ml-loop;**写进** board 归 using-ccm。本 skill 只管"怎么把目标切成图"这一刀。

---

## 为什么这一刀最值钱

**你怎么切,定死了后面一切的天花板。** 并行度、多快能 ship、多快拿到反馈——全在切的那一刻就定了,**排期再优、派发再快也救不回一张切坏的图**。一张横切的图,哪怕关键路径算得再准,也照样把价值堆到最后、把本可并行的活人为串成一条线。所以:**切,是高杠杆决策;别急着排和派,先把它切对。**

---

## 心智锚 1:纵切,不要横切 ★硬规则

把目标切成**薄的、端到端的纵向增量**——每一片自己穿过所有需要的层、交付一个用户(或下一个消费者)**真能触碰**的能力;**不要**按技术层横切(全做数据模型 → 全做 API → 全做 UI)。

- **纵切**:`添加支出(端到端:够用的 schema 片 + 一个 endpoint + 最小表单)` / `看列表(端到端)` / `月度图(端到端)`——每片是一根穿层的细线。
- **横切**:`T:数据模型层` → `T:后端层` → `T:前端层` → `T:测试层`——每个节点是一整层。

> **落地**:每个纵切片 = 一个带 `--accept`(自己的 DoD)的 `ccm task`,片之间的真实数据依赖用 `--deps` 连。横切那种"一整层"节点往往**给不出自己的 DoD**——难端点验收,这本身就是切错的信号。命令语法见 `using-ccm`。

横切为什么是默认、又为什么是错的:它**感觉**像工程严谨(地基先打牢),实则把地基做成 serial 瓶颈(并行度=1 直到它完成)、把任何可用价值推到最末、且那个"打牢的地基"是**投机的**(你还没切片,根本不知道下游真正需要什么)。

### Rationalization Table —— 横切最常见的自我说服

| 你会对自己说 | 现实 |
|---|---|
| "schema / 地基要**一次定干净**,不然下游 API 要返工。" | 这正是横切的合理化。它把地基做成并行度=1 的 serial 瓶颈、把可 ship 推到最后,而"一次定全"是投机——你还没跑通一片纵切,不知道真需要哪些字段。返工风险用**薄切 + 早集成**对冲,不用"大设计先行"。 |
| "按功能纵切,多个片会争抢同一个 schema,并发冲突 / 重复劳动。" | 真正共享的只有 schema 的**最小核心**(walking skeleton 的脊椎)。把**那一薄片**作为唯一前置(锚 3),其余纵切;不是把整个 schema/API 层都前置。共享的是脊椎,不是整层。 |
| "先把骨架搭全了再往里填,效率高。" | "搭全骨架"= 横切伪装成"一次性基建"。骨架要的是**最薄的一条端到端线**(walking skeleton),不是一整层。薄线先跑通,后续纵切各自延展骨架。 |

> **违背字面就是违背精神。** "我这次是真有强共享依赖,所以得先打地基"——几乎每次横切都这么辩。先问:共享的是 schema 的**不可再薄的核心**,还是你想顺手定全?只有前者配前置,且前置的是那一薄片,不是整层。

---

## 心智锚 2:walking skeleton —— 地基切到最小可用子集,而非一次定全

第一片不是"地基层",是一根**最薄的端到端线**(walking skeleton):穿过所有层、但每层都只做让这一根线跑起来的最小量。它一举两得——**早早打通集成**(最贵的风险:各层接不上,提前暴露)+ **立起共享脊椎**(后续纵切都挂在它上面)。

- 共享 schema:第一片只定**这根线用到的最小字段**;后续每片**按自己所需**给 schema 加列——schema 随纵切**增量生长**,不在 T2 一次定全。
- 前置依赖**只放不可再薄的共享核心**(脊椎),让尽可能多的纵切片在脊椎就绪后**立刻并行铺开**。前置得越多,并行度被掐得越死。

---

## 心智锚 3:粒度,为并行与可验收而定

每个节点的大小,由两个问题校准,不由"感觉差不多"定:

1. **它能和兄弟节点并行吗?** 太粗 → 一个巨型节点把本可并行的活吞成一条 serial 线(并行度坍成 1);切到"无真实数据依赖的片彼此独立"为止——但别为切而切。
2. **它有一句清爽的验收(DoD)吗?** 一个节点若说不清"做到什么算完",它就太大 / 太糊,端点没法验收。一个节点 = 一个可独立验收的纵切片。

太细也是病:微任务多到协调开销 > 干活本身。`estimate` 给手感反馈——某片估时畸大 → 考虑再切;碎到 trivial → 并回去。**cadence target 是一把硬尺的软提醒**:如果一片的 estimate 超过本轮 `ship_every`,默认先再切,除非你能写清楚为什么这片不可再拆且仍值得独占一个 timebox。

> **落地**:粒度的两把尺都是 board 字段——`--accept`(给不出一句清爽验收 = 太大 / 太糊)+ `--estimate`(`3h` / `2d`,畸大就再切)。这两个字段也正是 `dev-as-ml-loop` 接手该片时的目标函数与步长参考。命令见 `using-ccm`。

---

## 心智锚 4:按 价值 × 风险 排序

切完是一组片,**先做哪片**有讲究:

- **价值优先(节奏)**:把用户**最早能用上**的那片排前面——让"第一个可用增量"尽快落地,而不是攒到最后大爆发。
- **风险优先(去风险)**:把**最不确定 / 最可能翻车**的集成,用一根 spike / walking skeleton 早早穿过去——把"做不出来"的发现提前到便宜的时候。
- 二者常合一:**最薄的那根线,往往既穿过最险的路径、又交付一小条可用价值**——这就是 walking skeleton 该选的方向。

> **落地**:硬先后(脊椎必须先于依赖它的片)用 `--deps` 编码进 board;但**同为 ready 时先派哪片**(价值还是风险优先)是 **dispatch 决策、归 A**(`master-orchestrator-guide`),不是 board 上的某个字段。本 skill 负责切出"谁依赖谁"的结构,A 负责在就绪集里挑先后。

---

## 落到 board

- **一片纵切 → 一个 task**;若这片自身还需内部并行,做成一个 owner 父节点 + 若干 leaf 子节点(嵌套 depth=1)。
- **共享脊椎 → 那一个 foundation task**,纵切片依赖它;**死守它的依赖者最少**——只有真共享核心才连上去,别把半个 schema 层挂成全图前置。
- **片分组进 `cadence`/`iteration` timebox**:每个 iteration 收口时至少 ship 一片可用增量(接 board 的 cadence 模块——节奏在这落地)。一轮里的 members 估时总量与关键路径要能放进 timebox;放不进时先重切/移出,不要把超载当成排期问题留给后面。
- **`estimate`** 回喂粒度调参(锚 3)。
- 切好的图怎么**写进** board(`ccm task add --deps ...`)→ using-ccm;怎么**排期 / 算临界路径** → master-orchestrator-guide 的 board 协议 reference。

---

## anti-pattern 速查

| 反模式 | 为什么坏 / 怎么改 |
|---|---|
| **横切分层**(schema 层→API 层→UI 层) | serial 瓶颈 + 价值堆到最后。改纵切薄增量(锚 1)。 |
| **大爆炸节点**(一个 task = 半个系统) | 并行度=1、没法验收。按"能并行 + 可验收"再切(锚 3)。 |
| **单片吞掉 cadence**(一个 task 估时大于 `ship_every`) | 这通常不是薄纵切。默认拆成几个可验收切片;真不能拆时写明不可拆理由。 |
| **瀑布顺序**(先把全部设计 / schema 定完再实现) | 投机的大设计先行 + 推迟集成风险暴露。改 walking skeleton(锚 2)。 |
| **镀金地基**(把共享 foundation 做到"完整完美"才往下) | 你还不知道下游要什么;前置只放最小脊椎(锚 2)。 |
| **过度切碎**(几十个微任务) | 协调开销 > 干活。estimate trivial 的并回去(锚 3)。 |
| **假串行边**(为"稳"给无真实数据依赖的片画依赖) | 人为掐死并行。只画真实数据依赖边(排期细节归 master-orchestrator-guide)。 |

---

## Pointers

- **[references/worked-example.md](references/worked-example.md)** —— 同一个目标的横切 vs 纵切对照样例；当你脑中还只有"先 schema/API/UI"这种横切本能时，先看它校准切法。
- **master-orchestrator-guide** —— 切好的图怎么**排期**(CPM / float / 临界路径 / 并行度计算,在它的 board 协议 reference)、怎么**派发**(按 Codex adapter 已验证的后台机制选择)。本 skill 是"切",它是"排 + 派"。
- **dev-as-ml-loop** —— 切出来的**单个 task 怎么执行到验收**(把验收当 objective 迭代逼近)。本 skill 切出带验收的片,dev-as-ml-loop 把每片做到验收。
- **engineering-with-craft** —— 切出的单 task 执行时,除 dev-as-ml-loop 的循环**形状**,还要 engineering-with-craft 的手艺**内容**(片内 SDD→DDD→OOP→TDD 怎么建模 / 写类 / 测试)。本 skill 切片、engineering-with-craft 定义片内每一棒的手艺。
- **using-ccm** —— 怎么把切出的 task / deps / estimate / cadence **写进** board(`ccm task add` / `cadence open` ...)。
- 切片 → board 字段的协议细节(task / parent 嵌套 / cadence / estimate schema)见 using-ccm 的 board-model-guide。
