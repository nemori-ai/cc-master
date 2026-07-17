---
title: 快速上手
description: 安装 ccm 与插件、跑起你的第一场编排，并学会日常真正会用到的那几个命令。
section: start
order: 1
deeper:
  - label: README —— 完整安装与日常使用参考
    url: https://github.com/nemori-ai/cc-master/blob/main/README.md
  - label: 功能手册 —— 哪些已交付、哪些还在路上
    url: https://github.com/nemori-ai/cc-master/blob/main/design_docs/feature-manual.md
  - label: 编排样例 walkthrough —— 从头到尾看一场真实运行
    url: https://github.com/nemori-ai/cc-master/blob/main/examples/sample-orchestration/walkthrough.md
---

cc-master 有两个可安装件：**`ccm`**（掌管所有状态的引擎 CLI）和**插件**（把你的 agent harness 教成编排者）。一个安装器装齐两者。`ccm` 是硬前置——没有它插件拒绝启动任何编排——所以安装器永远先装它。

## 安装

```bash
# 两条版本线都装最新（plugin + ccm）
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash

# 两条线可以各自独立 pin——它们各自发版、互不绑定
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash -s -- \
  --ccm-version ccm-v0.21.0 --plugin-version v0.20.1

# 指定一个 harness 安装，或铺到本机所有受支持的 harness
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash -s -- --harness claude-code
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash -s -- --all-harnesses
```

安装器探测你的 OS/架构，下载对应的 `ccm` 二进制，并按 release 自带的 `SHA256SUMS` 逐文件校验每个下载资产，然后为探测到的每个 harness 安装 adapter。校验和不匹配会中止安装——把它当作 release 完整性问题处理，而不是想办法绕过。

**系统要求：** Node.js 22+、`unzip`、一个 SHA256 工具（`sha256sum`、`shasum` 或 `openssl`）；在线安装还需要 `curl` 或 `wget`。Claude Code 的安装使用 `claude` CLI（≥ v2.1.195）。支持的 harness：Claude Code、Codex、Cursor、kimi-code。`ccm` 发布 Linux 与 macOS（x64/arm64）版本；Windows 暂未支持。

## 验证安装

```bash
ccm --version
```

然后在你的 harness 里开一个 session，用对应的入口命令：

| Harness | 启动一场编排 |
|---|---|
| Claude Code | `/cc-master:as-master-orchestrator <目标>` |
| Codex | `$cc-master-as-master-orchestrator <目标>` |
| Cursor | `/as-master-orchestrator <目标>` |
| kimi-code | `cc-master:as-master-orchestrator <目标>` |

加 `--resume` 即可接管一块已有的 board，而不是从零开跑。

## 你的第一场编排

给它一个有真实形状的目标——一份共享地基，加上一批可并行的独立工作：

```
/cc-master:as-master-orchestrator 把我的应用国际化到 6 个语言区域
  （i18n 框架 + 逐语言翻译 + 语言路由）
```

按下回车之后会发生什么：

1. **Bootstrap。** 入口命令触发 bootstrap hook，创建一块 **board**——`~/.cc_master/boards/` 下的一个 JSON 文件，从这一刻起它是这场运行的单一真相源。
2. **Goal Contract。** 你那句话被当作证据，而不是计划。master orchestrator（总指挥）会把它改写成一份简短、可验收的 Goal Contract，只就真正影响结果的歧义来问你——确认之后才开始建任何任务。
3. **DAG。** 目标被切成一张依赖图：先抽字符串、接框架，然后 6 个语言任务全部可以并行。
4. **并行派发。** 就绪的任务立刻派给后台 worker——地基活可能用更强的模型档，机械翻译用更便宜的档。
5. **决策包。** 遇到真正属于你的判断（「产品术语翻译还是保留英文？」），它会带上上下文和选项摆到你面前——而不依赖这个答案的工作一刻不停。
6. **端点验收。** 绿灯 gate 或 worker 自报都不算数。orchestrator 在自己的端点独立验收之后，才把任务标成 `done`。
7. **收尾。** `/cc-master:stop` 对着 Goal Contract 做完成检查，然后归档 board。之后随时可以 `--resume`——哪怕换了一个 session、换了一个 harness。

## 日常五条命令

session 内命令因 harness 而异；`ccm` 命令永远在你的终端里跑。

- **看状态**——`ccm status-report show`：进度、阻塞、临界路径、下一步动作。
- **看全景**——`ccm web-viewer open`：在浏览器里以只读图的方式看实时计划。
- **回答等待中的决策**——`/cc-master:discuss <决策>`（Codex：`$cc-master-discuss`，Cursor：`/discuss`，kimi-code：`cc-master:discuss`）。
- **停止**——`/cc-master:stop`（Codex：`$cc-master-stop`，Cursor：`/cc-master-stop`，kimi-code：`cc-master:stop`）。归档 board，之后可续跑。
- **续跑**——在你的 harness 入口命令上加 `--resume`；新 session 会对账现实证据，从断点接着跑。

## 诚实边界

不是每个 harness 都有全部能力。kimi-code 带有分发的 skill、命令和核心 hook，但没有自定义 subagent 角色、没有 Workflow 等价物、没有任何 CLI 配额信号；Codex 和 Cursor 永不自动换号；Cursor 按订阅账期配速。功能手册（下方链接）是诚实的 current/partial/target 边界——假设某个能力存在于你的 harness 之前，先查它。
