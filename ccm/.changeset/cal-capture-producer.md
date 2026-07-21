---
"@ccm/engine": minor
"ccm": minor
---

新增显式副作用型 `ccm calibration capture` producer：复用只读 deadline-risk 计算路径，把真实 backlog 与预测特征写入 home-level observed snapshot store；以 canonical board 文件身份稳定关联同一 board，并在 store lock 内按 `board_id + as-of` 幂等去重。`ccm estimate deadline-risk` 保持纯只读；本片不含 label 回填或 calibration flip。
