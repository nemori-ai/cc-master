# 机制契约：`skills/account-management/scripts/account-list.sh`

> 类别：运行时带外脚本（只读对账·NOT a hook）。源码：`skills/account-management/scripts/account-list.sh`。列号池每个 email 的非密信息。**永不取/打印 token 值。**

## 触发输入
- `/cc-master:accounts --list` → agent Bash 跑。用法 `account-list.sh [--probe-keychain] [--registry <path>]`。
- 读 accounts.json registry 非密字段 + 可选 keychain `find`（不带 `-w`，只确认项在不在）。

## 业务流
1. 安全开头 + 云后端自检 no-op。
2. node 读 registry 非密字段 → 每号一行 TSV（email / vault_kind / expires / active / switchable / token_state / last_switch_out_at / vault_locator / **file_vault_path**）+ 顶行 meta（账号数 / 路径 / 是否存在）。**node 绝不 readFileSync vault、绝不碰任何 blob（codex §7 P2）**：file 形态的 token_state 由 node 置 `PROBE-FILE` 占位（密 blob 绝不进 node 渲染进程）；keychain / 其它可切形态 node 直接按 token_expires_at 严格 ISO 字典序判 ok/EXPIRED。
3. bash 排版成定宽对账表；可选 `--probe-keychain` 用 `security find`（不带 `-w`）确认 keychain 项真在。
4. **file-vault token 存在性 bash 层 token-blind awk 布尔预计算**（`file_token_present`·codex §7 P2）：对 `PROBE-FILE` 占位用 `awk -v p=<tokenLine> 'index($0,p)==1 && length($0)>length(p) {print "1"; exit}'`（行首锚定·定字符串前缀由 fileVaultLineMatch 给·blob `$0` 只过 awk buffer、只有哨兵 `1` 进 stdout·绝不落任何被捕获变量）resolve 成 ok/EXPIRED/no-token——对标 keychain `security find`（不带 -w 只回存在性）的 file 形态等价。
5. TOKEN 列口径：`switchable:false`（残缺号无 vault token）→ `no-token`（绝不冒充健康 ok·node 直接定）；file 行存在且非空 → 按 expires 判，**无到期记录（expires='-'）或算不出 now → `?`（unknown·不可比·与 keychain 行/footer 同口径·codex §7 P3）**，仅有合法 ISO 才严格字典序比 ok/EXPIRED；file 行缺/空 → no-token。

## 输出副作用
- 无（纯只读）。stdout 是非密对账表，绝不含任何 token。

## 关键不变式
- **永不读 token 值·密 blob 绝不进 node 渲染进程**（codex §7 P2）：registry 本就零 token；keychain 探活不带 `-w`；**file vault 的「`_TOKEN=` 行存在且非空」布尔在 bash 层 token-blind 预计算**（awk index($0,p)==1 行首锚定·blob 只过 awk buffer、只回哨兵 `1`），node 渲染进程已彻底不 readFileSync vault——暴露面从「整个 accounts.env 所有号的密 blob 读进 node 内存」收敛为零。
- `switchable:false` 残缺号必须显式标「不可切·no-token」，绝不按 token_expires_at 呈现成健康 ok（否则恢复 UI 骗用户）。
- `?`（unknown）口径统一：无到期记录 / 算不出 now → `?`，绝不把无到期元信息的老/手动 file 号冒充成健康 ok（file 行与 keychain 行与 footer 同口径·codex §7 P3）。
- 坏 JSON 也 fail-safe：list 是诊断/恢复 UI，registry 坏掉时正最需要它能跑——坏 JSON 当空池显示、exit 0（不在此刻 exit 1·与 select-account.js 降级一致）。
- 绝不进 hooks/（红线 1/5），与 board 正交。

## 失败模式
- accounts.json 坏 JSON → node 报 ERR → warn 提示怎么修、按**空号池**显示骨架、**exit 0**（fail-safe·诊断 UI 此刻最需可用）。
- registry 不存在 / 号池为空（0 号）→ 提示「天然单账号空池」、引导 `--add` 录第一个备号。
- file vault 文件不存在 / 行缺 / awk/node 取前缀失败 → token_state `no-token`（如实·不冒充 ok）。
