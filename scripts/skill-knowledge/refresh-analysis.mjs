// refresh-analysis.mjs — 把候选分析里的**派生**字段重新算出来并写回。
//
// ## 为什么需要它
//
// 候选分析文件里混着两类字段：
//
//   · **人写的**   —— scoresheet 的 D1/D2/D3 判断与证据、candidate_modules、rationale
//   · **派生的**   —— graph_metrics、witness 的度量项、verdict
//
// 派生项是从图上算出来的，图一变它们就过期。而此前 toolkit 只提供**校验**它们的能力
// （`analyzeAgainstGraph` 是校验器不是生成器：存档与重算不符时它拒绝产出新分析），
// **没有任何入口能把它们刷新**。后果是：改一段被 composition 消费的正文 → 派生项过期
// → composition 被打成未准入 → 而恢复手段不存在。
//
// 这不是理论缺口。`plugin/src/knowledge/changes/` 零记录、零提交历史——不是没人需要改，
// 是没人走通过。两次独立尝试都撞在这里（见 dogfood-findings 的 Finding #122）。
//
// ## 它绝不能做的事
//
// **一个能把任何失败刷绿的 refresh 不是修复，是旁路。** 所以它只在一种情形下写：
// 诊断**全部**属于「派生项过期」这一类，且重算出的裁决仍是 admit。
//
// 只要出现任何**实质性**诊断（成员关系坏了、身份对不上、准入闸真的没过、裁决翻成
// reject），它一律拒绝并原样报出——那些是真问题，不是陈旧派生值，把它们刷掉就是在
// 用工具掩盖回归。

import fs from 'node:fs';
import path from 'node:path';

import {
  analyzeAgainstGraph,
  deriveVerdict,
  WITNESS_METRIC_KEYS,
} from './candidate-analysis.mjs';
import { DEFAULT_SOURCE_ROOT } from './contracts.mjs';
import { diagnostic } from './diagnostics.mjs';
import { buildAndValidateGraph } from './graph.mjs';

