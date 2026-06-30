// @ccm/engine — board v2 引擎公开 API barrel（T1 port·替换 ENGINE_PLACEHOLDER）。
//
// 把 4 个核心模块的公开符号一处 re-export：消费方（apps/cli、hooks、webview IIFE）统一从 `@ccm/engine`
//   取。依赖链：board-model（根·无内部依赖）← board-lint-core ← board-graph-core；board-lock 独立。
//
// 命名无冲突：buildGraph / findCycle 只在 board-lint-core 实际导出（graph-core import 它、不再导出），
//   故 export * 安全。各模块的类型（interface / type alias）一并 re-export 供下游用。

// ── account/（Phase 1 纯逻辑移植·registry 模型 + 校验 + 锁 + 选号）──────────────────────────────────
//   整组以命名空间导出（account.selectAccount / account.validateRegistry / account.tokenExpired …），
//   避免与 usage/pacing.ts 的 flat tokenExpired/effectiveN/PoolAccount 撞名（两个 tokenExpired 语义不同·见 account/index.ts）。
export * as account from './account/index.js';
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
// ── coordination/（COORD 多 orchestrator 感知通道·跨板只读花名册）──
export type {
  PeerCurrent,
  PeerEntry,
  PeerPlanned,
  PeerRoster,
  RosterOptions,
} from './coordination/peers.js';
export { buildPeerRoster, PEER_FRESHNESS_SEC } from './coordination/peers.js';
// 校准（EWMA + Bayesian shrinkage ≅ RCF）
export type { CalibrationOptions, CalibrationResult } from './estimate/calibration.js';
export {
  calibrate,
  calibratedEstimate,
  dispersionCv,
} from './estimate/calibration.js';
// CCPM fever / buffer_health
export type {
  BufferInput,
  BufferZone,
  FeverInput,
  FeverResult,
  ProjectBuffer,
} from './estimate/ccpm.js';
export { feverStatus, sizeProjectBuffer } from './estimate/ccpm.js';
// conformal（split + Mondrian 分组）
export type {
  ConformalOptions,
  ConformalResult,
  Interval,
  MondrianDim,
} from './estimate/conformal.js';
export {
  conformalGroupKey,
  conformalInterval,
  empiricalCoverage,
  empiricalQuantile,
  quantilesOf,
} from './estimate/conformal.js';
// EVM + Earned Schedule（SPI(t)）
export type { Baseline, EvmOptions, EvmResult } from './estimate/evm.js';
export { computeEvm } from './estimate/evm.js';
// k-NN 案例推理
export type { KnnNeighbor, KnnOptions, KnnResult, QueryCase } from './estimate/knn.js';
export { knnPredict } from './estimate/knn.js';
// 双通道 MC 调度（估算-DAG + 吞吐 + CI/CRI/SSI + consistency）
export type {
  ConsistencyResult,
  EstimateMcResult,
  ForecastOptions,
  NodeMcParam,
  PctCostMcResult,
  SensitivityEntry,
  ThroughputMcResult,
} from './estimate/mc-scheduler.js';
export {
  dailyThroughput,
  dualChannelConsistency,
  estimateDagMonteCarlo,
  pctCostToCompleteMonteCarlo,
  throughputMonteCarlo,
} from './estimate/mc-scheduler.js';
// ── estimate/（ADR-015 估算引擎算法层·plan §7）────────────────────────────────────────────────────
// PRNG（seeded·sfc32）
export { makePrng, Sfc32 } from './estimate/prng.js';
// RCPSP（list-scheduling min-slack + LFT）
export type { RcpspOptions, RcpspResult } from './estimate/rcpsp.js';
export { rcpspSchedule } from './estimate/rcpsp.js';
// 采样（Box-Muller log-normal）
export type { LogNormalParams } from './estimate/sampling.js';
export {
  logNormalParamsFromMeanCv,
  sampleLogNormalFromLogParams,
  sampleNormal,
  sampleTaskDuration,
} from './estimate/sampling.js';
// SLE + WIP-aging
export type { AgingEntry, AgingStatus, Sle } from './estimate/sle.js';
export { cycleTimeSle, wipAging } from './estimate/sle.js';
// ── paths（CLAUDE_CONFIG_DIR 跟随 + 派生路径 SSOT·home/rate-cache/credentials/.claude.json/projects）──
export type { PathEnv } from './paths.js';
export {
  resolveCcMasterHome,
  resolveClaudeConfigDir,
  resolveClaudeJsonPath,
  resolveCredentialsPath,
  resolveProjectsDir,
  resolveRateCachePath,
} from './paths.js';
// ── usage/（ADR-015 配速 + 历史语料·plan §7）──────────────────────────────────────────────────────
// 历史语料 loader（home 跨板·多层收缩·recency）
export type {
  DoneRecord,
  LoadOptions,
  PoolLayer,
  PoolQuery,
} from './usage/history-loader.js';
export {
  boardRepo,
  DEFAULT_MAX_BOARDS,
  DEFAULT_MAX_DAYS_AGO,
  extractDoneRecords,
  loadCorpus,
  loadHomeBoards,
  poolLayers,
  recencyWeight,
  selectPoolLayer,
} from './usage/history-loader.js';
// pacing（双侧走廊数学 SSOT + effective-N）
export type {
  PacingAdvice,
  PacingOptions,
  PacingVerdict,
  PoolAccount,
  PoolStatus,
  UsageSignal,
  WindowSignal,
} from './usage/pacing.js';
export { effectiveN, pacingAdvice, pctOf, tokenExpired } from './usage/pacing.js';
// solvency（配额%-计成本轴：burn-rate / runway / token 辅助 sizing·ADR-015 延伸·plan §4）
export type {
  BurnRateOptions,
  BurnRateResult,
  BurnSample,
  RunwayOptions,
  RunwayResult,
} from './usage/solvency.js';
export {
  pctBurnRate,
  pctRunway,
  tokenWeightedShares,
  WINDOW_5H_SEC,
  WINDOW_7D_SEC,
} from './usage/solvency.js';
