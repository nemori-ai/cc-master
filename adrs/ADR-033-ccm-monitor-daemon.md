# ADR-033 — `ccm monitor` 建议型连续监控 daemon + home 常驻服务与二进制同生命周期

> Status: **Accepted**
> Date: 2026-07-09
> Scope: `ccm` CLI（`monitor` namespace：start/stop/status/restart/serve + 可选 `install-service`）+ **home 常驻服务与 `ccm` 二进制同生命周期**（覆盖 `monitor` **与**既有 `web-viewer`：`ccm upgrade ccm` / `install.sh` 装完或换完二进制后必须 reconcile）+ `@ccm/engine`（tick 编排）+ 服务态（`<home>/services/{monitor,web-viewer}/`）。**不**改窄腰；**不**强制安装 OS service；monitor 缺席时 ADR-032 核心仍可经 hook 路径跑。
> Source: 2026-07-09 设计收敛（idle 烧配额盲区 + 连续感知 / 边沿通知）+ 用户拍板「monitor / web-viewer 与 ccm 二进制同生命周期，upgrade + install.sh 必须保障活且最新」。
> Co-signed: 用户拍板 Accepted·2026-07-09
> Related: 消费 [ADR-032](ADR-032-deterministic-pool-arbiter-and-notification-inbox.md)；演进 [ADR-029](ADR-029-ccm-web-viewer-namespace.md)（补二进制同生命周期缺口）；修订 ADR-002/017 对「常驻 daemon」的默认排斥（仅 advisory 传感层）。

---

## 1. Context

ADR-032 的池中介 + inbox 在 **daemon-less** 下已可工作：各板 `usage-pacing` / Stop 边界重算池分配并取本行。缺口是：

- **前台 idle / compaction 间隙**：无 hook 触发 → 无感知 → 后台 worker 仍可能烧穿配额。
- **Claude 以外 harness**：Cursor / Codex 用量可中立轮询，但今天没有 out-of-process 传感者。
- ADR-017 / ADR-002 曾默认排斥「常驻 daemon」——理由是破 ship-anywhere、引入第二生命周期。但 ADR-029（`ccm web-viewer`）已证明：**可选、自管理、home 下 pid/log、缺席不崩核心** 的服务模式可接受。

另有一条与 monitor **同构、今天已欠账** 的事实：`ccm` SEA 二进制被 `install.sh` / `ccm upgrade ccm` 替换后，**已在跑的 home 常驻服务仍握着旧 inode / 旧代码**。web-viewer state 虽有 `ccm_version` 字段，但 upgrade/install **没有** post-hook 去 restart；monitor 一旦落地会踩同一坑——且 monitor 逻辑会随 ccm 线迭代，**陈旧 daemon = 静默跑旧中介**，比 viewer UI 陈旧更危险。

需要：(a) 把「连续感知」从 harness 回合边界解放出来；(b) 立一条 **home 常驻服务 ⟷ ccm 二进制同生命周期** 不变式，monitor 与 web-viewer 共用，装/升路径机械兑现。

## 2. Decision

### 2.1 D1 — 本 release 范围内交付 `ccm monitor`（可选·建议型）

- **角色**：out-of-process 连续传感 + 边沿触发写 inbox / 刷新 sidecar。
- **不是**：硬调度器、强制执行器、agent 替身。
- **缺席行为**：静默；hook 路径（ADR-032）继续工作——daemon 是加速器不是前提。

### 2.2 D2 — 平台：macOS 与 Linux 一等公民

- **核心**：Node 自管理 detached 进程（`<home>/services/monitor/{pid,log,state}`），跨平台一致——复用 ADR-029 web-viewer service 模式。
- **可选 OS 安装**：
  - macOS：`launchd` LaunchAgent（`ccm monitor install-service`）
  - Linux：`systemd --user` unit
- **不**引入 PM2 / Oxmgr 硬依赖；**不**只做 systemd（会把 macOS 降为二等）。

### 2.3 D3 — Tick 编排（感知连续 / 算→通知稀疏）

每 tick：

1. `MachineHarnessRegistry.sweep`
2. 按 harness `usageSource` 拉用量（Cursor/Codex pollable；Claude 只读 sidecar，不假装可独立 poll）
3. 按 `(harness, account-pool)` 跑 ADR-032 池中介
4. **仅边沿**写通知：band 跨越（迟滞）/ roster 签名变 / 本行 delta>ε；冷却 + 内容去重 + 同类 supersede

