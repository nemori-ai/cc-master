# OBJECTIVE — authoring-workflows

J_top: 当用户要写、调试或启动 Claude Code dynamic workflow 时，agent 能做出正确的 Workflow 准入判断，按 work 形状选择 primitive / pattern，并写出遵守 runtime 契约、以 harness 为权威的脚本或修复方案。

baseline_reference:
  user_task: 用户要求作者编写、调试、修复或启动一个 Claude Code dynamic-workflow 脚本，或询问 `parallel()` / `pipeline()` / resume / cache / budget / isolation 等 workflow authoring 语义。
  without_skill_floor: 没有本 skill 的默认 agent 容易把小型并发任务升级成 Workflow，混淆 `parallel()` barrier 与 `pipeline()` streaming，传裸 promise、使用 `Date.now()` / `Math.random()` / `require` / `process` 等破坏契约，或在 harness 报错时凭 JS 经验自造 validator。
  expected_uplift: with-skill 臂在 Workflow 准入、primitive / pattern 选择、runtime 契约遵守、resume/cache/budget/isolation 处理、harness-as-endpoint 修复和 Skill B 材料引用上高于 without-skill 臂。

strict_dims: [Workflow准入不回退, runtime契约不回退]

rationale: 这个 skill 的核心价值不是让 agent 会说“workflow”这个词，而是让 agent 在该不用 Workflow 时忍住、在该用时按 Claude Code Workflow runtime 契约写。Track A 只能测 description 是否触发；Track B 才能测这些作者行为是否在 transcript 和 artifact 中出现。`Workflow准入` 与 `runtime契约` 是承重维度：任一回退，Skill B 就会变成泛泛的并发建议或不可靠的 JavaScript 猜测。
