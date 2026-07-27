/**
 * Graph-first / skill-as-artifact helpers for K3-00 walking skeleton.
 *
 * Membership and ownership never derive from Markdown paths or directory names.
 * Skills are admitted compositions that consume global modules/points.
 */
import { diagnostic } from './diagnostics.mjs';
import { buildAndValidateGraph } from './graph.mjs';
import { runCompile } from './compile.mjs';
import {
  CONTRACT_VERSION,
  OUTPUT_SCHEMA,
} from './contracts.mjs';
import { outputDiagnostic, selectExitCode } from './diagnostics.mjs';
import {
  analyzeAgainstGraph,
  compositionToSkillView,
  consumeModuleIds,
  loadCompositionDocument,
} from './candidate-analysis.mjs';

export {
  compositionToSkillView,
  consumeModuleIds,
  consumeModuleRefs,
  loadAnalysisDocument,
  loadCompositionDocument,
} from './candidate-analysis.mjs';

/** Path names are evidence locations only. Always return null membership. */
export function membershipFromPath(_relativePath) {
  return null;
}

/**
 * Deterministic candidate analysis. Authored Counterfactual scoresheet is required.
 */
export function analyzeSkillCandidate({
  repoRoot,
  skillId,
  moduleIds,
  analysisId = null,
  compositionId = null,
  graph: existingGraph = null,
}) {
  let graph = existingGraph;
  if (!graph) {
    const built = buildAndValidateGraph({ repoRoot });
    if (!built.graph) {
      return {
        ok: false,
        skill_id: skillId,
        candidate_modules: [...moduleIds].sort(),
        scoresheet: null,
        verdict: 'reject',
        derived_verdict: 'reject',
        witness: {
          reason: 'graph-invalid',
          diagnostics: built.diagnostics
            ?.filter((item) => item.severity === 'error')
            .slice(0, 5)
            .map((item) => item.code),
        },
        graph_metrics: {},
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'SKG-ANALYSIS-GRAPH-INVALID',
            message: 'Cannot analyze candidate against an invalid graph.',
            location: 'plugin/src/knowledge',
            witness: {},
            remediation: 'Repair graph invariants before candidate analysis.',
            exitCode: 4,
          }),
        ],
      };
    }
    graph = built.graph;
  }

  return analyzeAgainstGraph({
    repoRoot,
    graph,
    skillId,
    moduleIds,
    analysisId,
    compositionId,
  });
}

export function compositionIsAdmittedProductView({ repoRoot, composition, graph = null }) {
  if (!composition || composition.lifecycle?.state !== 'accepted') {
    return { ok: false, reason: 'lifecycle', analysis: null };
  }
  const moduleIds = consumeModuleIds(composition);
  const analysis = analyzeSkillCandidate({
    repoRoot,
    skillId: composition.skill_id,
    moduleIds,
    analysisId: composition.analysis_ref,
    compositionId: composition.id,
    graph,
  });
  if (!analysis.ok || analysis.verdict !== 'admit') {
    return { ok: false, reason: 'verdict', analysis };
  }
  return { ok: true, reason: 'admit', analysis };
}

/**
 * Materialize an admitted composition onto four host dist surfaces via compile.
 */
export function runMaterialize({ repoRoot, compositionId, checkOnly = false }) {
  const loaded = loadCompositionDocument(repoRoot, compositionId);
  if (!loaded) {
    const diag = diagnostic({
      severity: 'error',
      code: 'SKG-COMPOSITION-MISSING',
      message: `Composition not found: ${compositionId}`,
      location: 'plugin/src/knowledge/compositions',
      witness: { composition: compositionId },
      remediation: 'Author an explicit composition manifest before materialize.',
      exitCode: 4,
    });
    return {
      exitCode: 4,
      body: {
        schema: OUTPUT_SCHEMA,
        ok: false,
        command: 'materialize',
        result_kind: 'materialize',
        contract_version: CONTRACT_VERSION,
        diagnostics: [outputDiagnostic(diag)],
      },
    };
  }

  const composition = loaded.doc;
  if (composition.lifecycle?.state !== 'accepted') {
    const diag = diagnostic({
      severity: 'error',
      code: 'SKG-COMPOSITION-LIFECYCLE',
      message: `Composition lifecycle must be accepted to materialize: ${composition.id}`,
      location: loaded.path,
      witness: {
        composition: composition.id,
        lifecycle: composition.lifecycle?.state ?? null,
      },
      remediation: 'Only accepted compositions with derived admit may materialize.',
      exitCode: 4,
    });
    return {
      exitCode: 4,
      body: {
        schema: OUTPUT_SCHEMA,
        ok: false,
        command: 'materialize',
        result_kind: 'materialize',
        contract_version: CONTRACT_VERSION,
        composition: composition.id,
        diagnostics: [outputDiagnostic(diag)],
      },
    };
  }

  const moduleIds = consumeModuleIds(composition);
  const analysis = analyzeSkillCandidate({
    repoRoot,
    skillId: composition.skill_id,
    moduleIds,
    analysisId: composition.analysis_ref,
    compositionId: composition.id,
  });

  if (!analysis.ok || analysis.verdict !== 'admit') {
    const diag = diagnostic({
      severity: 'error',
      code: 'SKG-COMPOSITION-NOT-ADMITTED',
      message: `Composition cannot materialize without derived admit: ${composition.id}`,
      location: loaded.path,
      witness: {
        composition: composition.id,
        verdict: analysis.verdict,
        derived_verdict: analysis.derived_verdict,
        diagnostics: (analysis.diagnostics ?? []).map((item) => item.code),
      },
      remediation:
        'Fix candidate analysis until derived verdict=admit and stored verdict matches.',
      exitCode: 4,
    });
    return {
      exitCode: 4,
      body: {
        schema: OUTPUT_SCHEMA,
        ok: false,
        command: 'materialize',
        result_kind: 'materialize',
        contract_version: CONTRACT_VERSION,
        composition: composition.id,
        analysis,
        diagnostics: [
          outputDiagnostic(diag),
          ...(analysis.diagnostics ?? []).map(outputDiagnostic),
        ],
      },
    };
  }

  const compileResult = runCompile({
    repoRoot,
    check: checkOnly,
  });

  const diagnostics = [...(compileResult.body?.diagnostics ?? [])];
  const exitCode = compileResult.exitCode ?? selectExitCode(diagnostics);
  return {
    exitCode,
    body: {
      schema: OUTPUT_SCHEMA,
      ok: exitCode === 0,
      command: 'materialize',
      result_kind: 'materialize',
      contract_version: CONTRACT_VERSION,
      composition: composition.id,
      skill_id: composition.skill_id,
      analysis,
      skill_view: compositionToSkillView(composition),
      compile_mode: compileResult.body?.compile_mode ?? (checkOnly ? 'check' : 'write'),
      hosts: compileResult.body?.hosts ?? ['claude-code', 'codex', 'cursor', 'kimi-code'],
      host_results: compileResult.body?.host_results ?? [],
      graph_hash: compileResult.body?.graph_hash ?? null,
      diagnostics,
    },
  };
}
