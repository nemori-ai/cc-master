import {
  CAPABILITIES,
  CONTRACT_VERSION,
  DEFAULT_SOURCE_ROOT,
  EXIT_CODES,
  HARDENING_CONTRACT,
  OUTPUT_SCHEMA,
} from './contracts.mjs';
import { loadPublishedBehaviorEvidence } from './behavior-eval.mjs';
import { diagnostic, outputDiagnostic, selectExitCode } from './diagnostics.mjs';
import { buildAndValidateGraph, resolveEntityId, shortestPath } from './graph.mjs';
import { compareCodePoint } from './hash.mjs';

const HOSTS = new Set(HARDENING_CONTRACT.C9.hosts);
const REPORT_FORMATS = new Set(['json', 'markdown']);

export function assertKnownHost(host, { command = 'path' } = {}) {
  if (HOSTS.has(host)) return null;
  return diagnostic({
    severity: 'error',
    code: 'SKG-HOST-UNKNOWN',
    message: `Host is outside the frozen C9 set: ${host ?? '<missing>'}`,
    location: 'argv',
    witness: { command, host: host ?? null, allowed: [...HOSTS] },
    remediation: 'Pass one of claude-code / codex / cursor / kimi-code.',
    exitCode: EXIT_CODES.usage,
  });
}

export function assertReportFormat(format) {
  if (REPORT_FORMATS.has(format)) return null;
  return diagnostic({
    severity: 'error',
    code: 'SKG-USAGE',
    message: `report --format must be json|markdown, got: ${format ?? '<missing>'}`,
    location: 'argv',
    witness: { command: 'report', format: format ?? null, allowed: [...REPORT_FORMATS] },
    remediation: 'Use --format json or --format markdown.',
    exitCode: EXIT_CODES.usage,
  });
}

function envelopeBase(command, resultKind, extra = {}) {
  return {
    schema: OUTPUT_SCHEMA,
    command,
    result_kind: resultKind,
    contract_version: CONTRACT_VERSION,
    ...extra,
  };
}

function publicDiagnostics(diagnostics) {
  return diagnostics.map(outputDiagnostic);
}

export function runReport({ repoRoot, source = DEFAULT_SOURCE_ROOT }) {
  const built = buildAndValidateGraph({ repoRoot, sourceRoot: source });
  const diagnostics = built.diagnostics;
  const exitCode = selectExitCode(diagnostics);
  const structuralState = !built.graph
    ? 'fail'
    : exitCode === 0
      ? diagnostics.some((item) => item.severity === 'debt')
        ? 'debt'
        : 'pass'
      : 'fail';
  const loadedBehavioralEvidence = built.graph?.graph_hash
    ? loadPublishedBehaviorEvidence({
        repoRoot,
        graphHash: built.graph.graph_hash,
      })
    : { state: 'not_run', evidence: [] };
  const behavioralEvidence = {
    state: loadedBehavioralEvidence.state,
    evidence: loadedBehavioralEvidence.evidence ?? [],
    ...(loadedBehavioralEvidence.verdict
      ? { verdict: loadedBehavioralEvidence.verdict }
      : {}),
  };

  const body = envelopeBase('report', 'report', {
    ok: exitCode === 0,
    source_root: built.source_root,
    ...(built.graph?.graph_hash ? { graph_hash: built.graph.graph_hash } : {}),
    structural_status: {
      state: structuralState,
      // Omit counts when no graph: committed schema allows object only, not null.
      ...(built.graph ? { counts: built.graph.counts } : {}),
      ...(built.graph?.graph_hash ? { graph_hash: built.graph.graph_hash } : {}),
    },
    behavioral_evidence_status: behavioralEvidence,
    capabilities: { ...CAPABILITIES },
    diagnostics: publicDiagnostics(diagnostics),
  });
  return { exitCode, body };
}

