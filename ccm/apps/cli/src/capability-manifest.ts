// capability-manifest.ts — ccm 稳定 capability 契约的单一真相源（issue #167 DDL capability versioning MVP）。
//
// 为什么存在：跨版本斜错（新 plugin + 旧 ccm / 旧 plugin + 新 ccm）需要一个**结构化协商基础**，取代
//   「探测某个子命令是否存在」这种脆弱方式。ccm 在此声明它兑现哪些 capability + 版本；plugin/hook 经
//   进程边界 shell 查询——`ccm capability list --json` 取全集清单、`ccm capability check <id>` 断言单个——
//   据结果优雅降级并给出明确提示（不是崩溃 / 不是静默）。
//
// 双向斜错语义：
//   · 新 plugin + 旧 ccm：plugin 想用的 id 不在旧 ccm 的清单里 → `check` 非零退出（或旧 ccm 连 `capability`
//     子命令都没有 → 「unknown command」也非零）→ 调用方对任意非零一律优雅降级。查询是主动的、可解释的，
//     取代旧的「试着调用、崩了才知道」。
//   · 旧 plugin + 新 ccm：新 ccm 的清单是既有能力的**超集**；旧 plugin 查询的旧 id 仍在 → 正常工作。
//
// 向后兼容纪律（backward-compat is the core invariant）：本清单**只增不改**——已发布的 capability id
//   永不重命名 / 删除 / 改语义。能力演进另起新 id（含大版本升级 `<name>/vN` → `<name>/vN+1` 追加而非替换）。
//   这条纪律就是「旧 plugin + 新 ccm 永不崩」的保证。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖，纯数据 + 纯函数。
// 武装闸豁免：纯数据 / 纯函数 leaf 模块（无 hook 入口，只被 handler / CLI import）——见 AGENTS.md §3 红线6。

export const CAPABILITY_MANIFEST_SCHEMA = 'ccm/capability-manifest/v1';

export interface CapabilityEntry {
  /** 稳定 capability id（含版本后缀）——跨版本协商的握手键，一经发布永不改。 */
  id: string;
  /** 能力族名（去版本后缀）——同族跨版本演进时的人读归类。 */
  name: string;
  /** 主版本号（整数，单调递增）。 */
  version: number;
}

export interface CapabilityManifest {
  schema: typeof CAPABILITY_MANIFEST_SCHEMA;
  /** 声明本清单的 ccm 构建版本（consumer 可据它给出「升级到 X」的明确提示）。 */
  ccm_version: string;
  capabilities: CapabilityEntry[];
}

// board-init / arming 握手所需的两个 capability id（board.init --capabilities 端点复用·非全集·稳定字符串）。
export const BOARD_INIT_STRUCTURED_PATH_CAPABILITY = 'board-init/structured-board-path-v1';
export const GOAL_CONTRACT_CAPABILITY = 'goal-contract/v1';
// 交付 DDL（issue #149 goal deadline 命令族 / issue #167 versioned negotiation）的 capability id。
export const GOAL_DEADLINE_CAPABILITY = 'goal-deadline/v1';

// 全集清单（append-only·SSOT）。顺序稳定：先既有 arming 能力，再 DDL。新增能力只追加到末尾。
export const CAPABILITIES: readonly CapabilityEntry[] = Object.freeze([
  {
    id: BOARD_INIT_STRUCTURED_PATH_CAPABILITY,
    name: 'board-init/structured-board-path',
    version: 1,
  },
  { id: GOAL_CONTRACT_CAPABILITY, name: 'goal-contract', version: 1 },
  { id: GOAL_DEADLINE_CAPABILITY, name: 'goal-deadline', version: 1 },
]);

// 全部已声明 capability id（供协商方枚举 / 生成明确提示）。
export function capabilityIds(): string[] {
  return CAPABILITIES.map((c) => c.id);
}

// 精确 id 匹配（协商键是不透明字符串·大小写 / 版本后缀都算进 id）。未声明 → false（consumer 据此降级）。
export function isCapabilitySupported(id: string): boolean {
  return CAPABILITIES.some((c) => c.id === id);
}

// 构造结构化清单（`ccm capability list` 的载荷 + 任何需要整份声明的 consumer）。返回可变副本，
//   避免 caller 意外改到 frozen SSOT。
export function buildManifest(ccmVersion: string): CapabilityManifest {
  return {
    schema: CAPABILITY_MANIFEST_SCHEMA,
    ccm_version: ccmVersion,
    capabilities: CAPABILITIES.map((c) => ({ ...c })),
  };
}