### 2.4 D4 — CLI 面

```
ccm monitor start|stop|status|restart
ccm monitor serve          # foreground（dev / systemd ExecStart）
ccm monitor install-service [--user]   # launchd | systemd user
ccm monitor uninstall-service
ccm services reconcile [--after-binary-replace] [--json]   # 共享：monitor + web-viewer
```

与 `ccm web-viewer` 生命周期对称；日志/pid 落 home，不进 repo。

### 2.5 D5 — 与 hook 共存

- Daemon 写 inbox / sidecar；**不**直接往 agent context 注入（无 harness 回合）。
- 投递仍靠 `coordination-inbox` / `usage-pacing` 在下次 Stop/工具边界 surface。
- 同一板同一 kind ≤1 unconsumed；daemon 与 hook 生产者共享 supersede / dedup 规则（引擎 SSOT）。

### 2.6 D6 — Home 常驻服务 ⟷ ccm 二进制同生命周期（HARD·monitor + web-viewer）

**不变式**：任一 `<home>/services/<name>/` 下**正在跑**的 ccm 托管进程，其 state 内 `server.ccm_version`（或等价字段）**必须等于**当前 `ccm --version` 核版本；不等 → 视为 **stale-binary**，不得当健康复用。

**Wanted 语义**（决定「要不要拉活」，避免空白机强开 viewer 端口）：

| 服务 | wanted = true 当且仅当 |
|---|---|
| `monitor` | 自管进程在跑 **或** OS service 已 install **或** state 显式 `wanted: true`（首次 `start` / `install-service` 置位；`stop`/`uninstall-service` 清位） |
| `web-viewer` | 自管进程在跑 **或** state 显式 `wanted: true`（`start`/`open` 置位；`stop` 清位）。**不**在空白机因 upgrade 而新开 viewer |

**三层兑现（纵深·缺一不可）**：

1. **Post-binary-replace reconcile（装/升主路径）**  
   - 共享入口：`ccm services reconcile --after-binary-replace`（实现可落 `handlers/services-reconcile.ts`，逐服务调既有 `restart`）。  
   - **`ccm upgrade ccm`**：原子替换二进制成功后，**用新二进制**跑 reconcile（`execFileSync(新execPath, ['services','reconcile','--after-binary-replace'])`）；失败 → warn 不回滚二进制（二进制已新；服务可手动 `restart`）。`--dry-run` 不调。  
   - **`install.sh`**：① 装完 ccm 二进制并 `ccm --version` 验过之后 → `"$CCM_BIN" services reconcile --after-binary-replace`（best-effort·失败 warn 不 `die`）；② 仅升 plugin、ccm 二进制未换时 **不**强制 reconcile（服务代码在 ccm 线，不在 plugin zip）。  
   - 对每个 wanted 服务：`restart`（停旧 → 新二进制 spawn → 写新 `ccm_version`）；若装了 OS service → 同步 `launchctl kickstart -k` / `systemctl --user restart`（unit 的 ExecStart 必须指向 `$PREFIX/ccm` 路径，而非旧 inode 绝对快照——生成 unit/plist 时用稳定 path）。

2. **Start/status 自检（运行时后门）**  
   - `start`：若已有「健康」进程但 `ccm_version` ≠ 当前 → **强制 restart**，禁止「已健康则复用」。  
   - `status --json`：暴露 `binary_match: true|false` + `running_ccm_version` / `installed_ccm_version`；`binary_match:false` 时 human 行标 stale。

3. **OS-service 生成纪律**  
   - `install-service` 写入的 launchd/systemd 单元 **Exec 用稳定 `ccm` 路径**（install PREFIX / `command -v ccm` 解析结果），禁止把某次下载的临时路径焊进 plist。  
   - reconcile 在 OS-managed 模式下优先走 init 的 restart，避免与自管 pid 双实例。

**明确不做什么**：

- 不把 monitor/web-viewer 打进 plugin zip；它们是 ccm 线产物。  
- `ccm upgrade plugin` **不** reconcile（plugin 不含这些服务代码）。  
- 空白机首次 `install.sh`：**不**强开 web-viewer；monitor 仅在已 wanted 时拉活（用户从未 `monitor start` → 保持可选缺席）。若产品日后要「默认开 monitor」，另加显式 flag / 默认 wanted，不偷挂在本不变式上。

