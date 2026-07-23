import path from 'node:path';
import {
  CAPABILITIES,
  CONTRACT_VERSION,
  DEFAULT_SOURCE_ROOT,
  EXIT_CODES,
  HARDENING_CONTRACT,
  OUTPUT_SCHEMA,
} from './contracts.mjs';
import { diagnostic, outputDiagnostic, selectExitCode } from './diagnostics.mjs';
import { buildAndValidateGraph } from './graph.mjs';
import { buildHostArtifacts, diffArtifacts, writeArtifacts } from './compile/emit.mjs';
import { PRODUCT_HOSTS, entrySurfaceToDistPath } from './compile/paths.mjs';
import {
  countEnabledRuntimeEdges,
  verifyHopContracts,
} from './compile/surface-verifier.mjs';
import { resolveTrustedCandidateHostDist } from './compile/trusted-host-dist.mjs';
import { estimateBudget } from './hash.mjs';

function publicDiagnostics(diagnostics) {
  return diagnostics.map(outputDiagnostic);
}

function envelopeBase(extra = {}) {
  return {
    schema: OUTPUT_SCHEMA,
    command: 'compile',
    result_kind: 'compile',
    contract_version: CONTRACT_VERSION,
    ...extra,
  };
}

function checkRouterBudgets(host, graph, artifacts, diagnostics) {
  const limits = graph.portfolio?.router_budget ?? {};
  const atlasPath = `plugin/dist/${host}/knowledge/atlas.md`;
  const atlasBudget = estimateBudget(artifacts.get(atlasPath) ?? '');
  if (
    (typeof limits.atlas_max_tokens === 'number' &&
      atlasBudget.estimated_tokens > limits.atlas_max_tokens) ||
    (typeof limits.atlas_max_lines === 'number' && atlasBudget.lines > limits.atlas_max_lines)
  ) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'SKG-BUDGET-ROUTER',
        message: `Atlas router budget exceeded for ${host}`,
        location: atlasPath,
        witness: { host, budget: atlasBudget, limits },
        remediation: 'Shrink atlas cues/links or raise router_budget with rationale.',
        exitCode: 4,
      }),
    );
  }
  for (const module of graph.modules) {
    const slug = module.id.replace(/^module:/, '');
    const routerPath = `plugin/dist/${host}/knowledge/modules/${slug}.md`;
    const budget = estimateBudget(artifacts.get(routerPath) ?? '');
    if (
      (typeof limits.module_max_tokens === 'number' &&
        budget.estimated_tokens > limits.module_max_tokens) ||
      (typeof limits.module_max_lines === 'number' && budget.lines > limits.module_max_lines)
    ) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'SKG-BUDGET-ROUTER',
          message: `Module router budget exceeded for ${module.id} on ${host}`,
          location: routerPath,
          witness: { host, module: module.id, budget, limits },
          remediation: 'Shrink module router membership/links or raise router_budget.',
          exitCode: 4,
        }),
      );
    }
  }
  return {
    atlas: atlasBudget,
    limits,
  };
}

