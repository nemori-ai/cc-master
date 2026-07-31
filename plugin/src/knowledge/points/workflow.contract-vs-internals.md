---
point: workflow.contract-vs-internals
---

## 权威陈述

<!-- ccm:k:start point:workflow.contract-vs-internals -->
## 0. 统御一切的那个区分：契约 vs 内部

永远把两层分开：

- **行为契约**——runtime *承诺*一个 primitive 做什么。这有文档：来自递给 agent 的
  `Workflow` 工具 schema 和 `code.claude.com/docs/en/workflows`。**它可以依赖。**
- **内部机制**——runtime *怎么*兑现那个承诺（sandbox 的具体形态、journal 文件格式、cache
  index 的确切实现）。这是个黑箱，Anthropic 几乎从不为它写文档。**别拿它当任何判断的地基。**

对作者来说，契约就够了。其下凡标「confirmed」的都是契约级；凡标「unknown」的都是你绝不能
依赖的内部。

### 已确认的契约（依赖这些）

| 事实 | 确认来源 |
|---|---|
| `agent()`/`parallel()`/`pipeline()`/`phase()`/`log()`/`workflow()`/`args`/`budget` 语义 | tool schema（first-party） |
| `parallel` 是一个 **barrier**；`pipeline` 是 **no-barrier streaming** | tool schema |
| Failure 语义（thunk throw → `null` 槽位；stage throw → item 被丢） | tool schema |
| determinism三禁 抛错（`Date.now`/`Math.random`/无参 `new Date()`） | tool schema（behavior） |
| resume = `agent()` 调用的**最长未变前缀** | tool schema |
| 并发 `min(16, cpu cores − 2)` per workflow | tool schema |
| 每次 run 总计 1,000 agent；每次 `parallel`/`pipeline` 调用 4,096 item；脚本 512 KB | tool schema |
| `budget` = `{total, spent(), remaining()}`；`spent()` = output token，跨 main loop + 所有 workflow 共享 | tool schema |
| `workflow()` 是一层嵌套；子 workflow 共享并发/计数器/abort/budget | tool schema |
| `args` **原样作为真正的 JSON 值**传入（不被 stringify） | tool schema |

### 内部未知（绝不依赖这些）

- sandbox 究竟是 `vm`-module 的进程内 sandbox、QuickJS、还是 `isolated-vm`。（「V8 isolate」
  那套说法是**民间传说**——它其实描述的是*另一个*产品，Cloudflare 背后的 Managed Agents，
  不是 workflow runtime。）
- cache key 真正的 index（content-hash vs positional index+content）。
- journal 的 on-disk 格式（`agent-<id>.jsonl` 是社区的猜测）。
- determinism 守卫是一个 pre-execution 的 AST gate 还是一个 runtime throw。
- 180 s 的 per-agent stall timeout 和 30 s 的 VM timeout（社区单来源；依赖前先对当前
  build 重新核实）。

<!-- ccm:k:end point:workflow.contract-vs-internals -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后分不清哪些是官方承诺的行为契约、哪些只是社区对内部实现的猜测（sandbox 类型、journal 格式、超时数值），会把未经确认的传闻当依据做设计判断。

主体是一张本 runtime 的已确认契约事实表与未知内部清单（并发上限、caps、budget 语义、resume 前缀规则），是环境事实而非方法。

## 边界

适用于起草/审阅依赖 runtime 具体行为的判断；若能通过实测直接复现某行为并留下证据，那已经是新增的契约事实，不算援引内部机制，不受此边界约束。

## 失败形态

把某个具体数值或实现细节（如某个超时值、某种 sandbox 实现名称）不加区分地写进设计文档或转述给别人，读起来像已确认事实，只有查回原始来源才能看出它其实来自推测。
