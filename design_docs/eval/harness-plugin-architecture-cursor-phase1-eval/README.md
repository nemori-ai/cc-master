# harness-plugin-architecture × Cursor evaluation

这是 2026-07-10 针对 `harness-plugin-architecture` 的公开证据包。它保留的是能让 reviewer
理解实验合同与裁决的 decision-grade evidence，不是完整运行工作区。

## Evidence map

- [`red-scenario.md`](red-scenario.md) + [`RED.md`](RED.md)：强模型 ceiling fixture 与聚合判决。
- [`trigger-train.json`](trigger-train.json) /
  [`trigger-holdout.json`](trigger-holdout.json) + [`phase2-track-a.md`](phase2-track-a.md)：
  description trigger 的 train/holdout corpus、改前预测与聚合结果。
- [`green-track-b/track-b-case.md`](green-track-b/track-b-case.md)：
  Track B 固定 case。
- [`green-track-b/assertions.md`](green-track-b/assertions.md)：
  五项逐 transcript 裁决合同。
- [`green-track-b/track-b-with-skill-prompt.md`](green-track-b/track-b-with-skill-prompt.md) /
  [`green-track-b/track-b-without-skill-prompt.md`](green-track-b/track-b-without-skill-prompt.md)：
  两臂 canonical prompts。
- [`green-track-b/RESULTS.md`](green-track-b/RESULTS.md)：
  聚合结果、限制与最终判决。
- [`green-track-b/judge-disagreement.md`](green-track-b/judge-disagreement.md)：
  跨 judge 分歧的最小裁决记录。

重复运行 transcript、grader raw output、session metadata、logs 与 traces 没有公开保留。未来复跑时
写入本目录下的 `.runs/`，只有蒸馏后的稳定合同或聚合证据才能提升到上述公开层。