export function runPath({
  repoRoot,
  source = DEFAULT_SOURCE_ROOT,
  from,
  to,
  host,
}) {
  if (!from || !to || !host) {
    const item = diagnostic({
      severity: 'error',
      code: 'SKG-USAGE',
      message: 'path requires --from <id> --to <id> --host <host>',
      location: 'argv',
      witness: { from: from ?? null, to: to ?? null, host: host ?? null },
      remediation: 'Pass --from, --to, and --host.',
      exitCode: EXIT_CODES.usage,
    });
    return {
      exitCode: EXIT_CODES.usage,
      body: envelopeBase('path', 'diagnostic', {
        ok: false,
        diagnostics: publicDiagnostics([item]),
      }),
    };
  }

  const hostError = assertKnownHost(host, { command: 'path' });
  if (hostError) {
    return {
      exitCode: EXIT_CODES.usage,
      body: envelopeBase('path', 'diagnostic', {
        ok: false,
        diagnostics: publicDiagnostics([hostError]),
      }),
    };
  }

  const built = buildAndValidateGraph({ repoRoot, sourceRoot: source });
  if (!built.graph || !built.ok) {
    const diagnostics = built.diagnostics.length
      ? built.diagnostics
      : [
          diagnostic({
            severity: 'error',
            code: 'SKG-QUERY-GRAPH-UNAVAILABLE',
            message: 'Cannot compute path because the authored graph failed validation.',
            location: built.source_root,
            witness: { source_root: built.source_root },
            remediation: 'Fix check diagnostics before querying paths.',
            exitCode: 4,
          }),
        ];
    const exitCode = selectExitCode(diagnostics);
    return {
      exitCode,
      body: envelopeBase('path', 'diagnostic', {
        ok: false,
        diagnostics: publicDiagnostics(diagnostics),
      }),
    };
  }

  const fromResolved = resolveEntityId(built.graph, from);
  const toResolved = resolveEntityId(built.graph, to);
  const diagnostics = [...fromResolved.diagnostics, ...toResolved.diagnostics];
  if (!fromResolved.ok || !toResolved.ok) {
    const exitCode = selectExitCode(diagnostics);
    return {
      exitCode,
      body: envelopeBase('path', 'diagnostic', {
        ok: false,
        diagnostics: publicDiagnostics(diagnostics),
      }),
    };
  }

  // Entry → point discovery: treat entry targets as zero-authored-hop fan-in seeds.
  let path;
  if (fromResolved.id.startsWith('entry:')) {
    const entry = built.graph.entries.find((item) => item.id === fromResolved.id);
    const targets = (entry?.surfaces ?? [])
      .filter((surface) => surface.host === host)
      .flatMap((surface) => surface.targets ?? [])
      .map((target) => target.point)
      .filter(Boolean);
    const uniqueTargets = [...new Set(targets)].sort(compareCodePoint);
    if (uniqueTargets.includes(toResolved.id)) {
      path = {
        reachable: true,
        hops: 1,
        nodes: [fromResolved.id, toResolved.id],
        edges: [
          {
            from: fromResolved.id,
            to: toResolved.id,
            edge_id: `edge:entry-pin.${fromResolved.id}.${toResolved.id}`,
            type: 'routes_to',
          },
        ],
        witness: {
          from: fromResolved.id,
          to: toResolved.id,
          host,
          plane: 'trigger+navigation',
          algorithm: 'entry-pin',
        },
      };
    } else {
      let best = null;
      for (const seed of uniqueTargets) {
        const candidate = shortestPath(built.graph, seed, toResolved.id);
        if (!candidate.reachable) continue;
        const hops = candidate.hops + 1;
        if (!best || hops < best.hops) {
          best = {
            reachable: true,
            hops,
            nodes: [fromResolved.id, ...candidate.nodes],
            edges: [
              {
                from: fromResolved.id,
                to: seed,
                edge_id: `edge:entry-pin.${fromResolved.id}.${seed}`,
                type: 'routes_to',
              },
              ...candidate.edges,
            ],
            witness: {
              from: fromResolved.id,
              to: toResolved.id,
              host,
              plane: 'trigger+navigation',
              algorithm: 'entry-pin+bfs',
              seed,
            },
          };
        }
      }
      path =
        best ??
        {
          reachable: false,
          hops: null,
          nodes: [],
          edges: [],
          witness: {
            from: fromResolved.id,
            to: toResolved.id,
            host,
            plane: 'trigger+navigation',
            seeds: uniqueTargets,
          },
        };
    }
  } else {
    path = shortestPath(built.graph, fromResolved.id, toResolved.id);
    path.witness = { ...path.witness, host };
  }

  if (!path.reachable) {
    const item = diagnostic({
      severity: 'error',
      code: 'SKG-PATH-UNREACHABLE',
      message: `No authored navigation path from ${fromResolved.id} to ${toResolved.id}`,
      location: 'navigation',
      witness: path.witness,
      remediation:
        'Add a typed navigation edge (or entry pin) that connects these nodes, then rerun path.',
      exitCode: EXIT_CODES.hop,
    });
    return {
      exitCode: EXIT_CODES.hop,
      body: envelopeBase('path', 'diagnostic', {
        ok: false,
        path_query: {
          from: fromResolved.id,
          to: toResolved.id,
          host,
          plane: 'navigation',
        },
        path_result: path,
        diagnostics: publicDiagnostics([item]),
      }),
    };
  }

  return {
    exitCode: 0,
    body: envelopeBase('path', 'path', {
      ok: true,
      source_root: built.source_root,
      graph_hash: built.graph.graph_hash,
      path_query: {
        from: fromResolved.id,
        to: toResolved.id,
        host,
        plane: 'navigation',
      },
      path_result: path,
      diagnostics: [],
    }),
  };
}