function compileOneHost({ host, graph, repoRoot, checkOnly, hostDistAbsolute = null }) {
  const diagnostics = [];
  const built = buildHostArtifacts({
    host,
    graph,
    repoRoot,
    hostDistAbsolute,
  });
  diagnostics.push(...built.diagnostics);

  const candidateHostRoots = hostDistAbsolute
    ? { [host]: path.resolve(hostDistAbsolute) }
    : null;

  if (checkOnly) {
    const drift = diffArtifacts(repoRoot, built.artifacts, { candidateHostRoots });
    if (drift.length > 0) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'SKG-COMPILE-DRIFT',
          message: `Compiled knowledge surface drifted for ${host}`,
          location: `plugin/dist/${host}`,
          witness: { host, drift },
          remediation: 'Run compile without --check and commit the regenerated dist knowledge surfaces.',
          exitCode: EXIT_CODES.drift,
        }),
      );
    }
  } else if (diagnostics.every((item) => item.severity !== 'error')) {
    try {
      writeArtifacts(repoRoot, built.artifacts, { candidateHostRoots });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const codeMatch = message.match(/^(SKG-COMPILE-[A-Z0-9-]+):/);
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: codeMatch?.[1] ?? 'SKG-COMPILE-WRITE-FAILED',
          message,
          location: `plugin/dist/${host}`,
          witness: { host, error: message },
          remediation:
            'Refuse to write through symlink ancestors of plugin/dist/<host>; keep the host dist tree rooted inside the repository.',
          exitCode: EXIT_CODES.projection,
        }),
      );
    }
  }

  const payloadRoot = hostDistAbsolute
    ? path.resolve(hostDistAbsolute)
    : path.join(repoRoot, 'plugin/dist', host);
  const skillDirs = (graph.skills ?? []).map(
    (skill) => `skills/${skill.id.replace(/^skill:/, '')}`,
  );
  const scopedRoots = ['knowledge', ...skillDirs];
  for (const entry of graph.entries ?? []) {
    for (const surfaceSpec of entry.surfaces ?? []) {
      if (surfaceSpec.host !== host) continue;
      const distRel = entrySurfaceToDistPath(host, surfaceSpec.source_file);
      if (!distRel) continue;
      const relative = distRel.replace(`plugin/dist/${host}/`, '');
      if (!scopedRoots.includes(relative)) scopedRoots.push(relative);
    }
  }
  const surface = countEnabledRuntimeEdges({
    host,
    payloadRoot,
    repoRoot,
    mode: 'canonical',
    scopedRoots,
  });
  diagnostics.push(...surface.diagnostics);

  const hops = verifyHopContracts({
    host,
    graph,
    surface,
    repoRoot,
    payloadRoot,
  });
  diagnostics.push(...hops.diagnostics);

  const budgets = checkRouterBudgets(host, graph, built.artifacts, diagnostics);
  const ok = diagnostics.every((item) => item.severity !== 'error');

  return {
    host,
    ok,
    mode: 'canonical',
    artifacts: [...built.artifacts.keys()]
      .sort()
      .map((item) => ({
        path: item,
        bytes: Buffer.byteLength(built.artifacts.get(item), 'utf8'),
      })),
    enabled_edges: surface.enabled_edges,
    point_anchors: surface.point_anchors,
    hop_report: hops.hopReport,
    budgets: {
      ...budgets,
      ...hops.budgets,
    },
    executed_checks: surface.executed_checks,
    diagnostics,
  };
}

