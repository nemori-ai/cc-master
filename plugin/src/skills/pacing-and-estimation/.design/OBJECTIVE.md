# OBJECTIVE — pacing-and-estimation

J_top: agent 在一场 long-horizon 跑里要消费 ccm 只读 advisory 做配速/估算判断的输入时，**把 verdict 与字段读对、并主动召回估算轴**——读 `ccm usage advise` 的 verdict 与 lever 类事实（不自己拿 `used_percentage` 重算走廊）、在 dispatch/recon/replan 拍**主动 consult `ccm estimate`**（forecast/evm/risk·不让估算整轴 out-of-mind）、读诚实字段（coverage_pct/confidence/conformal 区间）对低覆盖预测**降低信任权重**（不拿点估当承诺）、引用当前 host 的模型 registry 获取可用性/provenance/能力/成本事实、识别 usage⊗estimate 张力——且只把这些决策输入交给 master-orchestrator-guide，不自己选择动作或模型。

baseline_reference:
  user_task: 给 agent 一个具体的 pacing/估算决策处境（如"长跑跑了一半、想知道还要多久能完 + 当前配额节奏对不对"、"配额逼顶了、该怎么 pace"、"这个 forecast 给了个 ETA、我该信吗"），看它会不会消费 ccm advisory、读对 verdict/字段。
  without_skill_floor: 默认 agent **想不到去查估算轴**——估工期靠拍脑袋、不跑 `ccm estimate forecast`/`evm`/`risk`（B.2 out-of-mind：能力就绪、消费层从不被召回）；pacing 凭感觉不读 `ccm usage advise` 的 verdict、或自己拿百分比瞎算走廊（不知引擎已算好）；拿到一个 forecast 点估当承诺、不读 coverage_pct/confidence 就汇报一个假精确 ETA；模型分配拿陈旧先验当当前事实。
  expected_uplift: 决策点主动 consult ccm advisory——pacing 读 `usage advise` verdict→对应 lever 类事实、估工期跑 `estimate forecast` 读 p80 区间、查偏差跑 `estimate evm` 读 spi_t/cpi、低 coverage/confidence 时带区间报且降信任；模型分配前从 host registry 同时报出可用性、provenance、family/effort 能力与相对成本事实；usage⊗estimate 张力识别出来后把输入交给 A，而非自己拍。

strict_dims: [advisory 消费正确性（pacing 读 verdict 而非自算走廊 + 估算轴被主动召回而非 out-of-mind + 诚实字段触发降信任）]

rationale: 本 skill 的承重价值是 **B.2 触发召回**（estimate 整轴默认 out-of-mind·前序报告 §3 根因 2）+ **A.1 新领域知识**（ccm 自研命令 schema + verdict 语义 + 档位数字 + 诚实字段——agent 推不出、必须教）。strict_dim 判的不是「会背 estimate 命令」（那是 reference·`ccm <cmd> --help` 兜底），而是「在该消费 advisory 的决策瞬间**真的去消费了、且读对了**」——尤其估算轴有没有被召回（B.2 的落地证据）。单条 strict_dim，符合本仓「1-2 个 strict_dims」约束。**非纪律型**：pacing/tiering 的 pressure baseline 实证零失败（历史 model-tiering ×6 / usage-pacing ×2；2026-07-10 Codex/Cursor 两模式 ×2），故本 skill **不配重型 Rationalization Table**（skillsmith 铁律：无 RED 不造纪律 prose），价值在触发召回 + provider 领域知识，不在抗合理化。

## 非目标（notes）

J 不要求 agent 背下全部 estimate/usage 命令面（那是 reference）；也不要求 pacing 精确闭环到某个 used% 点（账户口径有结构性诚实天花板·见 references/usage-signals.md）——只要求按当前 provider profile 做单侧上界判读 + 主动召回估算轴 + 尊重 freshness / provenance / 诚实字段。J 也不评判 ccm 引擎自身的算法质量（那由 ccm 子产品 CI + 测试守）——只评判 agent 用它的 verdict/字段用得对不对、决策有没有正确回 A。
