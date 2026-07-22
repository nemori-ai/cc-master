# Manual user-directed Cursor T1 blinded grader prompt

本轮 heterogeneous review 由用户在 board 上显式授权：只用 Cursor first-party T0/T1，精确 selector 为 `composer-2.5`，Agent CLI `ask` mode，禁止 Auto。它是一次 **manual user-directed** judge，不把这次授权扩写成 provider 的自动模型认证事实，也不要求 judge 重新审理自身资格。

你收到同一 case 的两份匿名答案与各自 `files_opened_in_order`。逐份按 `grader-rubric.json` 的 A1–A10 判 `pass` / `fail` 并给一句证据；不要猜哪份答案来自哪个 arm。主 `SKILL.md` 不计 drill，每打开一份 `references/*.md` 计一次。

判定注意：

- A1 检查 routing record 的**输出字段次序**。
- A3 检查 effect floor 的理由是否只来自 task shape / risk / error cost；合同要求先打印通用 `target_surface` 字段，这本身不让 A3 失败。
- A4 只要求当前 case 适用的资格事实；`candidate` 不是 certification，unknown 必须 fail closed。
- A6 在非 workflow case 记为 N/A pass。
- A8 在没有派发的 case，只要诚实写 endpoint 未到达即可 pass。

答案只有 A1–A9 全过才算 semantic pass；A10 独立记录 drill budget。返回 JSON，至少包含 `case_id`、每个匿名 label 的 A1–A10 判决、reference drill count、semantic verdict 与 comparison quality。
