# Skill Adaptation Task List

更新时间：2026-07-03。

本清单跟踪 `plugin/src/skills` 从 Claude Code-only runtime 文本拆成多 host SAP adapter 的工作。细节盘点见 `skill-host-coupling-audit.md`。

## Status Legend

- `done`：结构已落地，projection 可验证。
- `partial`：已防止错误投影，但 runtime 正文尚未完全 host-neutral。
- `pending`：尚未实施。

## Tasks

| ID | Status | Scope | Deliverable |
| --- | --- | --- | --- |
| S1 | done | 建立 host capability base | `plugin/src/skills/_hosts/{claude-code,codex}/capabilities.yaml` |
| S2 | done | projection 支持 skill-only host 生成 | `scripts/sync-plugin-dist.sh --host codex --skills-only` |
| S3 | done | 给七个 runtime skills 补 Codex SAP strategy | `plugin/src/skills/*/adapters/codex/strategy.yaml` |
| S4 | done | 防止 Claude-only skills 被误投给 Codex | 早期用 `unsupported_stub` 阻断错误投影；当前只剩 `authoring-workflows` 保持显式 stub |
| S5 | done | 允许 host-neutral skills 投影到 Codex | `slicing-goals-into-dags` / `dev-as-ml-loop` / `engineering-with-craft` 使用 `mode: copy` |
| S6 | partial | `authoring-workflows` 模块化 | Codex 仍 stub；下一步把 host-neutral orchestration 判断从 Claude Workflow API 中拆出 |
| S7 | done | `master-orchestrator-guide` 模块化 | Codex 用 canonical + slots/overlays；command surface / dispatch / watchdog / hook feedback 已 host-specific 化 |
| S8 | done | `using-ccm` 模块化 | Codex 用 canonical + slots/overlays；portable board commands 与 Codex account/statusline/upgrade 边界已拆 |
| S9 | done | `pacing-and-estimation` 模块化 | Codex 用 canonical + slots/overlays；quota signal provider 与 unsupported account switching 已拆 |
| S10 | partial | Codex runtime enablement | 除 `authoring-workflows` 外，Codex distributed skills 已解除 stub；commands 用 `adapter_guidance`，hooks 用 PHIP Codex implementations |
| C1 | done | ccm 源码 Claude Code binding 盘点 | `design_docs/harnesses/ccm-host-coupling-audit.md` |
| C2 | done | ccm host backend 边界 | config/status/account/plugin manager provider interfaces |
| S11 | done | Codex dist host-leak复核 | 用 `skill-host-coupling-audit.md` 的 follow-up grep 检查 `plugin/dist/codex/skills`，清掉未解释的 Claude account/statusline/model-tier/workflow 残留 |

## Acceptance

Current phase acceptance:

- `bash scripts/sync-plugin-dist.sh` still generates the full Claude Code adapter.
- `bash scripts/sync-plugin-dist.sh --host codex --skills-only` generates a Codex skills dist without copying known Claude-only runtime instructions.
- `bash run-tests.sh` remains green.

Next phase acceptance:

- No `unsupported_stub` remains for a skill unless the unsupported gap is intentionally documented.
- Codex dist contains either host-neutral instructions or verified Codex-native overlays for every distributed skill.
