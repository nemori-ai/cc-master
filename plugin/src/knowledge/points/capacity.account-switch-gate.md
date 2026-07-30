---
point: capacity.account-switch-gate
---

## 权威陈述

<!-- ccm:k:start point:capacity.account-switch-gate -->
减速侧轻 lever（降档 / 降 WIP / 推迟 float）在**同一份配额内**腾挪、不换底层容量。当一份配额真要在本窗口烧穿、而你手上还握着**未消费的备号**（effective-N>1、`ccm usage advise` 的 `switch_candidate` 非空）时，有一根**最重的 lever**：**切到下一份配额（换号），把整张 board 续过去继续跑。** 怎么读 `switch_candidate` / effective-N 的消费见 `pacing-and-estimation` skill；这里管「读完之后该不该切」。

> **换号前必先过 board-policy 闸。** 在拍「要不要换号」之前，先确认这块板**是否被授权自主换号**：读 `ccm policy show --json` 的 `.data.effective.autonomous_account_switch`（缺省 = `allow`，向后兼容旧板）。
> - **`deny`** → **绝不自主换号**。把「是否授权这块板自主换号」当成一个 `blocked_on:"user"` 决策 surface 给用户、等用户拍板，绝不擅自切。
> - **红线『绝不自授权』**：你**绝不**自己 `ccm policy set --autonomous-account-switch=allow --user-authorized` 去给自己放权——那是 self-grant，与擅自 merge 同属越权（policy 写是用户所有，非 TTY 须 `--user-authorized`，那个标记只该由用户给）。改 policy 的决策永远归用户。
> - 机制层另有一道**硬闸兜底**（`ccm account switch` 在覆写凭证前也读 board.policy、`deny` 即拒并 **exit 7** + best-effort 往 board.log 记一条 decision）——它是**纵深防御的安全网、不是许可绕过**：它存在不代表你可以省掉建议层这道判断，更不代表 `allow`-fail-open 时就该随手切（切不切仍要过下面的 lever 阶梯 + 用户拍板纪律）。机制细节单向引用 `using-ccm`（`${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/account-pool.md` + `${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/command-catalog.md` 的 `account switch`），本文不复述。

> **lever 阶梯——换号永远排在最后。** 先用尽所有轻 lever（降档 / 降 WIP / 推迟高 float），只有当「本窗口的真实容量确实不够装完该装的活、**且** effective-N 仍有未消费余号、**且** board-policy 授权自主换号（见上）」时才上换号。换号现在是**无重启的凭证覆写**（`ccm account switch` 覆写官方共享凭证、运行中 claude 惰性 re-read 接管新号·见下），比从前的「exec 重启 + handoff」轻得多、无 session 边界、无上下文丢失风险——但它仍是**换底层容量**的动作（不是同一份配额内腾挪），故仍排在轻 lever 之后、不是日常节流手段。**7d≥85% 总闸下尤其注意**：换号会刷新新号的 7d 窗，所以它是「7d 逼顶 surface 给用户的那个决策」里**用户可选的一个响应**（与「暂停续耗」并列）——但**切不切由用户拍**（同 7d 总闸纪律 + merge 越权），编排器 surface 选项、不擅自跨这条不可逆消耗边界。

> **切换前/后注意事项（拍板前必权衡的约束）。** 换号不是免费的——surface 给用户拍板时，你该知道这几条真实约束（机制细节单向引用 `using-ccm`，本文只立编排须知）：
> - **覆写的是全局登录**：switch 覆写 `$USER` 视角的官方共享凭证三存储 → **本机所有 claude session 一起切到新号**（不只本编排）。这是好处（pacing 口径变准）也是必须知道的副作用——多 session 并跑时换号会连带把别的 session 也切过去。
> - **旧 blob 会失效、需重录**：号池里早期版本 / 旧写法录的 blob 可能已失效，换号会因此**硬失败**（提示重跑 `ccm account refresh <email>` 重录完整 blob）——这是个该 surface 给用户的失败模式，不是静默放弃。
> - **死依赖 refreshToken 续期**：keychain 里的 access token 仅 ~8h，换号靠 refreshToken 主动续期接管；**refresh 失效则换号硬失败**。故备号必须是**真 `/login` 走完整 OAuth 录的**（`claude setup-token` 铸的 headless token 结构上无 refreshToken、换不进——一句指针，机制见 `using-ccm` 的 `${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/account-pool.md`）。
> - **惰性 pickup**：运行中 claude 在 access token 临近过期才 re-read 被覆写的存储、接管新号（非立即）。

<!-- ccm:k:end point:capacity.account-switch-gate -->
