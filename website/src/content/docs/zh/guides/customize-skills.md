---
title: 定制 skill
description: 八个分发 skill 决定每场编排怎么想——改 canonical 源，重新投影，再压测你的改动。
section: guides
order: 1
deeper:
  - label: cc-master-skillsmith —— skill 创作 meta-skill（skill 的 TDD）
    url: https://github.com/nemori-ai/cc-master/blob/main/.claude/skills/cc-master-skillsmith/SKILL.md
  - label: AGENTS.md —— 仓库约定与六条红线
    url: https://github.com/nemori-ai/cc-master/blob/main/AGENTS.md
  - label: scripts/sync-plugin-dist.sh —— source-to-adapter 投影器
    url: https://github.com/nemori-ai/cc-master/blob/main/scripts/sync-plugin-dist.sh
---

插件的行为不是硬编码的——它是由八个注入 agent context 的 skill **教出来**的。要改变你团队里每场编排拆工作、配速、验收的方式，就改 skill 的 prose。这让 skill 成为全项目杠杆率最高的定制点。

## 八个 skill

| Skill | 管什么 |
|---|---|
| `master-orchestrator-guide` | orchestrator 身份与决策：派发、续跑、验收、换号授权、DAG 排期 |
| `slicing-goals-into-dags` | 怎么把目标切成薄的、可并行的、可验收的增量 |
| `using-ccm` | `ccm` 操作手册：命令面、board 模型、字段取值、全部 lint 规则 |
| `pacing-and-estimation` | 怎么消费配额/估算 advisory——verdict、模型档、诚实字段 |
| `authoring-workflows` | 怎么写确定性 workflow 脚本（在支持的 host 上） |
| `dev-as-ml-loop` | 执行侧循环：把单个任务当 ML 过程优化到验收 |
| `engineering-with-craft` | 工程手艺：DDD/OOP/SDD/TDD 五根与红线 |
| `distilling-lessons-into-assets` | 经验怎么路由成纪律文档、skill、workflow 或 subagent |

每个 skill 各管一个平面、互不重叠——决策归 guide、机制归 `using-ccm`，依此类推。改的时候守住这条边界：把一段话塞进错的 skill，就是制造第二真相源。

## 在哪里改

改 **canonical 源**，绝不碰生成的 adapter 产物：

```
plugin/src/skills/<skill>/canonical/SKILL.md        # 主文件——保持瘦
plugin/src/skills/<skill>/canonical/references/     # 深度细节住这里
plugin/src/skills/<skill>/adapters/<host>/strategy.yaml  # 各 host 投影
```

`plugin/dist/<host>/` 是生成物。新的长文内容放进 `references/` 并从主文件给指针——guide skill 每次 compaction 后会被整篇重注，你加进主文件的每一行都在每个回合烧 context。

## 写作纪律

- **对 agent 说话，而不是描述文档。** 第二人称、imperative、agent 是行动者。不要维护者旁白，不要「本文件是 X 的魂」，不要设计理由注解。
- **自包含。** skill 只能引用随插件分发的文件。不引用仓库文档、ADR 路径、内部代号——读者是用户机器上的 agent，不是 cc-master 开发者。
- **frontmatter 的 `description` 是路由器，不是简介。** 它决定 skill 触不触发：何时用、触发词、别用边界。整个值用单引号包起来——内嵌冒号会让 YAML 解析翻车。
- **一个事实，一个家。** 同一条规则出现在两个 skill 里，其中一个必须退化成指针。

## 压测 prose，而不只查结构

结构检查（frontmatter、路由密度、自包含）有 CI 跑——但一段**纪律型**文字（agent 在压力下能合理化掉的规则）需要先过行为检查。仓库的做法是 **pressure baseline**：写规则之前，先让一个 subagent 在时间/沉没成本/疲惫三重压力下、在**没有**这条规则的情况下跑一遍，看它选错；然后写出恰好堵住你观察到的那条合理化的规则。跳过这一步，你写的就是读起来正确、实际拦不住任何东西的 prose。

## 重新投影并验证

```bash
bash scripts/sync-plugin-dist.sh                  # 重新投影 Claude Code adapter
bash scripts/sync-plugin-dist.sh --host codex     # ……以及你发布的其他 host
bash scripts/check-plugin-dist-sync.sh            # 重新投影后必须无 diff
bash run-tests.sh                                 # hook + content contract
```

重新生成的 `plugin/dist/` 与源码改动同 commit 提交。如果你动了任何 `description`，前后各跑一遍触发准确率 eval（`bash scripts/eval-trigger.sh`），确认没有打破路由。
