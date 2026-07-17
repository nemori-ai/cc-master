---
title: 把经验蒸馏成资产
description: retro 读 board、列出候选经验；distill 把批准的候选落成真实项目资产——走 PR，绝不悄悄生效。
section: guides
order: 6
deeper:
  - label: distilling-lessons-into-assets SKILL.md —— 归宿路由判断力
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/distilling-lessons-into-assets/canonical/SKILL.md
  - label: ADR-027 —— retro/distill 两阶段拆分
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-027-distill-stage2-and-eighth-skill.md
---

一场编排结束，经验随之蒸发——除非你把它蒸馏出来。cc-master 把这件事严格拆成两个阶段：**retro 只读**（它不可能弄坏任何东西），**distill 是可写阶段**（因此由你显式批准 + PR 双重把守）。

## 阶段 1 —— retro：读 board，列候选

```
/cc-master:retro          # Codex：$cc-master-retro · Cursor：/retro · kimi-code：cc-master:retro
```

对**进行中或已归档**的 board 都可以跑。它读目标、审计日志、自驱决策记录和任务终态——绝不碰 GitHub、绝不回写 board——然后往*被编排的项目*里写一份 `*.retro.md`（项目有 `design_docs/retros/` 就落那里，否则落 `.cc-master-retros/`）。文档固定七节：发生了什么、调度与估算质量、HITL 成本、被验证有效的机制、踩过的坑，以及一份**候选经验**清单。每条候选带建议归宿类型、建议落点、证据（task id、log 条目、决策记录 id）和一份措辞草稿。retro 只提议，绝不动手。

## 阶段 2 —— distill：把候选路由成资产

```
/cc-master:distill <retro-path...>     # 一次可以消费多份 retro
```

distill 消费的是 retro **文件**——绝不回连 board、绝不调 `ccm`——把每条获批的候选落成目标项目里的真实资产：

| 资产 | 适合承载 | 不适合承载 |
|---|---|---|
| **纪律文档**（AGENTS.md、设计文档） | 持久的事实、项目专属的红线与惯例 | 可复用的判断力——埋进线性文档会被错过 |
| **skill** | 能迁移到其他任务的判断力或方法论 | 一次性事实；纯确定性形状 |
| **workflow** | 确定性的编排结构 | 需要临场判断的决策点 |
| **subagent** | 会被反复调用的专职角色（独立 persona/工具边界） | 一次性派发 |

路由决策树就三问：事实还是判断力？→ 是判断力的话，是确定性形状吗？→ 不是的话，需要 persona 吗？这个 skill 要堵的头号自我说服是：*「这条经验挺重要，得进 skill 才够重」*——重要不等于可复用。

## 一次 distill 怎么走

1. **一次性规划。** distill 对所有给定 retro 的候选去重合并，探测目标项目结构（有没有 skill 机制？subagent 目录？贡献约定？），渲染出一份结构化计划：每组改动的目标文件、合并来源、逐条证据，以及如实标注的冲突和降级项。
2. **你审一次。** 计划是唯一的强制断点。全批、部分批、打回重规划——批准之前不写任何文件。
3. **按目标文件执行。** 每个执行单元先读既有文件、套用它的文风，再落候选内容。
4. **PR 收口。** git 项目得到一条 feature branch、每个目标文件一个独立 commit、以及一份把完整计划写进 body 的 PR。非 git 项目（或 `--apply draft`）得到一个 `.cc-master-distill-drafts/` 草稿目录，供人工比对采纳。没有第三条「悄悄改完就算」的路。

## 唯一硬约束：证据忠实性

从候选草稿写进资产之间，**不允许任何脱离证据的改写或泛化**。措辞想跑到证据前面时，收窄回证据撑得住的范围——保留场景限定词——并显式注明（「已收窄：原候选草稿过度泛化」）。候选也绝不静默丢弃：归宿判不清或项目缺基础设施时，落最低成本的托底归宿（一条纪律文档指针），显式标注留待人工改判。一条判浅了被人纠正的经验，胜过一条凭空消失的经验。

## 什么时候不该蒸馏

- retro 里的候选单薄、只有单一事件、证据薄弱——让它们跨 retro 攒一攒；再多一份 retro 常常会自然合并或淘汰它们。
- 这条「经验」其实是个任务级修复——去修那个东西，别为它立规矩。
- 你在判断的是「某个能力该不该独立成 skill」——那是项目自己 skill 治理规范管的治理决策，不是本命令路由的事。
