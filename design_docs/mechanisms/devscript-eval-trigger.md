# 机制契约：`scripts/eval-trigger.sh`（dev-only）

> 类别：dev-only 带外脚本（NOT a hook·**不随 plugin 分发**·仅 repo 根调用·红线 5）。源码：`scripts/eval-trigger.sh`。跑 skill-creator Track A（触发准确率）eval 的薄包装——自身无 eval 逻辑。

## 触发输入
- 开发者敲 `scripts/eval-trigger.sh <skill-name>`（如 `master-orchestrator-guide`）。
- 依赖：`uv` + Python 3.12 + `claude` CLI（复用 session 认证，无需 API key）。
- 读：`skills/<skill>/evals/trigger.json`（should-trigger + near-miss 查询集）+ `skills/<skill>/SKILL.md`。env `CC_MASTER_SKILL_CREATOR` 覆写 skill-creator 路径。

## 业务流
1. 解析 skill 名，从脚本自身位置派生 `$REPO`。
2. 校验 uv 在 PATH、skill-creator 目录存在、eval 集存在、SKILL.md 存在。
3. `cd` 进 skill-creator 目录（让 `scripts.` 包解析），跑 `uv run --python 3.12 python -m scripts.run_eval --eval-set <...> --skill-path <...> --runs-per-query 3 --verbose`。

## 输出副作用
- 无仓内写（除 skill-creator 自身的 eval 产物）。打印 precision/recall/accuracy 结果。

## 关键不变式
- **dev-only**——不随 plugin 分发，仅 repo 根调用（裸路径从 repo 根正确·红线 5）。绝不进 hooks/。
- 不入 hook、非每-commit CI 门，作 description 改前后对比 / pre-release 检查。
- 自身只解析路径 + shell out，不拥有 eval 逻辑（skill-creator 拥有）。

## 失败模式
- uv 缺 / skill-creator 缺 / eval 集缺 / SKILL.md 缺 → 各报清晰 error + exit 1。
