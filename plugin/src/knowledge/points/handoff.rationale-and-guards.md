---
point: handoff.rationale-and-guards
---

## 权威陈述

<!-- ccm:k:start point:handoff.rationale-and-guards -->
交接的最后一步是把 board **归档**（`owner.active:false`，同 `/stop` 机制）。这看着反直觉——「我在交接，为什么要停用它」——但它正是让新 session 接手最顺的那一步：

- **归档板的 `--resume` 走无摩擦路径**：`as-master-orchestrator --resume` 对一块 `owner.active:false` 的归档板**无需 `--force-takeover`**——直接复活（`false → true` + 重盖 `owner.session_id`），因为归档是「这块板当前没有活 owner」的显式信号，不存在跨 session 抢占活 owner 的风险（这正是「复活归档板」的无摩擦路径）。反之，若你把板留成 `owner.active:true` 就切走，新 session resume 会撞上「这板看着仍有活 session」的接管安全闸（heartbeat + mtime 探测），要 `--force-takeover` 二次确认——平白给交接加一道摩擦。
- **归档是显式可逆，不是删除**：board 文件保留，`tasks`/`log`/`goal`/`git` 全留——归档只把 `owner.active` 翻成 `false`。新 session `--resume` 把它翻回 `true` 即满血复活。这也是 §1 第 4 步「log 留指针」要先于归档的原因：归档前把指向 handoff 文档的指针落进 board.log，新 session resume 读 board 时一眼看到「去读那份 handoff」。

---

## Rationalization Table

切 session 时（累 + context 快耗尽 + 怕丢 mental context）最易成形的几条借口，与真相：

| 借口（切 session 时会对自己说的话） | 真相 |
|---|---|
| 「我不在了没法答问，**为稳妥把整个 board 也 dump 进 handoff**，belt-and-suspenders。」 | 那是造**第二份会过期的真相**，不是稳妥。board 是活的、你 dump 的是冻结快照；新 session 一动手，board 对、你那段成了读起来像权威的谎。一份和 live board 打架的文档比没有还糟。指向 board，别复抄。 |
| 「**再用英文把每个 task 的 status 走一遍**，新 session 看着省事、不用 parse JSON。」 | 「省得 parse JSON」省的是一笔不存在的成本——新 session 用 cc-master 机制读 board，不手 parse。一段 prose 形态的 per-task status 走查，**形态是叙事、本质是 board `tasks[]` 的英文转写**，是噪声。叙事 carries 的是 board 装不下的（why / 死路 / 综合判断）。 |
| 「**那我只走临界路径那 5 个 task 的 status**，折中，不全 dump。」 | 折中是错答案穿了件小一号的衣服——它保留的正是错的那类内容（live state 的冻结副本），只是少一点。「该往哪推」的结论本就由第 5 段一行综合判断 carry，不靠复述那 5 个 status。砍到 5 个不解决漂移。 |
| 「Registry 里有 handle / attach command，**整批不验也能交给新 session**。」 | Registry 提供恢复证据，不替父 task 验收，也不保证每个 agent 仍活或可接。straggler 兜底只对**真排不空的那一个**；能在合理窗口内 drain+验的整批，仍应当前 session 验完。 |

---

## Red Flags —— 停，你在往 handoff 文档里塞噪声 / 跳过 drain

- 你正要把 board 的 DAG / task 列表 / 全量 status 复制进 handoff 文档（造第二份会过期的真相）。
- 你正要「用英文把每个 task 的 status 走一遍」——哪怕只是临界路径那几个（prose 形态的 board 转写仍是噪声）。
- 你以「我不在了没法答问」为由往文档里加 board **已经装下**的东西（该加的是 board 装不下的 why / 死路 / 综合判断，不是 board 内容的副本）。
- 你正要把一整批**能在当前 session drain+验**的在飞任务全甩成孤儿，只为早点切走（straggler 兜底只对真排不空的单个任务）。
- 你正要留着 `owner.active:true` 就切走（给新 session resume 平白加一道 `--force-takeover` 摩擦——归档它）。
- 你正在为「*这次*交接特殊，多 dump 点 board 内容总没坏处」构建论证——那套论证本身就是症状。

> **违背字面就是违背精神。** handoff 文档的纪律是「叙事层 carries board 装不下的，绝不复抄 board 已装下的」——当你开始论证「这段 status 走查写成了英文所以算叙事」，那正是噪声穿叙事外衣的那一刻。
<!-- ccm:k:end point:handoff.rationale-and-guards -->

## 失效类型

`motivation_conflict`（主体：行为约束） —— 知道 handoff 文档不该复抄 board、该只写 board 装不下的判断，但在“接手的人可能没法问我”的焦虑下，仍会倾向于把状态多写一点求稳。

归档机制的解释之外，主体是 Rationalization Table 与 Red Flags——压力下会被合理化掉的交接纪律。

## 为什么它随模型变强而更重要

模型的文笔越流畅，越能把一段纯粹的 status 转写包装成读起来像是有独立判断的叙事，让接手者分辨不出这段话到底是在转述 board 还是真的提供了 board 之外的信息，以假乱真的门槛随文笔能力一起降低。
