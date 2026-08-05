// 本文件由 scripts/gen-output-samples.mjs 生成——不要手改。
//
// 每条是该命令 `--json` 真实输出的 `data`，经 output-sample-sanitize.ts 净化（时间/路径/
// 摘要换成自解释占位符，数组只留首元素作形状）。样例的价值是**嵌套结构与字段类型**——
// 那正是 required_keys 这种顶层键声明传达不了的一层。
//
// 收录条件：在两块独立的新鲜板上捕获、净化后逐字节一致。不一致的**不收**，理由见下方
// 注释——宁可少一条，不可收一条会飘的。
//
// 重新生成：node scripts/gen-output-samples.mjs
//
// 本次排除：
//   peers list —— 两块独立板上净化后仍不一致（含未被净化的机器/环境相关值）

export const OUTPUT_SAMPLES: Readonly<Record<string, unknown>> = Object.freeze({
  "capability list": {
    "schema": "ccm/capability-manifest/v1",
    "ccm_version": "0.23.0",
    "capabilities": [
      {
        "id": "board-init/structured-board-path-v1",
        "name": "board-init/structured-board-path",
        "version": 1
      }
    ]
  },
  "quota status": {
    "schema": "ccm/quota-status/v1",
    "available": false
  },
  "board show": {
    "goal": "output sample seed board",
    "owner": {
      "active": true,
      "session_id": "",
      "heartbeat": "<iso-utc>"
    },
    "taskCount": 2,
    "statusCounts": {
      "in_flight": 1,
      "blocked": 1
    },
    "lint": {
      "ok": true,
      "errors": 0,
      "warnings": 2
    }
  },
  "board lint": {
    "ok": true,
    "violations": [
      {
        "rule": "BIZ-DEADLINE-PENDING",
        "level": "warn",
        "message": "交付 DDL 尚未 settle（未询问或仍 pending），但 board 已含可执行任务；先确认交付截止期（`ccm goal deadline set|confirm`）或明确无 DDL（`ccm goal deadline confirm-none`），再拆 DAG 派发。\n  怎么修：拆 DAG 前先 `ccm goal deadline set/confirm`（确认交付截止期）或 `ccm goal deadline confirm-none`（确认无 DDL）"
      }
    ],
    "report": "cc-master board lint: PASS（0 hard error，2 warning）\n\n[warn] BIZ-DEADLINE-PENDING 交付 DDL 尚未 settle（未询问或仍 pending），但 board 已含可执行任务；先确认交付截止期（`ccm goal deadline set|confirm`）或明确无 DDL（`ccm goal deadline confirm-none`），再拆 DAG 派发。\n  怎么修：拆 DAG 前先 `ccm goal deadline set/confirm`（确认交付截止期）或 `ccm goal deadline confirm-none`（确认无 DDL）\n\n[warn] BIZ-INFLIGHT-AGENT T1 已 in_flight 但无任何 agent 登记指向它——凡派发皆登记，建议 `ccm agent create`+`ccm agent link T1` 补登记，让花名册/viewer 能观测这次派发。\n  怎么修：凡派发皆登记：`ccm agent create` + `ccm agent link <agent-id> --task <task-id>` 补登记，让花名册 / viewer 能观测这次派发\n"
  },
  "board graph": {
    "topoOrder": [
      "T1"
    ],
    "cycle": null,
    "readySet": [],
    "criticalPath": {
      "chain": [
        "T1"
      ],
      "makespan": null,
      "weight_source": "mixed"
    },
    "parallelism": {
      "T1": 2,
      "Tinf": 2,
      "parallelism": 1
    },
    "impact": {
      "T1": {
        "count": 1,
        "descendants": [
          "T2"
        ]
      },
      "T2": {
        "count": 0,
        "descendants": []
      }
    },
    "rollup": {
      "owners": {},
      "inconsistencies": []
    },
    "nesting": {
      "depth1": [],
      "parentCycles": []
    }
  },
  "board critical-path": {
    "chain": [
      "T1"
    ],
    "makespan": null,
    "weight_source": "mixed"
  },
  "goal show": {
    "board_path": "<abs-path>",
    "summary": "output sample seed board",
    "contract": {
      "schema": "ccm/goal-contract/v1",
      "revision": 1,
      "assurance": "asserted",
      "updated_at": "<iso-utc>"
    },
    "brief_path": null
  },
  "goal check": {
    "schema": "ccm/goal-check/v1",
    "board_path": "<abs-path>",
    "summary": "output sample seed board",
    "revision": 1,
    "assurance": "asserted",
    "brief_ref": null,
    "brief_path": null,
    "deadline": {
      "present": false,
      "state": "pending",
      "at": null,
      "precision": "minute",
      "kind": "hard",
      "rev": null,
      "settled": false
    },
    "verdict": "deadline_pending",
    "reason": "Goal Contract settled but delivery deadline not yet asked; set/confirm a deadline or confirm no-DDL before dispatch"
  },
  "task show": {
    "id": "T1",
    "status": "in_flight",
    "deps": [],
    "title": "seed task",
    "estimate": {
      "value": 2,
      "unit": "h"
    },
    "created_at": "<iso-utc>",
    "started_at": "<iso-utc>"
  },
  "task list": [
    {
      "id": "T1",
      "status": "in_flight",
      "type": null,
      "executor": null,
      "title": "seed task"
    }
  ],
  "baseline show": {
    "has_baseline": false,
    "baseline": null
  },
  "policy show": {
    "policy": null,
    "effective": {
      "autonomous_account_switch": "allow"
    }
  },
  "agent list": {
    "count": 0,
    "buckets": {},
    "agents": [],
    "stale_candidates": []
  },
  "usage show": {
    "available": false,
    "accounts_scope": "all",
    "effective_n": 1,
    "agent_summary": "claude-code: UNAVAILABLE (无 status-line sidecar) · 等待或 surface 用户 · 不可自刷",
    "current": {
      "source": "account",
      "available": false,
      "five_hour": null,
      "seven_day": null,
      "fable_seven_day": null,
      "billing_period": null,
      "pools": [],
      "captured_at": null
    },
    "accounts": [],
    "registry_present": false,
    "as_of": null,
    "source": "account",
    "confidence": "low",
    "refresh_hint": null
  },
  "usage advise": {
    "verdict": "hold",
    "reason": "账户权威信号不可用（5h/7d/billing_period used% 均缺/过期）——降级，pacing 不可判",
    "levers": [],
    "strength": "weak",
    "stop_dimension": null,
    "nearest_reset": null,
    "window_5h_pct": null,
    "window_7d_pct": null,
    "window_billing_period_pct": null,
    "billing_period_resets_at": null,
    "effective_n": 1,
    "switch_candidate": null,
    "confidence": "low",
    "source": "local-derived-approx",
    "as_of": null,
    "available": false,
    "refresh_hint": null
  },
  "usage task-cost": {
    "group_by": "task",
    "scope": "this-board",
    "groups": [
      {
        "key": "T1",
        "total": 0,
        "n": 1,
        "na_count": 1
      }
    ],
    "total": 0,
    "coverage_pct": 0,
    "history_n": 0,
    "source": "observability",
    "confidence": "low"
  },
  "usage burn-rate": {
    "available": false,
    "five_hour": {
      "used_pct": null,
      "resets_at": null,
      "burn_pct_per_hour": null,
      "method": "none",
      "confidence": "low",
      "source": "account",
      "unavailable_reason": "无 status-line sidecar",
      "harness": "Claude Code"
    },
    "seven_day": {
      "used_pct": null,
      "resets_at": null,
      "burn_pct_per_hour": null,
      "method": "none",
      "confidence": "low",
      "source": "account",
      "unavailable_reason": "无 status-line sidecar",
      "harness": "Claude Code"
    },
    "source": "local-derived-approx",
    "as_of": null,
    "confidence": "low",
    "refresh_hint": null
  },
  "usage runway": {
    "available": false,
    "five_hour": {
      "used_pct": null,
      "burn_pct_per_hour": null,
      "remaining_corridor_pct": null,
      "hours_to_ceiling": null,
      "hours_to_reset": null,
      "verdict": "unknown",
      "ceiling_pct": 90
    },
    "seven_day": {
      "used_pct": null,
      "burn_pct_per_hour": null,
      "remaining_corridor_pct": null,
      "hours_to_ceiling": null,
      "hours_to_reset": null,
      "verdict": "unknown",
      "ceiling_pct": 85
    },
    "source": "local-derived-approx",
    "as_of": null,
    "confidence": "low",
    "refresh_hint": null
  },
  "estimate show": {
    "scope": "home",
    "as_of": "<iso-utc>",
    "history_n": 0,
    "tasks": [
      {
        "id": "T1",
        "raw_estimate_h": 2,
        "calibration": {
          "multiplier": 1,
          "source": "no-history",
          "level": "home",
          "history_n": 0
        },
        "calibrated_h": 2,
        "interval": {
          "p50": 2,
          "p80": 2,
          "p95": 2
        },
        "confidence": "low",
        "coverage_basis": "no-history",
        "source": "estimate"
      }
    ]
  },
  "estimate forecast": {
    "forecast": {
      "p50": "<iso-utc>",
      "p80": "<iso-utc>",
      "p95": "<iso-utc>"
    },
    "makespan": {
      "p50": {
        "value": 2.87,
        "unit": "h"
      },
      "p80": {
        "value": 3.63,
        "unit": "h"
      },
      "p95": {
        "value": 4.59,
        "unit": "h"
      }
    },
    "throughput_days": {
      "p50": null,
      "p80": null,
      "p95": null
    },
    "criticality_index": [
      {
        "id": "T1",
        "criticality": 1,
        "cruciality": 0.885,
        "sensitivity": 0.894
      }
    ],
    "schedule_sensitivity": [
      {
        "id": "T1",
        "sensitivity": 0.894
      }
    ],
    "consistency": null,
    "mode": "both",
    "coverage_pct": 50,
    "confidence": "low",
    "history_n": 0,
    "scope": "home",
    "runs": 2000,
    "seed": 42,
    "effective_n": 1,
    "as_of": "<iso-utc>",
    "source": "estimate",
    "deadline_risk": null,
    "notes": [
      "1 tasks unit-time fallback（缺估值或校准退 1.0·plan 行 26）"
    ]
  },
  "estimate evm": {
    "has_baseline": false,
    "baseline_captured_at": null,
    "as_of": "<iso-utc>",
    "pv": {
      "value": 0,
      "unit": "h"
    },
    "ev": {
      "value": 0,
      "unit": "h"
    },
    "ac": {
      "value": 0,
      "unit": "h",
      "source": "duration",
      "coverage_pct": 0
    },
    "spi": null,
    "cpi": null,
    "spi_t": null,
    "sv_t": null,
    "es_hours": null,
    "at_hours": null,
    "eac": null,
    "ieac_t": null,
    "etc": null,
    "bac": {
      "value": 0,
      "unit": "h"
    },
    "vac": null,
    "confidence": "low",
    "warnings": [
      "无 board.baseline——EVM 需要计划基线，先 `baseline snapshot`"
    ],
    "source": "evm-earned-schedule"
  },
  "estimate velocity": {
    "scope": "home",
    "window_days": null,
    "velocity_tasks_per_day": null,
    "backlog": 2,
    "eta_days": null,
    "sle": {
      "p50": null,
      "p85": null,
      "p95": null,
      "unit": "h",
      "confidence": "low",
      "history_n": 0
    },
    "history_n": 0,
    "confidence": "low",
    "source": "no-history",
    "as_of": "<iso-utc>"
  },
  "estimate risk": {
    "scope": "home",
    "criticality_index": [
      {
        "id": "T1",
        "criticality": 1,
        "cruciality": 0.885,
        "sensitivity": 0.894
      }
    ],
    "wip_aging": [],
    "ccpm": {
      "buffer_size_h": 0.45,
      "chain_mean_total_h": 3,
      "zone": "green",
      "buffer_health": 0,
      "chain_progress_pct": 0
    },
    "sle": {
      "p85": null,
      "p95": null,
      "confidence": "low"
    },
    "history_n": 0,
    "confidence": "low",
    "source": "estimate",
    "as_of": "<iso-utc>",
    "seed": 42,
    "runs": 2000
  },
  "estimate cost-to-complete": {
    "cost_to_complete_pct": null,
    "mean_pct": null,
    "backlog": 2,
    "burn_pct_per_hour": null,
    "burn_used_pct": null,
    "burn_method": "none",
    "per_unit_samples": 0,
    "token_sizing": {
      "total_predicted_tokens": null,
      "per_task": [
        {
          "id": "T1",
          "predicted_tokens": null,
          "pct_share": null,
          "knn_confidence": "low"
        }
      ],
      "note": "token 为派活相对 sizing（辅助·knnPredict.predictedTokens）·配额% 才是预算账本"
    },
    "scope": "home",
    "runs": 2000,
    "seed": 42,
    "as_of": "<iso-utc>",
    "source": "local-derived-approx",
    "confidence": "low",
    "available": false,
    "history_n": 0,
    "notes": [
      "账户 burn-rate 不可用（Claude Code: 无 status-line sidecar）——%-cost 无法折算·available:false 降级"
    ]
  },
  "estimate deadline-risk": {
    "deadline": null,
    "deadline_state": "pending",
    "as_of": "<iso-utc>",
    "time_remaining_hours": null,
    "on_time_probability": null,
    "on_time_probability_source": "unknown",
    "forecast": null,
    "margin": null,
    "risk_band": "unknown",
    "strength": "weak",
    "channels": {
      "precedence_only": null,
      "resource_aware": null,
      "throughput_reference": null
    },
    "channel_disagreement": null,
    "coverage_pct": 50,
    "confidence": "low",
    "history_n": 0,
    "scope": "home",
    "calibration_status": "uncalibrated-conservative",
    "top_drivers": [],
    "runs": 2000,
    "rcpsp_runs": 0,
    "seed": 42,
    "source": "estimate",
    "notes": [
      "deadline_state=pending——无已确认/断言 DDL·风险 n/a（不假绿）"
    ]
  },
  "account list": {
    "registry": "<abs-path>",
    "count": 0,
    "accounts": []
  },
  "harness list": {
    "current": "claude-code",
    "installed": [
      "codex"
    ],
    "installedSurfaces": [
      "cursor-ide-plugin"
    ],
    "harnesses": [
      {
        "id": "codex",
        "displayName": "Codex",
        "installed": true,
        "active": false,
        "reason": null,
        "cli": {
          "name": "codex",
          "path": "<abs-path>",
          "available": true
        },
        "configPaths": [
          "<abs-path>"
        ],
        "surfaces": [],
        "capabilities": {
          "accountPool": {
            "supported": false,
            "reason": "Codex support is currently limited to current-account usage signals; account-pool management and account switching remain unsupported."
          },
          "externalStatusline": {
            "supported": false,
            "reason": "Codex exposes configurable built-in footer items, not a Claude Code-style external statusLine.command hook."
          },
          "pluginDistribution": {
            "supported": true,
            "reason": "Codex installs cc-master through a local Codex marketplace/plugin registration and skill/hook delivery from that package."
          }
        }
      }
    ]
  },
  "harness current": {
    "current": "claude-code",
    "harness": {
      "id": "claude-code",
      "displayName": "Claude Code",
      "installed": true,
      "active": true,
      "reason": null,
      "cli": {
        "name": "claude",
        "path": "<abs-path>",
        "available": true
      },
      "configPaths": [
        "<abs-path>"
      ],
      "surfaces": [],
      "capabilities": {
        "accountPool": {
          "supported": true
        },
        "externalStatusline": {
          "supported": true
        },
        "pluginDistribution": {
          "supported": true
        }
      }
    }
  }
});
