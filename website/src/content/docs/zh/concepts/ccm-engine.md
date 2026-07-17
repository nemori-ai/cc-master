---
title: ccm 引擎
description: 一个独立安装的 CLI 掌管每一次 board 写入、每一条不变式、每一份预测——插件只是它的消费方之一。
section: concepts
order: 4
deeper:
  - label: 命令手册 —— 逐 verb 的完整 ccm 命令面
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/using-ccm/canonical/references/command-catalog.md
  - label: ADR-014 —— CLI 解耦为独立产品
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-014-cli-decoupling-as-independent-product.md
  - label: ADR-022 —— 两条版本线
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-022-version-line-decoupling.md
---

`ccm` 是一个独立的 CLI（per-OS 的 Node 二进制，背后是 `@ccm/engine` 库），掌管 board、配额、估算、worker 和 agent registry 的单一真相源。它独立于插件安装，版本也走自己的发布线。

架构上是一条**进程边界**：插件的 hook 和 skill 绝不 import 引擎——它们 shell 调全局 `ccm` 二进制、用 JSON 交换。这让每一次写入都收在同一个关卡后面，让同一个引擎能同时服务 web viewer 和未来的客户端，也意味着升级 `ccm` 永远不需要重装插件。

## 命令面速览

| Namespace | 管什么 |
|---|---|
| `board` / `task` / `goal` | board 生命周期、任务状态机、DAG/临界路径分析、带版本的 Goal Contract |
| `log` / `jc` / `cadence` | append-only 审计轨迹、自驱决策记录、迭代交付节奏 |
| `usage` / `estimate` / `baseline` | **只读 advisory**：配额窗口与 verdict、Monte Carlo 预测、EVM 基线 |
| `quota` / `model-policy` / `provider` | 全机缓存配额态势、模型角色视图、provider 事实 |
| `worker` / `agent` / `harness` / `runtime` | 跨 harness worker 封装、运行时 agent registry、本机清单、runtime 供应链 |
| `account` | Claude Code 号池（add/refresh/delete/list/switch）——凭证全程 token-blind |
| `coordination` / `peers` / `monitor` | 多编排协调：跨板花名册、通知收件箱、池中介、后台监控 daemon |
| `status-report` / `web-viewer` | 生成的状态报告，以及只读的本地 mission-control 界面 |
| `watchdog` / `policy` / `upgrade` | 自我唤醒定时器、板级自主权限策略、自升级 |

每条命令都接受 `--json`（机器可读信封：`{"ok": true, "data": …}`），共享 `--board`、`--home`、`--dry-run` 等全局 flag。逐 verb 的完整命令面见下方链接的命令手册。

## ccm 出 verdict，orchestrator 决策

只读 namespace（`usage`、`estimate`、`model-policy`、`route`）被刻意设计成 **advisory**。`ccm usage advise` 返回一个 verdict（`hold`、`throttle`、`switch`、`stop_5h`、`stop_7d`），附证据和诚实字段（来源、置信度、新鲜度）；`ccm estimate forecast` 返回数千次模拟算出的 P50/P80/P95 ETA。它们都不执行任何动作——减速、换号、派发永远是 orchestrator 的判断。事实由引擎出，判断归 agent，授权归你。

当信号缺失、过期或无法验证时，ccm 如实说 `unknown` / `available: false`——绝不把缺口粉饰成「配额充足」。

## 一个写入关卡，82 条不变式

所有 board 写入——来自 agent、来自 hook、来自 CLI 本身——都过引擎里同一道关卡：锁 → 变更 → 依赖重门控 → **82 条 lint 不变式**（schema、图、业务规则）→ 原子落盘。非法转移和畸形字段以 `exit 3` 拒绝并列出 violations，于是「一次写对」是机械性质，而不是美好愿望。

## 两条版本线

插件与 `ccm` 各自独立发版：插件用裸 `vX.Y.Z` tag，`ccm` 用 `ccm-vX.Y.Z` tag。安装器解析两条线各自的最新版，你也可以分别 pin（`--plugin-version` / `--ccm-version`）。分开升级时先升 `ccm`——新插件可能依赖新引擎命令，而旧插件配新 `ccm` 按 additive 兼容原则处理。
