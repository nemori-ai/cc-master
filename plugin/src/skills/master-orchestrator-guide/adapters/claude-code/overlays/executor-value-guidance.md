- **`subagent`** —— 一个**终端（terminal）推理单元**负责：单一证据面 + 单一推理链 + 单一交付物 + 无需 fan out + 无需统一 schema + context-safe + 携带一条显式 escalation 路径。默认把独立、可并行的实现工作派成它（指挥不演奏，把乐器交出去）。经 sub-agent（`run_in_background`）机制真跑·必给 handle。
- **`workflow`** —— 一次**确定性多-agent 编排**负责：你需要**对多个叶子的确定性控制**时（fan-out / fan-in · 统一叶子 schema · 对抗式验证 / retry / loop · 联合综合 · context-flood 风险 · journal-resume）——**哪怕叶子数很少也选它**。经 Workflow 工具真跑·必给 handle。
- **`master-orchestrator`** —— **你自己**做的那几件不可外包的活：调度决策、replan、端点验收、整合。你不为它起后台机制——它就是你在指挥台上亲手做的。
- **`user`** —— 人类操作者负责：需判断 / 授权 / 拍板的（merge / 不可逆 / 对外 / 方向性）。surface 给用户、把回答当一条 async 依赖，别越权替他决。
- **`external`** —— session 外已在别处跑 / 追踪的：一次 CI run、一个 GitHub issue。用一个引用（issue / CI URL）指过去，靠后台 shell 轮询它的完成、或去外部系统查。

> **反过度工程的对称护栏**：`workflow` 背着一整套机器开销——只有一条推理链 / 一份交付物 / 没有 fan-out 时，一个 `subagent` 就够了，起 workflow 是过度工程（对称于上面「哪怕叶子数很少也选它」，两侧都要守）。论证 SSOT 在 `${CLAUDE_PLUGIN_ROOT}/skills/authoring-workflows/SKILL.md` §1「workflow 是有开销的」，此处不复述。
