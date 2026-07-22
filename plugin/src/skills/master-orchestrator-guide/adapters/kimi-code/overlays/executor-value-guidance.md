- **`subagent`** —— 先从本机 harness worker pool 选择 target harness；origin harness 不是默认。一个终端推理单元负责：单一证据面 + 单一推理链 + 单一交付物 + context-safe + 携带 escalation 路径。target 是本 host 时派给 kimi-code **Task** subagent；target 是其他 harness 时，在当前 origin 可追踪的后台 **Bash** 后台任务 中运行 `ccm` worker wrapper。此时 handle 来自外层后台机制，不是 wrapper 自己；没有真实 handle 就不能进入 `in_flight`。
- **`workflow`** —— 表达结构化 fan-out / fan-in 的 planning 责任；当前 host 的 runtime 映射只按 [`worker-routing.md`](worker-routing.md#workflow-是规划语义不保证同名-runtime)，本文不复制。
- **`master-orchestrator`** —— **你自己**做的那几件不可外包的活：调度决策、replan、端点验收、整合。你不为它起后台机制——它就是你在指挥台上亲手做的。
- **`user`** —— 人类操作者负责：需判断 / 授权 / 拍板的（merge / 不可逆 / 对外 / 方向性）。surface 给用户、把回答当一条 async 依赖，别越权替他决。
- **`external`** —— session 外或 shell/session 中可追踪的工作：后台 Bash、CI run、GitHub issue、系统 scheduler。用 Bash 任务 id / issue / CI URL 指过去，靠 recon 查询进度；issue closed 只是待验收信号，验收 PR / commit / report artifact 后才 done。

> **反过度工程的对称护栏**：fan-out/fan-in 有协调成本。只有一条推理链 / 一份交付物 / 没有真正的并行证据面时，一个 Task 或一个后台 Bash 就够了；别为了“像 workflow”而制造多 worker。