export function runExplain({ repoRoot, source = DEFAULT_SOURCE_ROOT, target }) {
  if (!target) {
    const item = diagnostic({
      severity: 'error',
      code: 'SKG-USAGE',
      message: 'explain requires <id-or-diagnostic-code>',
      location: 'argv',
      witness: { target: null },
      remediation: 'Pass an entity id or SKG-* diagnostic code.',
      exitCode: EXIT_CODES.usage,
    });
    return {
      exitCode: EXIT_CODES.usage,
      body: envelopeBase('explain', 'diagnostic', {
        ok: false,
        diagnostics: publicDiagnostics([item]),
      }),
    };
  }

  const built = buildAndValidateGraph({ repoRoot, sourceRoot: source });
  // Explicit SKG diagnostic codes remain explainable even when the graph is unhealthy.
  if (target.startsWith('SKG-')) {
    const matches = built.diagnostics.filter((item) => item.code === target);
    if (matches.length === 0) {
      const item = diagnostic({
        severity: 'error',
        code: 'SKG-QUERY-NOT-FOUND',
        message: `Diagnostic code not present in current graph check: ${target}`,
        location: 'argv',
        witness: { query: target },
        remediation: 'Run check/report first; explain only current diagnostics or entity ids.',
        exitCode: 4,
      });
      return {
        exitCode: 4,
        body: envelopeBase('explain', 'diagnostic', {
          ok: false,
          diagnostics: publicDiagnostics([item]),
        }),
      };
    }
    const primary = matches[0];
    return {
      exitCode: 0,
      body: envelopeBase('explain', 'explain', {
        ok: true,
        source_root: built.source_root,
        ...(built.graph?.graph_hash ? { graph_hash: built.graph.graph_hash } : {}),
        explain_target: target,
        entity: {
          id: primary.code,
          kind: 'diagnostic',
          witness: {
            matches: matches.map(outputDiagnostic),
          },
        },
        diagnostics: [],
      }),
    };
  }

  // Entity explain requires a healthy graph (built.ok), not merely a partial IR.
  if (!built.graph || !built.ok) {
    const diagnostics = built.diagnostics.length
      ? built.diagnostics
      : [
          diagnostic({
            severity: 'error',
            code: 'SKG-QUERY-GRAPH-UNAVAILABLE',
            message: 'Cannot explain entity because the authored graph failed validation.',
            location: built.source_root,
            witness: { source_root: built.source_root, built_ok: built.ok },
            remediation:
              'Fix check diagnostics first, or explain an explicit SKG-* diagnostic code.',
            exitCode: 4,
          }),
        ];
    return {
      exitCode: selectExitCode(diagnostics),
      body: envelopeBase('explain', 'diagnostic', {
        ok: false,
        diagnostics: publicDiagnostics(diagnostics),
      }),
    };
  }

  const resolved = resolveEntityId(built.graph, target);
  if (!resolved.ok) {
    return {
      exitCode: selectExitCode(resolved.diagnostics),
      body: envelopeBase('explain', 'diagnostic', {
        ok: false,
        diagnostics: publicDiagnostics(resolved.diagnostics),
      }),
    };
  }

  const id = resolved.id;
  let entity;
  if (built.graph.portfolio?.id === id) {
    entity = {
      id,
      kind: 'portfolio',
      witness: { rollout: built.graph.portfolio.rollout },
    };
  } else if (built.graph.skills.some((item) => item.id === id)) {
    const skill = built.graph.skills.find((item) => item.id === id);
    entity = {
      id,
      kind: 'skill',
      recognition_cues: [],
      witness: {
        modules: skill.modules.map((item) => item.id).sort(compareCodePoint),
        inventory_count: skill.canonical_source_inventory.length,
      },
    };
  } else if (built.graph.modules.some((item) => item.id === id)) {
    const module = built.graph.modules.find((item) => item.id === id);
    entity = {
      id,
      kind: 'module',
      owner_skill: module.owner_skill,
      recognition_cues: [...(module.recognition_cues ?? [])],
      access: module.access,
      witness: {
        points: module.points.map((item) => item.id).sort(compareCodePoint),
        edges: module.edges.map((item) => item.id).sort(compareCodePoint),
      },
    };
  } else if (built.graph.points.some((item) => item.id === id)) {
    const point = built.graph.points.find((item) => item.id === id);
    const inbound = built.graph.edges
      .filter((edge) => edge.to === id)
      .map((edge) => edge.id)
      .sort(compareCodePoint);
    const outbound = built.graph.edges
      .filter((edge) => edge.from === id)
      .map((edge) => edge.id)
      .sort(compareCodePoint);
    entity = {
      id,
      kind: 'point',
      owner_skill: point.owner_skill,
      module: point.module_id,
      authority: point.authority,
      binding: point.binding,
      recognition_cues: [...(point.recognition_cues ?? [])],
      inbound,
      outbound,
      witness: {
        span_sha256: built.graph.span_hashes[id] ?? null,
      },
    };
  } else if (built.graph.edges.some((item) => item.id === id)) {
    const edge = built.graph.edges.find((item) => item.id === id);
    entity = {
      id,
      kind: 'edge',
      module: edge.module_id,
      witness: {
        type: edge.type,
        from: edge.from,
        to: edge.to,
        when: edge.when,
      },
    };
  } else if (built.graph.entries.some((item) => item.id === id)) {
    const entry = built.graph.entries.find((item) => item.id === id);
    entity = {
      id,
      kind: 'entry',
      recognition_cues: [...(entry.recognition_cues ?? [])],
      witness: {
        surfaces: entry.surfaces.map((surface) => ({
          host: surface.host,
          source_file: surface.source_file,
          targets: surface.targets,
        })),
      },
    };
  }

  return {
    exitCode: 0,
    body: envelopeBase('explain', 'explain', {
      ok: true,
      source_root: built.source_root,
      graph_hash: built.graph.graph_hash,
      explain_target: target,
      entity,
      diagnostics: [],
    }),
  };
}