## 3. Consequences

### 3.1 Positive

- 补 idle 烧配额盲区；Cursor/Codex 中立轮询落地。
- 与 ADR-032 确定性中介同一大脑——daemon 只是评估调度器，不是第二套算法。
- 可选安装：不破「ccm 缺则 hook 软降级」精神；monitor 缺则核心仍跑。
- **装/升后不会静默跑旧中介 / 旧 viewer**：web-viewer 既有欠账一并还清。

### 3.2 Negative / 代价

- 新增进程生命周期（pid 泄漏 / 僵尸 / 多实例）——用 home 锁 + status 自检收敛。
- Claude 用量仍依赖 statusline sidecar；daemon 对 Claude 只能「读陈旧」不能「主动刷新权威」。
- OS service 安装需文档诚实说明权限 / user-session 依赖（systemd lingering 等）。
- `upgrade ccm` / `install.sh` 多一步 best-effort reconcile；须测「无服务 / 仅 viewer / 仅 monitor / 两者 + OS unit」矩阵。

### 3.3 Neutral

- 修订 ADR-002/017「默认不引入 daemon」→「advisory 传感 daemon 可选用 ADR-029 模式」；**仍排除**云 scheduled routines / agent-teams / 强制中央调度。
- ship-anywhere：monitor 是主机可选组件，非 plugin zip 内嵌常驻服务。
- ADR-029 的 lifecycle 面不变（start/stop/restart）；本 ADR 只补「二进制替换后的 wanted→restart」义务。

## 4. Alternatives Considered

### 4.1 A：只靠 hook 回合边界（无 daemon）

可作 MVP，但留 idle 盲区；本 ADR 将其降为「daemon 缺席退化态」，不作为完整答案。

### 4.2 B：harness 内建 timer（CronCreate / ScheduleWakeup only）

ADR-011 已许可降级链自我唤醒，但：(a) 绑在单 session；(b) 跨板池视角弱；(c) Claude 专有工具不 ship-anywhere。可作 session 级 floor，不替代 machine-wide monitor。

### 4.3 C：强制 systemd-only 或强制 launchd-only

否决——把另一 OS 降为二等。

### 4.4 D：PM2 / 第三方进程管理器硬依赖

否决——破 ship-anywhere；多一安装面。

### 4.5 E：只文档「升完请手动 restart」

否决——必忘；monitor 陈旧 = 错误配额建议，不可靠人工纪律。

### 4.6 F：upgrade 后无条件 start 所有服务（含从未开过的 viewer）

否决——惊扰（开端口 / 新 token）；用 wanted 语义收窄。

### 4.7 Evolution note (2026-07-09)

`services reconcile --after-binary-replace`（`install.sh` / `ccm upgrade ccm` 挂钩）在重启 wanted `web-viewer` 前 ensure 内联 frontend 资产物化到 `<home>/services/web-viewer/app-dist/<ccm_version>/`，重启后 HTTP 探活 `/_ccm/health` 与 `/`；监听端口默认 `0`（系统分配随机 ephemeral，不写死）。不自动 open 浏览器。

## 5. Related

- [ADR-032](ADR-032-deterministic-pool-arbiter-and-notification-inbox.md) — 中介 + inbox（本 daemon 的消费/写入对象）
- [ADR-029](ADR-029-ccm-web-viewer-namespace.md) — service 生命周期先例；本 ADR D6 补其二进制同生命周期缺口
- [ADR-022](ADR-022-version-line-decoupling.md) — ccm 线 vs plugin 线；reconcile 只挂 ccm 二进制路径
- [ADR-002](ADR-002-ship-anywhere-scope.md) / [ADR-017](ADR-017-multi-orchestrator-coordination.md) — 被本 ADR 在「advisory daemon」一点上修订默认排斥
- [ADR-011](ADR-011-self-wakeup-watchdog.md) — session 级自我唤醒 floor（互补，非替代）
- 设计稿：`design_docs/plans/2026-07-09-multi-orchestrator-arbiter-and-notification-inbox.md` §14.6

## 6. References

- ADR-029 `ccm web-viewer` service 模式（state.`ccm_version` 已有·缺 post-upgrade reconcile）
- `ccm/apps/cli/src/handlers/upgrade.ts`（今日替换后无服务收尾）
- `install.sh`（今日验 `--version` 后无服务收尾）
- launchd LaunchAgent / systemd user unit 惯例