export function runCompile({
  repoRoot,
  source = DEFAULT_SOURCE_ROOT,
  host = undefined,
  check = false,
  /**
   * Internal-only: absolute candidate host root for a single-host compile.
   * Must not be exposed by public CLI argv. Sync orchestration uses this so
   * compile targets whole-host staging before live publish.
   */
  candidateHostRoot = undefined,
}) {
  const hosts = host ? [host] : [...PRODUCT_HOSTS];
  if (host && !HARDENING_CONTRACT.C9.hosts.includes(host)) {
    const item = diagnostic({
      severity: 'error',
      code: 'SKG-HOST-UNKNOWN',
      message: `Host is outside the frozen C9 set: ${host}`,
      location: 'argv',
      witness: { command: 'compile', host, allowed: [...HARDENING_CONTRACT.C9.hosts] },
      remediation: 'Pass one of claude-code / codex / cursor / kimi-code.',
      exitCode: EXIT_CODES.usage,
    });
    return {
      exitCode: EXIT_CODES.usage,
      body: {
        schema: OUTPUT_SCHEMA,
        ok: false,
        command: 'compile',
        result_kind: 'diagnostic',
        contract_version: CONTRACT_VERSION,
        diagnostics: publicDiagnostics([item]),
      },
    };
  }

  if (candidateHostRoot) {
    if (!host || hosts.length !== 1) {
      const item = diagnostic({
        severity: 'error',
        code: 'SKG-COMPILE-CANDIDATE-USAGE',
        message: 'candidateHostRoot requires exactly one --host',
        location: 'argv',
        witness: { host: host ?? null },
        remediation: 'Internal sync must pass a single host with candidateHostRoot.',
        exitCode: EXIT_CODES.usage,
      });
      return {
        exitCode: EXIT_CODES.usage,
        body: {
          schema: OUTPUT_SCHEMA,
          ok: false,
          command: 'compile',
          result_kind: 'diagnostic',
          contract_version: CONTRACT_VERSION,
          diagnostics: publicDiagnostics([item]),
        },
      };
    }
  }

  // Trust-check candidate BEFORE any path concat / exists / lstat / read /
  // loader / overlay / verifier against that root. Single helper owner.
  let trustedCandidateHostRoot = null;
  if (candidateHostRoot) {
    try {
      const trust = resolveTrustedCandidateHostDist(repoRoot, host, candidateHostRoot);
      trustedCandidateHostRoot = trust.hostDistAbsolute;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const codeMatch = message.match(/^(SKG-COMPILE-[A-Z0-9-]+):/);
      const item = diagnostic({
        severity: 'error',
        code: codeMatch?.[1] ?? 'SKG-COMPILE-CANDIDATE-INVALID',
        message,
        location: 'candidateHostRoot',
        witness: {
          host,
          candidateHostRoot: path.resolve(candidateHostRoot),
          error: message,
        },
        remediation:
          'Pass a real controlled sibling plugin/dist/<host>.write-<stamp> under the repo; refuse escape / namespace / symlink aliases.',
        exitCode: EXIT_CODES.projection,
      });
      return {
        exitCode: EXIT_CODES.projection,
        body: {
          schema: OUTPUT_SCHEMA,
          ok: false,
          command: 'compile',
          result_kind: 'diagnostic',
          contract_version: CONTRACT_VERSION,
          diagnostics: publicDiagnostics([item]),
        },
      };
    }
  }

  const built = buildAndValidateGraph({ repoRoot, sourceRoot: source });
  if (!built.graph || !built.ok) {
    const diagnostics = built.diagnostics.length
      ? built.diagnostics
      : [
          diagnostic({
            severity: 'error',
            code: 'SKG-COMPILE-GRAPH-UNAVAILABLE',
            message: 'Cannot compile because the authored graph failed validation.',
            location: built.source_root,
            witness: { source_root: built.source_root },
            remediation: 'Fix check diagnostics before compiling host surfaces.',
            exitCode: 4,
          }),
        ];
    const exitCode = selectExitCode(diagnostics);
    return {
      exitCode,
      body: {
        schema: OUTPUT_SCHEMA,
        ok: false,
        command: 'compile',
        result_kind: 'diagnostic',
        contract_version: CONTRACT_VERSION,
        diagnostics: publicDiagnostics(diagnostics),
      },
    };
  }

  const hostResults = [];
  const diagnostics = [];
  for (const item of hosts) {
    const result = compileOneHost({
      host: item,
      graph: built.graph,
      repoRoot,
      checkOnly: check,
      hostDistAbsolute:
        trustedCandidateHostRoot && item === host ? trustedCandidateHostRoot : null,
    });
    hostResults.push({
      host: result.host,
      ok: result.ok,
      mode: result.mode,
      artifacts: result.artifacts,
      enabled_edges: result.enabled_edges,
      point_anchors: result.point_anchors,
      hop_report: result.hop_report,
      budgets: result.budgets,
      executed_checks: result.executed_checks,
    });
    diagnostics.push(...result.diagnostics);
  }

  const exitCode = selectExitCode(diagnostics);
  const body = envelopeBase({
    ok: exitCode === 0,
    source_root: built.source_root,
    graph_hash: built.graph.graph_hash,
    compile_mode: check ? 'check' : 'write',
    hosts,
    host_results: hostResults,
    capabilities: { ...CAPABILITIES },
    diagnostics: publicDiagnostics(diagnostics),
  });
  return { exitCode, body };
}
