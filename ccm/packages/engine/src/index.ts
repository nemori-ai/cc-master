// @ccm/engine — board v2 引擎公开 API barrel（T1 port·替换 ENGINE_PLACEHOLDER）。
//
// 把 4 个核心模块的公开符号一处 re-export：消费方（apps/cli、hooks、webview IIFE）统一从 `@ccm/engine`
//   取。依赖链：board-model（根·无内部依赖）← board-lint-core ← board-graph-core；board-lock 独立。
//
// 命名无冲突：buildGraph / findCycle 只在 board-lint-core 实际导出（graph-core import 它、不再导出），
//   故 export * 安全。各模块的类型（interface / type alias）一并 re-export 供下游用。

export type {
  BoardLike,
  CriticalPathResult,
  Estimate,
  GraphHandle,
  NodeDuration,
  ScheduleEntry,
  WeightSource,
} from './board-graph-core.js';
// ── board-graph-core（analyzeGraph / nodeDuration / estimateHours）──
export {
  analyzeGraph,
  estimateHours,
  nodeDuration,
} from './board-graph-core.js';
export type {
  BoardGraph,
  EdgeIssue,
  LintEntry,
  LintResult,
} from './board-lint-core.js';
// ── board-lint-core（lintBoard / formatReport / buildGraph / findCycle / STATUS_ENUM / ISO_UTC_RE）──
//   注：board-lint-core 也导出名为 ISO_UTC_RE 的常量（透传自 board-model 的同一正则）；board-model 的
//   ISO_UTC_RE 已在上面 export，二者是同一个值，故此处不再重复导出（避免 re-export 名冲突），改为按需点名。
export {
  buildGraph,
  findCycle,
  formatReport,
  lintBoard,
  STATUS_ENUM,
} from './board-lint-core.js';
export type { LockOptions } from './board-lock.js';
// ── board-lock（acquire / release / withLock / isLocked / lockPathFor）──
export {
  acquire,
  isLocked,
  lockPathFor,
  release,
  withLock,
} from './board-lock.js';
export type {
  AcceptanceObject,
  EnumName,
  FieldMeta,
  Invariant,
  TaskLike,
} from './board-model.js';
// ── board-model（数据模型 SSOT：enums / FIELDS / INVARIANTS / STATUS_MACHINE / predicates）──
export {
  acceptanceConverged,
  ENUMS,
  FIELDS,
  INVARIANTS,
  ISO_UTC_RE,
  invariant,
  isAbsolutePathOrUrl,
  isActiveStatus,
  isAwaitingUser,
  isDoneStatus,
  isEnumMember,
  isISOUTC,
  isLegalTransition,
  levelOf,
  OPEN_ENUMS,
  SCHEMA_VERSION,
  STATUS_MACHINE,
  TIERS,
  taskTrulyDone,
} from './board-model.js';
