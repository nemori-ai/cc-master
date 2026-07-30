---
point: ccm.cmd.account
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.account -->
## namespace account

{{USING_CCM_ACCOUNT_NAMESPACE}}

下面是 ccm 的精确 CLI grammar；host overlay 决定这些 verb 是可执行能力还是显式 `NotImplemented`。
当前只有 Claude Code 支持账号池 mutation，其他 host 不得因命令存在而推断支持。

### account add

`ccm account add <email> [--vault-kind keychain|file] [--vault-file <path>] [--keychain-service <name>] [--expires <iso>] [--registry <path>] [--json]`

### account refresh

`ccm account refresh <email> [--vault-kind keychain|file] [--vault-file <path>] [--keychain-service <name>] [--expires <iso>] [--registry <path>] [--json]`

### account delete

`ccm account delete <email> [--vault-kind keychain|file] [--vault-file <path>] [--keychain-service <name>] [--registry <path>] [--yes] [--json]`

破坏性；非 TTY 必须 `--yes`。

### account list

`ccm account list [--probe-keychain] [--registry <path>] [--json]`

`--probe-keychain` 只探活条目存在性，不读取 token 值。

### account switch

`ccm account switch [--email <email>|--account <email>] [--vault-kind keychain|file] [--vault-file <path>] [--keychain-service <name>] [--registry <path>] [--now <iso>] [--json]`

`--account` 是 `--email` 的旧别名；两者都跳过自动选号。所有 JSON / log / registry 输出保持 token-blind。

---

<!-- ccm:k:end point:ccm.cmd.account -->
