# 官方规范与工程实践：现有标准解决到文件，没有解决到知识点

## 1. Agent Skills 开放规范

来源：[Agent Skills Specification](https://agentskills.io/specification)，`[官方规范]`。

规范定义的 package 是一个目录：

```text
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

它提供的关键承诺：

- `SKILL.md` 有 `name`、`description` 等 frontmatter 与 Markdown body；
- body 在 skill 激活后整体加载；
- reference/resources 按需读取；
- progressive disclosure 分为 metadata、instructions、resources 三层；
- 建议主 `SKILL.md` 小于 500 行；
- reference 文件应聚焦，文件引用避免深链；
- `metadata` 允许额外的字符串键值。

### 规范没有定义什么

规范没有定义：

- 一份 Markdown 内的知识点 ID；
- 一个知识点对应哪个 heading/paragraph/span；
- point 与 point 之间的 typed relation；
- 哪个 skill/point 拥有某项定义；
- move/split/merge/retire 后的 lineage；
- runtime 最短导航路径；
- canonical 到 host adapter 的 point-level source map。

`metadata` 字段是 skill frontmatter 的开放扩展面，不适合装载整份文件内部的图：

- 粒度仍然是 skill；
- 只允许字符串映射；
- 把大量 node/edge 塞进 frontmatter 会破坏可读性和 progressive disclosure。

**本报告推论**：point/module KIR 应作为 cc-master 的 repo-internal maintenance contract，
不应冒充 Agent Skills 通用格式，也不应要求外部 host 原生理解它。

## 2. Anthropic 的 skill 工程实践

来源：[Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)，
2025-10-16，`[官方实践]`。

可承重事实：

- skills 是 instructions/scripts/resources 的目录；
- name/description 在启动时提供 discovery metadata；
- skill 被选中后读取完整 `SKILL.md`；
-复杂或互斥场景应拆到按需 reference，降低 token 使用；
-开发应从 representative eval 出发，观察 agent 的实际 trajectory 再迭代；
-确定性操作应交给 code，而不是让模型用 token 模拟；
-未来方向包括 agent 自己创建、编辑、评价 skills。

### 对本问题的意义

这组实践直接支持：

- 顶层入口做 router，而不是百科全书；
- runtime prose 和确定性 graph check/compiler 分工；
- 不能只测静态文件，要测 agent 实际触发与读取路径；
- reference 拆分必须由“互斥/按需上下文”驱动，不能只按文件大小机械切。

它仍没有回答“一个 reference 内部有三个不同 owner 的知识点怎么办”。这正是本专栏的增量。

## 3. OpenAI 的 harness engineering

来源：[Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)，
2026-02-11，`[官方实践]`。

与本问题最相关的实践：

- 把 `AGENTS.md` 当 table of contents，而不是 1000 页手册；
- 结构化 `docs/` 作为 repository knowledge system of record；
- 文档有索引、verification status、plans 与 debt；
- 用 linter/CI 校验知识是否新鲜、cross-linked、结构正确；
- 用 recurring doc-gardening 找陈旧/冲突知识；
- “agent legibility”本身是工程目标。

### 可吸收与不可外推

可吸收：

- 知识结构需要机械检查；
- 入口保持小，深层信息按需披露；
- freshness/ownership/cross-link 是一等健康维；
- 文档维护应成为持续循环，而非一次重构。

不可外推：

- 该文章没有给 Markdown 内知识点 schema；
- 没有定义三跳、strong connectivity 或 source span identity；
- “structured docs system of record”不等于必须使用 graph database。

## 4. 官方基线与 cc-master 扩展的边界表

| 能力 | 官方基线 | cc-master 所需扩展 |
|---|---|---|
| skill discovery | name + description | intent → module/point trigger graph |
| runtime instructions | 整个 `SKILL.md` | point-level evidence span |
| progressive disclosure | SKILL → reference/resource | atlas → module router → point span |
| package structure | directory/files | stable ID independent of file |
| validation | frontmatter/naming | span、owner、edge、lineage、hops、host parity |
| maintenance | 官方建议迭代/eval | explicit operator + admission + tombstone |
| host portability | file package | canonical point → per-host projected span |

## 5. 对格式选择的直接约束

### 不选 heading slug 作主键

官方只要求 Markdown body，不承诺 heading 是稳定接口。标题改写不应等价于知识删除+新增。

### 不选手写行号作主键

规范鼓励持续编辑和拆 reference；任何前文插入都会使手写行号漂移。

### 不把图语义藏进正文 prose

机器需要确定读取 owner、edge type、lineage 和 host coverage；只靠自然语言推断无法成为 CI hard gate。

### 不把 runtime graph 只留在 dev-only manifest

Agent Skills 的 runtime 消费面仍是文件。若 agent 最终看不到 traversal surface，dev graph 的可达性
不能算产品可达性。

## 6. 官方证据小结

官方材料支持的是一条清晰边界：

```text
开放标准：文件系统 package + progressive disclosure
cc-master 扩展：文件内部 identity + graph semantics + generated runtime navigation
```

扩展应保持向下兼容：最终产物仍是普通 Markdown skill package；不理解 KIR 的 host 仍可读取它，
只是无法参与 maintainer-side 的 graph health 计算。
