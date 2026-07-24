/**
 * Semantic hard gate for change validation.json envelopes.
 * Complements JSON Schema: shared hash, host set/order, candidate_valid
 * bidirectional consistency, and forbids full/partial witnesses from pretending
 * abstention pass or claiming ok without real H1–H4 execution.
 * Success full/partial also require enabled_edges ↔ snapshot edge-id/edge/adjacency
 * count-and-set equivalence (schema only checks shape).
 */
import { PRODUCT_HOSTS } from './compile/paths.mjs';
import { EXIT_CODES } from './contracts.mjs';
import { diagnostic } from './diagnostics.mjs';

function envelopeDiagnostic(code, message, witness, remediation) {
  return diagnostic({
    severity: 'error',
    code,
    message,
    location: 'validation.json',
    witness,
    remediation,
    exitCode: EXIT_CODES.source_contract,
  });
}

function hopUsesFalseAbstention(gate) {
  return gate?.ok === true && gate?.witness?.abstained === true;
}

function hopTrulyExecuted(gate) {
  return (
    gate &&
    gate.ok === true &&
    gate.witness?.abstained !== true &&
    gate.witness?.skipped !== true
  );
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

/**
 * Bidirectional count+set consistency for success full/partial snapshots.
 * JSON Schema only guards shape; this gate owns the semantic sets.
 */
function validateSnapshotEdgeSetConsistency(witness, diagnostics) {
  const snap = witness.final_surface_snapshot;
  if (!snap || typeof snap !== 'object') return;

  const edgeIds = Array.isArray(snap.enabled_edge_ids) ? snap.enabled_edge_ids : null;
  const edges = Array.isArray(snap.edges) ? snap.edges : null;
  const adjacency =
    snap.enabled_adjacency && typeof snap.enabled_adjacency === 'object'
      ? snap.enabled_adjacency
      : null;

  if (!edgeIds || !edges || !adjacency) {
    diagnostics.push(
      envelopeDiagnostic(
        'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
        `Host ${witness.host} snapshot edge fields must be present arrays/object for set consistency`,
        {
          host: witness.host,
          enabled_edge_ids: snap.enabled_edge_ids ?? null,
          edges: snap.edges ?? null,
          enabled_adjacency: snap.enabled_adjacency ?? null,
        },
        'Emit enabled_edge_ids, edges, and enabled_adjacency together on success snapshots.',
      ),
    );
    return;
  }

  const adjRows = [];
  for (const [from, rows] of Object.entries(adjacency)) {
    if (!Array.isArray(rows)) {
      diagnostics.push(
        envelopeDiagnostic(
          'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
          `Host ${witness.host} enabled_adjacency[${from}] must be an array`,
          { host: witness.host, from, rows },
          'Keep adjacency values as arrays of {to, edge_id}.',
        ),
      );
      return;
    }
    for (const row of rows) {
      adjRows.push({
        from,
        to: row?.to ?? null,
        edge_id: row?.edge_id ?? null,
      });
    }
  }

  const idList = edgeIds.map((id) => String(id));
  const edgeObjIds = edges.map((edge) => edge?.id ?? null);
  const adjIds = adjRows.map((row) => row.edge_id);

  if (idList.length !== new Set(idList).size) {
    diagnostics.push(
      envelopeDiagnostic(
        'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
        `Host ${witness.host} enabled_edge_ids must be unique`,
        { host: witness.host, enabled_edge_ids: idList },
        'Deduplicate enabled_edge_ids; each enabled edge id appears once.',
      ),
    );
  }
  if (edgeObjIds.length !== new Set(edgeObjIds.filter(Boolean)).size) {
    diagnostics.push(
      envelopeDiagnostic(
        'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
        `Host ${witness.host} snapshot.edges ids must be unique`,
        { host: witness.host, edge_ids: edgeObjIds },
        'Emit each edge object once; duplicate edge ids are forged.',
      ),
    );
  }

  const countWitness = witness.enabled_edges;
  const countIds = idList.length;
  const countEdges = edges.length;
  const countAdj = adjRows.length;
  if (countWitness !== countIds || countIds !== countEdges || countEdges !== countAdj) {
    diagnostics.push(
      envelopeDiagnostic(
        'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
        `Host ${witness.host} enabled_edges / enabled_edge_ids / edges / enabled_adjacency counts must match`,
        {
          host: witness.host,
          enabled_edges: countWitness,
          enabled_edge_ids_count: countIds,
          edges_count: countEdges,
          enabled_adjacency_count: countAdj,
        },
        'Keep the four edge projections count-equivalent on success full/partial witnesses.',
      ),
    );
  }

  const idSet = new Set(idList);
  const edgeIdSet = new Set(edgeObjIds.filter((id) => typeof id === 'string'));
  const adjIdSet = new Set(adjIds.filter((id) => typeof id === 'string'));
  if (!setsEqual(idSet, edgeIdSet) || !setsEqual(idSet, adjIdSet)) {
    diagnostics.push(
      envelopeDiagnostic(
        'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
        `Host ${witness.host} edge id sets must be bidirectional across ids/edges/adjacency`,
        {
          host: witness.host,
          enabled_edge_ids: sortedUnique(idList),
          edges_ids: sortedUnique(edgeObjIds.filter(Boolean)),
          adjacency_ids: sortedUnique(adjIds.filter(Boolean)),
        },
        'Every enabled_edge_id must appear as an edges[].id and an adjacency edge_id, and vice versa.',
      ),
    );
  }

  for (const edge of edges) {
    if (
      !edge ||
      typeof edge.id !== 'string' ||
      typeof edge.from !== 'string' ||
      typeof edge.to !== 'string'
    ) {
      diagnostics.push(
        envelopeDiagnostic(
          'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
          `Host ${witness.host} snapshot edge objects require id/from/to strings`,
          { host: witness.host, edge },
          'Emit complete {id,from,to} edge objects.',
        ),
      );
      continue;
    }
    const rows = adjacency[edge.from] ?? [];
    const matched = Array.isArray(rows)
      ? rows.some((row) => row?.to === edge.to && row?.edge_id === edge.id)
      : false;
    if (!matched) {
      diagnostics.push(
        envelopeDiagnostic(
          'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
          `Host ${witness.host} edge ${edge.id} missing matching enabled_adjacency entry`,
          { host: witness.host, edge, adjacency_from: rows },
          'Adjacency must include {to, edge_id} for every edges[] row under edges[].from.',
        ),
      );
    }
  }

  for (const row of adjRows) {
    const matched = edges.some(
      (edge) =>
        edge?.id === row.edge_id && edge?.from === row.from && edge?.to === row.to,
    );
    if (!matched) {
      diagnostics.push(
        envelopeDiagnostic(
          'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
          `Host ${witness.host} adjacency entry has no matching edges[] object`,
          { host: witness.host, adjacency_entry: row },
          'Do not forge adjacency rows without a corresponding edges[] {id,from,to}.',
        ),
      );
    }
  }
}

/**
 * @param {object} validation
 * @param {{ sourceErrorCount?: number, runtimeValid?: boolean }} [context]
 * @returns {object[]} diagnostics
 */
export function validateChangeValidationSemantics(validation, context = {}) {
  const diagnostics = [];
  if (!validation || typeof validation !== 'object') {
    diagnostics.push(
      envelopeDiagnostic(
        'SKG-CHANGE-VALIDATION-ENVELOPE',
        'validation envelope is missing or not an object',
        { validation: validation ?? null },
        'Emit a change_validation document before writing validation.json.',
      ),
    );
    return diagnostics;
  }

  const witnesses = validation.host_projection_witnesses;
  if (!Array.isArray(witnesses) || witnesses.length !== PRODUCT_HOSTS.length) {
    diagnostics.push(
      envelopeDiagnostic(
        'SKG-CHANGE-VALIDATION-HOST-SET',
        'host_projection_witnesses must contain exactly the four product hosts',
        { length: Array.isArray(witnesses) ? witnesses.length : null, expected: PRODUCT_HOSTS },
        'Emit one witness per host in frozen C9 order.',
      ),
    );
    return diagnostics;
  }

  const hosts = witnesses.map((item) => item?.host);
  if (hosts.join('\0') !== PRODUCT_HOSTS.join('\0')) {
    diagnostics.push(
      envelopeDiagnostic(
        'SKG-CHANGE-VALIDATION-HOST-ORDER',
        'host_projection_witnesses hosts must be unique and exactly ordered',
        { actual: hosts, expected: [...PRODUCT_HOSTS] },
        'Keep host order claude-code, codex, cursor, kimi-code with no duplicates.',
      ),
    );
  }

  const topHash = validation.result_graph_sha256;
  for (const witness of witnesses) {
    if (!witness || typeof witness !== 'object') continue;
    if (witness.result_graph_sha256 !== topHash) {
      diagnostics.push(
        envelopeDiagnostic(
          'SKG-CHANGE-VALIDATION-HASH-MISMATCH',
          `Witness result_graph_sha256 for ${witness.host} must equal top-level result_graph_sha256`,
          {
            host: witness.host,
            witness_hash: witness.result_graph_sha256 ?? null,
            top_hash: topHash ?? null,
          },
          'Copy the shared candidate graph hash onto every host witness.',
        ),
      );
    }

    if (witness.mode === 'full' || witness.mode === 'partial') {
      if (witness.conditional_route_policy === 'abstained') {
        diagnostics.push(
          envelopeDiagnostic(
            'SKG-CHANGE-VALIDATION-MODE-POLICY',
            `Host ${witness.host} mode ${witness.mode} must not use abstained conditional_route_policy`,
            { host: witness.host, mode: witness.mode, policy: witness.conditional_route_policy },
            'Use enabled_by_default-only for full/partial; reserve abstained for stub/unsupported.',
          ),
        );
      }
      for (const gate of ['H1', 'H2', 'H3', 'H4']) {
        if (hopUsesFalseAbstention(witness.hop_report?.[gate])) {
          diagnostics.push(
            envelopeDiagnostic(
              'SKG-CHANGE-VALIDATION-FALSE-ABSTENTION',
              `Host ${witness.host} ${gate} must not claim abstained pass under mode ${witness.mode}`,
              {
                host: witness.host,
                mode: witness.mode,
                gate,
                witness: witness.hop_report?.[gate]?.witness ?? null,
              },
              'Use skipped:true with ok:false for unexecuted gates, or real hop results; never abstain-pass a covered host.',
            ),
          );
        }
      }

      if (witness.ok === true) {
        for (const gate of ['H1', 'H2', 'H3', 'H4']) {
          if (!hopTrulyExecuted(witness.hop_report?.[gate])) {
            diagnostics.push(
              envelopeDiagnostic(
                'SKG-CHANGE-VALIDATION-HOP-NOT-EXECUTED',
                `Host ${witness.host} ok:true requires real executed ${gate}`,
                {
                  host: witness.host,
                  mode: witness.mode,
                  gate,
                  hop: witness.hop_report?.[gate] ?? null,
                },
                'full/partial ok:true witnesses must run H1–H4 for real (not skipped/abstained).',
              ),
            );
          }
        }
        const checks = witness.executed_checks ?? [];
        if (
          !checks.includes('candidate_runtime_sync') ||
          !checks.includes('candidate_runtime_verify')
        ) {
          diagnostics.push(
            envelopeDiagnostic(
              'SKG-CHANGE-VALIDATION-EXECUTED-CHECKS',
              `Host ${witness.host} ok:true must record both candidate_runtime_sync and candidate_runtime_verify`,
              { host: witness.host, executed_checks: checks },
              'Record candidate_runtime_sync and candidate_runtime_verify when gates truly ran.',
            ),
          );
        }
        if (
          !witness.budgets ||
          typeof witness.budgets !== 'object' ||
          Object.keys(witness.budgets).length === 0
        ) {
          diagnostics.push(
            envelopeDiagnostic(
              'SKG-CHANGE-VALIDATION-BUDGETS',
              `Host ${witness.host} ok:true must include non-empty budgets object`,
              { host: witness.host, budgets: witness.budgets ?? null },
              'Emit router/hop budgets for covered hosts that passed.',
            ),
          );
        }
        const snap = witness.final_surface_snapshot;
        if (!snap || typeof snap !== 'object') {
          diagnostics.push(
            envelopeDiagnostic(
              'SKG-CHANGE-VALIDATION-SNAPSHOT-REQUIRED',
              `Host ${witness.host} ok:true full/partial must include final_surface_snapshot`,
              { host: witness.host, mode: witness.mode },
              'Capture final_surface_snapshot from reparsed final host surface before cleanup.',
            ),
          );
        } else {
          if (snap.host !== witness.host) {
            diagnostics.push(
              envelopeDiagnostic(
                'SKG-CHANGE-VALIDATION-SNAPSHOT-HOST',
                `final_surface_snapshot.host must equal witness.host for ${witness.host}`,
                { host: witness.host, snapshot_host: snap.host ?? null },
                'Keep snapshot host aligned with the witness host.',
              ),
            );
          }
          if (snap.mode !== witness.mode) {
            diagnostics.push(
              envelopeDiagnostic(
                'SKG-CHANGE-VALIDATION-SNAPSHOT-MODE',
                `final_surface_snapshot.mode must equal witness.mode for ${witness.host}`,
                { host: witness.host, mode: witness.mode, snapshot_mode: snap.mode ?? null },
                'Keep snapshot mode aligned with the witness mode.',
              ),
            );
          }
          if (!Array.isArray(snap.fileset) || snap.fileset.length === 0) {
            diagnostics.push(
              envelopeDiagnostic(
                'SKG-CHANGE-VALIDATION-SNAPSHOT-FILESET',
                `final_surface_snapshot.fileset must be a non-empty path/kind/bytes/sha256 inventory for ${witness.host}`,
                { host: witness.host, fileset: snap.fileset ?? null },
                'Walk the final host tree and record digests for every path.',
              ),
            );
          }
          validateSnapshotEdgeSetConsistency(witness, diagnostics);
        }
      } else if (witness.final_surface_snapshot) {
        diagnostics.push(
          envelopeDiagnostic(
            'SKG-CHANGE-VALIDATION-SNAPSHOT-FORBIDDEN',
            `Host ${witness.host} failed full/partial witness must not carry final_surface_snapshot`,
            { host: witness.host, mode: witness.mode, ok: witness.ok },
            'Omit snapshot on failed covered hosts; only successful full/partial may publish one.',
          ),
        );
      }
    }

    if (witness.mode === 'stub' || witness.mode === 'unsupported') {
      if (witness.final_surface_snapshot) {
        diagnostics.push(
          envelopeDiagnostic(
            'SKG-CHANGE-VALIDATION-SNAPSHOT-FORBIDDEN',
            `Host ${witness.host} stub/unsupported must not carry final_surface_snapshot`,
            { host: witness.host, mode: witness.mode },
            'Omit snapshot on abstaining hosts.',
          ),
        );
      }
      if (
        (witness.artifacts?.length ?? 0) > 0 ||
        (witness.enabled_edges ?? 0) !== 0 ||
        (witness.point_anchors ?? 0) !== 0
      ) {
        diagnostics.push(
          envelopeDiagnostic(
            'SKG-CHANGE-VALIDATION-STUB-SURFACE',
            `Host ${witness.host} stub/unsupported witness must claim zero surfaces`,
            {
              host: witness.host,
              mode: witness.mode,
              artifacts: witness.artifacts?.length ?? 0,
              enabled_edges: witness.enabled_edges ?? null,
              point_anchors: witness.point_anchors ?? null,
            },
            'Abstain with zero artifacts/anchors/edges for stub/unsupported hosts.',
          ),
        );
      }
      if (witness.ok === true) {
        for (const gate of ['H1', 'H2', 'H3', 'H4']) {
          if (witness.hop_report?.[gate]?.witness?.abstained !== true) {
            diagnostics.push(
              envelopeDiagnostic(
                'SKG-CHANGE-VALIDATION-STUB-ABSTENTION',
                `Host ${witness.host} stub/unsupported must abstain H1–H4`,
                { host: witness.host, gate, hop: witness.hop_report?.[gate] ?? null },
                'Stub/unsupported hosts may only report abstained hop gates.',
              ),
            );
          }
        }
      }
    }
  }

  const runtimeOk = Boolean(validation.candidate_runtime_valid);
  const witnessesOk = witnesses.every((item) => item?.ok === true);
  const noErrorDiagnostics = !(validation.diagnostics ?? []).some(
    (item) => item?.severity === 'error',
  );
  const optimisticOk = validation.optimistic_lock_valid !== false;
  const gitApplyOk = validation.git_apply_check !== false;
  const expectedCandidateValid =
    runtimeOk && witnessesOk && noErrorDiagnostics && optimisticOk && gitApplyOk;

  if (context.runtimeValid !== undefined && context.runtimeValid !== runtimeOk) {
    diagnostics.push(
      envelopeDiagnostic(
        'SKG-CHANGE-VALIDATION-RUNTIME-FLAG',
        'candidate_runtime_valid does not match runtime gate result',
        { candidate_runtime_valid: runtimeOk, runtime_gate: context.runtimeValid },
        'Set candidate_runtime_valid from the four-host runtime gate boolean.',
      ),
    );
  }

  // Bidirectional equivalence: reject false green AND reject internal-all-green
  // with top-level candidate_valid false.
  if (Boolean(validation.candidate_valid) !== expectedCandidateValid) {
    diagnostics.push(
      envelopeDiagnostic(
        'SKG-CHANGE-VALIDATION-CANDIDATE-FLAG',
        validation.candidate_valid
          ? 'candidate_valid true is inconsistent with runtime/witness/diagnostics/locks'
          : 'candidate_valid false is inconsistent with all-green runtime/witness/diagnostics/locks',
        {
          candidate_valid: validation.candidate_valid,
          expected_candidate_valid: expectedCandidateValid,
          candidate_runtime_valid: runtimeOk,
          witnesses_ok: witnessesOk,
          optimistic_lock_valid: validation.optimistic_lock_valid ?? null,
          git_apply_check: validation.git_apply_check ?? null,
          diagnostics_error_count: (validation.diagnostics ?? []).filter(
            (item) => item?.severity === 'error',
          ).length,
        },
        'Keep candidate_valid exactly equivalent to runtime ∧ witnesses ∧ diagnostics ∧ locks.',
      ),
    );
  }

  return diagnostics;
}
