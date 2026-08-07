---
point: ccm.cmd.account
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.account -->
## namespace account

**语法 / positional / 例一律以 `ccm <namespace> <verb> --help` 为准**（本节曾逐条复制它们，已交还——副本天然会过期）。下面只留 help 不说的：在这个 verb 上有额外语义的 flag、语义边界、跨 verb 规则。

{{USING_CCM_ACCOUNT_NAMESPACE}}

下面是 ccm 的精确 CLI grammar；host overlay 决定这些 verb 是可执行能力还是显式 `NotImplemented`。
当前只有 Claude Code 支持账号池 mutation，其他 host 不得因命令存在而推断支持。

### account add

### account refresh

### account delete

破坏性；非 TTY 必须 `--yes`。

### account list

`--probe-keychain` 只探活条目存在性，不读取 token 值。

### account switch

`--account` 是 `--email` 的旧别名；两者都跳过自动选号。所有 JSON / log / registry 输出保持 token-blind。

---

<!-- ccm:k:end point:ccm.cmd.account -->

## 失效类型

`environment_fact`（主体：事实方法） —— 缺 ccm account 各命令的准确 flag 和 option，agent 会敲出语法错误命令或选错参数组合

主体是 account namespace 的命令语法与 flag 清单，纯 CLI grammar 事实。