/** 只有这几个码代表「派生项过期」——除它们之外的任何诊断都拒绝刷新。 */
const STALE_DERIVATIVE_CODES = Object.freeze([
  'SKG-ANALYSIS-METRICS-MISMATCH',
  'SKG-ANALYSIS-WITNESS-MISMATCH',
  'SKG-ANALYSIS-VERDICT-MISMATCH',
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 重算一个 composition 的候选分析派生项。
 *
 * @returns {{status:'fresh'|'refreshed'|'refused', path:string|null, diagnostics:object[]}}
 */
function refreshOne({ repoRoot, sourceRoot, composition, graph, write }) {
  const analysisFile = path.join(
    repoRoot,
    sourceRoot,
    'analyses',
    `${String(composition.analysis_ref ?? '').replace(/^analysis:/, '')}.json`,
  );
  if (!fs.existsSync(analysisFile)) {
    return {
      status: 'refused',
      path: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'SKG-REFRESH-ANALYSIS-MISSING',
          message: `Candidate analysis file not found for ${composition.id}`,
          location: analysisFile,
          witness: { composition: composition.id, analysis_ref: composition.analysis_ref },
          remediation: 'Author the candidate analysis before refreshing its derived fields.',
          exitCode: 4,
        }),
      ],
    };
  }

  const result = analyzeAgainstGraph({
    repoRoot,
    skillId: composition.skill_id,
    moduleIds: (composition.consumes?.modules ?? []).map((ref) => ref.id),
    analysisId: composition.analysis_ref,
    compositionId: composition.id,
    graph,
  });

  const codes = (result.diagnostics ?? []).map((item) => item.code);
  if (codes.length === 0) return { status: 'fresh', path: analysisFile, diagnostics: [] };

  const substantive = codes.filter((code) => !STALE_DERIVATIVE_CODES.includes(code));
  if (substantive.length > 0) {
    return {
      status: 'refused',
      path: analysisFile,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'SKG-REFRESH-SUBSTANTIVE-DIAGNOSTIC',
          message: `Refusing to refresh ${composition.id}: diagnostics go beyond stale derived fields.`,
          location: analysisFile,
          witness: {
            composition: composition.id,
            substantive: [...new Set(substantive)].sort(),
            stale_derivative: [...new Set(codes.filter((c) => STALE_DERIVATIVE_CODES.includes(c)))],
          },
          remediation:
            'Fix the substantive problem first. Refresh only recomputes derived fields; it must never turn a real rejection green.',
          exitCode: 4,
        }),
        ...(result.diagnostics ?? []),
      ],
    };
  }

  // ⚠ 这里不能直接用 result.derived_verdict：它是被污染的。
  //
  // 上游把裁决算成 `deriveVerdict(scoresheet, diagnostics.length === 0 && gates.ok)`，
  // 而 diagnostics 里**包含失配诊断本身**。于是「存档陈旧」这一个事实同时充当了
  // 「裁决应为 reject」的依据——陈旧的分析永远推不出 admit，refresh 在构造上不可能成功。
  // 这就是那堵墙的精确成因（Finding #122）。
  //
  // 到这一步，实质性诊断已被上面那个分支挡掉，剩下的只有陈旧派生值。所以在**剔除
  // 陈旧性这一项**之后重算裁决——用的仍是上游同一个 deriveVerdict，只是喂给它一个
  // 未被自身陈旧性污染的 metricGatesOk。判据没放松：admission_gates.ok 仍必须为真。
  const gatesOk = result.admission_gates?.ok === true;
  const cleanVerdict = deriveVerdict(result.scoresheet, gatesOk);
  if (cleanVerdict !== 'admit') {
    return {
      status: 'refused',
      path: analysisFile,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'SKG-REFRESH-VERDICT-WOULD-REJECT',
          message: `Refusing to refresh ${composition.id}: recomputed verdict is ${cleanVerdict}, not admit.`,
          location: analysisFile,
          witness: {
            composition: composition.id,
            derived_verdict: cleanVerdict,
            contaminated_verdict: result.derived_verdict,
            admission_gates: result.admission_gates,
          },
          remediation:
            'The candidate no longer meets admission. That is a real regression — decide whether to repair the composition or retire it; do not persist a rejecting analysis as if it were routine.',
          exitCode: 4,
        }),
      ],
    };
  }

  const before = readJson(analysisFile);
  // ⚠ 只覆盖 witness 里的**度量项**，不能整块替换。
  //
  // `analyzeAgainstGraph` 返回的是**运行时** witness——比持久化形态更丰富（多带
  // composition_hash / analysis_id / skill_id 等定位信息）。整块写进去会引入 schema
  // 不接受的键，文件当场 schema-invalid。持久化 witness 只收 WITNESS_METRIC_KEYS 那
  // 一批，其余（reason 等人写字段）原样保留。
  const refreshedWitness = { ...(before.witness ?? {}) };
  for (const key of WITNESS_METRIC_KEYS) {
    if (result.witness?.[key] !== undefined) refreshedWitness[key] = result.witness[key];
  }
  // 同理：scoresheet / candidate_modules / lifecycle / admission 等人写字段一律不动。
  const after = {
    ...before,
    graph_metrics: result.graph_metrics,
    witness: refreshedWitness,
    verdict: cleanVerdict,
  };
  if (write) writeJson(analysisFile, after);
  return {
    status: 'refreshed',
    path: analysisFile,
    diagnostics: [],
    changed: [
      ...(JSON.stringify(before.graph_metrics) !== JSON.stringify(after.graph_metrics)
        ? ['graph_metrics']
        : []),
      ...(JSON.stringify(before.witness) !== JSON.stringify(refreshedWitness) ? ['witness'] : []),
      ...(before.verdict !== after.verdict ? ['verdict'] : []),
    ],
  };
}

/** 刷新全部（或指定）composition 的候选分析派生项。 */
export function runRefreshAnalysis({
  repoRoot,
  source = DEFAULT_SOURCE_ROOT,
  composition: only = null,
  write = false,
}) {
  const built = buildAndValidateGraph({ repoRoot, sourceRoot: source, skipCompositionAdmission: true });
  if (!built.graph) {
    return {
      exitCode: 4,
      body: {
        ok: false,
        command: 'refresh-analysis',
        diagnostics: built.diagnostics,
      },
    };
  }
  const compositions = (built.graph.compositions ?? []).filter(
    (item) => !only || item.id === only,
  );
  const results = [];
  const diagnostics = [];
  for (const composition of compositions) {
    const one = refreshOne({
      repoRoot,
      sourceRoot: source,
      composition,
      graph: built.graph,
      write,
    });
    results.push({
      composition: composition.id,
      status: one.status,
      ...(one.changed ? { changed_fields: one.changed } : {}),
    });
    diagnostics.push(...(one.diagnostics ?? []));
  }
  const failed = diagnostics.some((item) => item.severity === 'error');
  return {
    exitCode: failed ? 4 : 0,
    body: {
      ok: !failed,
      command: 'refresh-analysis',
      write,
      results,
      diagnostics,
    },
  };
}
