import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHANGE_SCHEMA_VERSION,
  DEFAULT_SOURCE_ROOT,
  EXIT_CODES,
  OPERATIONS,
} from './contracts.mjs';
import { diagnostic, selectExitCode } from './diagnostics.mjs';
import { canonicalGraphHash, hashMarkdownSpan, sha256Hex } from './hash.mjs';
import { attestInventoryEntry } from './inventory.mjs';
import { extractMarkers } from './markers.mjs';
import { validateAuthoredDocument, validatorsAvailable } from './schema.mjs';

const WORKSPACE_ROOT = '.skill-knowledge/workspaces';
const ZERO_HASH = '0'.repeat(64);
const SOURCE_KINDS = new Set(['portfolio', 'skill', 'module']);

function txDiagnostic(code, message, location, witness, remediation, exitCode = EXIT_CODES.semantic_invariant) {
  return diagnostic({ severity: 'error', code, message, location, witness, remediation, exitCode });
}

export function publicTransactionResult(action, result, repoRoot) {
  return {
    schema: 'cc-master/skill-knowledge-cli/v1alpha1',
    ok: result.exitCode === 0,
    command: 'change',
    result_kind: 'change',
    contract_version: 'v1alpha1',
    action,
    ...(result.workspace ? { workspace: relativePath(repoRoot, result.workspace) } : {}),
    ...(result.ledgerPath ? { ledger_path: relativePath(repoRoot, result.ledgerPath) } : {}),
    ...(result.validation ? { validation: result.validation } : {}),
    ...(result.change ? { result_graph_sha256: result.change.result_graph_sha256 } : {}),
    diagnostics: (result.diagnostics ?? []).map(({ exit_code, ...item }) => item),
  };
}

function normalized(pathname) {
  return pathname.split(path.sep).join('/');
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function relativePath(repoRoot, target) {
  return normalized(path.relative(repoRoot, target));
}

function safeScopePath(repoRoot, value) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) return null;
  const absolute = path.resolve(repoRoot, value);
  if (!inside(repoRoot, absolute)) return null;
  return { absolute, relative: relativePath(repoRoot, absolute) };
}

function readJson(file, diagnostics) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    diagnostics.push(txDiagnostic('SKG-CHANGE-JSON-PARSE', 'Transaction JSON is invalid.', normalized(file), { error: error.message }, 'Repair the JSON document before validating the change.', EXIT_CODES.source_contract));
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function git(repoRoot, args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

function resolveBase(repoRoot, base) {
  const result = git(repoRoot, ['rev-parse', '--verify', `${base}^{commit}`]);
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function allFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && predicate(target)) found.push(target);
    }
  };
  visit(root);
  return found;
}

function acceptedOrCandidatePath(repoRoot, workspace, scopeSet, relative) {
  if (scopeSet.has(relative)) return path.join(workspace, 'candidate', relative);
  return path.join(repoRoot, relative);
}

function loadGraph({ repoRoot, sourceRoot = DEFAULT_SOURCE_ROOT, workspace, scope = [] }) {
  const diagnostics = [];
  const sourceAbsolute = path.resolve(repoRoot, sourceRoot);
  const scopeSet = new Set(scope.map((item) => item.path));
  const files = allFiles(sourceAbsolute, (file) => file.endsWith('.json'));
  const documents = [];
  const documentByPath = new Map();
  for (const acceptedFile of files) {
    const relative = relativePath(repoRoot, acceptedFile);
    const file = acceptedOrCandidatePath(repoRoot, workspace, scopeSet, relative);
    if (!fs.existsSync(file)) {
      diagnostics.push(txDiagnostic('SKG-CHANGE-CANDIDATE-MISSING', 'Candidate scope file is missing.', relative, { path: relative }, 'Restore the exact candidate file or begin a new transaction.', EXIT_CODES.drift));
      continue;
    }
    const data = readJson(file, diagnostics);
    if (!data) continue;
    if (!SOURCE_KINDS.has(data.kind) && data.kind !== 'change') continue;
    if (data.kind !== 'change' && validatorsAvailable()) {
      const validation = validateAuthoredDocument(data, 'source');
      if (!validation.ok) diagnostics.push(txDiagnostic('SKG-SCHEMA-INVALID', 'Candidate manifest fails the committed source schema.', relative, { errors: validation.errors.slice(0, 8) }, 'Repair the candidate manifest against knowledge-source.schema.json.', EXIT_CODES.source_contract));
    }
    const entry = { path: relative, data };
    documents.push(entry);
    documentByPath.set(relative, entry);
  }

  const manifests = documents.filter(({ data }) => SOURCE_KINDS.has(data.kind));
  const portfolio = manifests.find(({ data }) => data.kind === 'portfolio')?.data ?? null;
  const skills = manifests.filter(({ data }) => data.kind === 'skill');
  const modules = manifests.filter(({ data }) => data.kind === 'module');
  const changes = documents.filter(({ data }) => data.kind === 'change');
  const points = new Map();
  const edges = new Map();
  const modulesById = new Map();
  const skillsById = new Map();
  const identities = new Map();
  const register = (id, value) => {
    if (!id) return;
    const current = identities.get(id) ?? [];
    current.push(value);
    identities.set(id, current);
  };
  if (portfolio) {
    register(portfolio.id, { kind: 'portfolio', data: portfolio, path: manifests.find(({ data }) => data === portfolio)?.path });
    for (const entry of portfolio.entries ?? []) register(entry.id, { kind: 'entry', data: entry, path: 'portfolio.entries' });
  }
  for (const item of skills) {
    skillsById.set(item.data.id, item);
    register(item.data.id, { kind: 'skill', ...item });
  }
  for (const item of modules) {
    modulesById.set(item.data.id, item);
    register(item.data.id, { kind: 'module', ...item });
    for (const point of item.data.points ?? []) {
      points.set(point.id, { point, module: item, path: item.path });
      register(point.id, { kind: 'point', data: point, module: item, path: item.path });
    }
    for (const edge of item.data.edges ?? []) {
      edges.set(edge.id, { edge, module: item, path: item.path });
      register(edge.id, { kind: 'edge', data: edge, module: item, path: item.path });
    }
  }
  return { diagnostics, sourceAbsolute, documents, manifests, portfolio, skills, modules, changes, points, edges, modulesById, skillsById, identities, documentByPath };
}

function active(node) {
  return node?.lifecycle?.state === 'accepted';
}

function spanData(graph, repoRoot, workspace, scope) {
  const diagnostics = [];
  const spans = new Map();
  const files = new Map();
  for (const { point, path: manifestPath } of graph.points.values()) {
    if (!active(point)) continue;
    const binding = point.binding;
    const target = acceptedOrCandidatePath(repoRoot, workspace, new Set(scope.map((item) => item.path)), binding.path);
    if (!fs.existsSync(target)) {
      diagnostics.push(txDiagnostic('SKG-BINDING-MISSING-FILE', 'Active point binding Markdown file is missing.', binding.path, { point_id: point.id, manifest: manifestPath }, 'Include the Markdown file in the transaction scope or repair the binding.', EXIT_CODES.source_contract));
      continue;
    }
    if (!files.has(binding.path)) {
      const extracted = extractMarkers(fs.readFileSync(target, 'utf8'), binding.path);
      diagnostics.push(...extracted.diagnostics);
      files.set(binding.path, extracted);
    }
    const extracted = files.get(binding.path);
    const span = extracted.spans?.find((item) => item.point_id === binding.marker);
    if (!span) {
      diagnostics.push(txDiagnostic('SKG-BINDING-MARKER-MISSING', 'Active point has no matching Markdown marker span.', binding.path, { point_id: point.id, marker: binding.marker }, 'Add the exact marker pair to the candidate Markdown or correct the binding.', EXIT_CODES.source_contract));
      continue;
    }
    spans.set(point.id, { ...span, path: binding.path, sha256: hashMarkdownSpan(span.content) });
  }
  return { diagnostics, spans, files };
}

function validateGraph(graph, repoRoot, workspace, scope) {
  const diagnostics = [...graph.diagnostics];
  for (const [id, entries] of graph.identities) {
    if (entries.length > 1) diagnostics.push(txDiagnostic('SKG-ID-DUPLICATE', 'Knowledge identity is declared more than once.', entries[0].path, { id, locations: entries.map((item) => item.path) }, 'Keep exactly one declaration for each identity.'));
  }
  for (const module of graph.modules) {
    const owner = graph.skillsById.get(module.data.owner_skill);
    const referenced = owner?.data.modules?.filter((ref) => ref.id === module.data.id) ?? [];
    if (!owner || referenced.length !== 1) diagnostics.push(txDiagnostic('SKG-MEMBERSHIP-INVALID', 'Module must belong to exactly one declared owner skill.', module.path, { module: module.data.id, owner_skill: module.data.owner_skill, references: referenced.length }, 'Synchronize module.owner_skill with exactly one skill.modules entry.'));
  }
  for (const skill of graph.skills) {
    for (const reference of skill.data.modules ?? []) {
      const module = graph.modulesById.get(reference.id);
      if (!module || module.data.owner_skill !== skill.data.id) diagnostics.push(txDiagnostic('SKG-MEMBERSHIP-INVALID', 'Skill module reference does not resolve to a module owned by the skill.', skill.path, { skill: skill.data.id, module: reference.id }, 'Repair both skill.modules and module.owner_skill.'));
    }
  }
  const bindings = spanData(graph, repoRoot, workspace, scope);
  diagnostics.push(...bindings.diagnostics);
  const canonicalBySubject = new Map();
  for (const { point, path: manifestPath } of graph.points.values()) {
    if (!active(point)) continue;
    if (!bindings.spans.has(point.id)) continue;
    const authority = point.authority ?? {};
    if (authority.role === 'canonical') {
      const existing = canonicalBySubject.get(authority.subject) ?? [];
      existing.push(point.id); canonicalBySubject.set(authority.subject, existing);
    } else {
      const canonical = graph.points.get(authority.canonical)?.point;
      if (!canonical || !active(canonical) || canonical.authority?.role !== 'canonical' || canonical.authority.subject !== authority.subject) diagnostics.push(txDiagnostic('SKG-AUTHORITY-INVALID', 'Derived authority must directly reference the active canonical point for the same subject.', manifestPath, { point_id: point.id, canonical: authority.canonical ?? null, subject: authority.subject ?? null }, 'Point the summary/example directly at its active canonical point.'));
      if (authority.review_policy === 'review-on-canonical-change' && canonical) {
        const canonicalSpan = bindings.spans.get(canonical.id);
        if (canonicalSpan && authority.reviewed_canonical_sha256 !== canonicalSpan.sha256) diagnostics.push(txDiagnostic('SKG-AUTHORITY-STALE', 'Derived authority review hash does not match its canonical span.', manifestPath, { point_id: point.id, expected: authority.reviewed_canonical_sha256, actual: canonicalSpan.sha256 }, 'Review the derived point and update reviewed_canonical_sha256.'));
      }
    }
    if (!point.admission?.evidence?.length || !point.admission?.verifiers?.length) diagnostics.push(txDiagnostic('SKG-ADMISSION-MISSING', 'Active point lacks required evidence or verifier.', manifestPath, { point_id: point.id }, 'Add non-empty admission evidence and verifiers.'));
  }
  for (const [subject, pointIds] of canonicalBySubject) if (pointIds.length !== 1) diagnostics.push(txDiagnostic('SKG-AUTHORITY-CANONICAL-COUNT', 'Each active subject must have exactly one canonical point.', 'authority', { subject, point_ids: pointIds }, 'Retire duplicates or assign derived authority.'));
  for (const { edge, path: manifestPath } of graph.edges.values()) {
    if (!active(edge)) continue;
    if (!graph.identities.has(edge.from) || !graph.identities.has(edge.to)) diagnostics.push(txDiagnostic('SKG-EDGE-ENDPOINT-UNKNOWN', 'Active edge endpoint does not resolve to a known identity.', manifestPath, { edge_id: edge.id, from: edge.from, to: edge.to }, 'Retarget or remove the dangling edge.'));
    if (!edge.admission?.evidence?.length || !edge.admission?.verifiers?.length) diagnostics.push(txDiagnostic('SKG-ADMISSION-MISSING', 'Active edge lacks required evidence or verifier.', manifestPath, { edge_id: edge.id }, 'Add non-empty admission evidence and verifiers.'));
  }
  for (const skill of graph.skills) {
    if (!active(skill.data)) continue;
    if (!skill.data.admission?.evidence?.length || !skill.data.admission?.verifiers?.length) diagnostics.push(txDiagnostic('SKG-ADMISSION-MISSING', 'Accepted skill lacks admission evidence or verifier.', skill.path, { skill: skill.data.id }, 'Restore the skill admission evidence and verifier.'));
    for (const entry of skill.data.canonical_source_inventory ?? []) {
      if (entry.coverage === 'non_knowledge' || entry.coverage === 'excluded') continue;
      const extracted = bindings.files.get(entry.path);
      const file = acceptedOrCandidatePath(repoRoot, workspace, new Set(scope.map((item) => item.path)), entry.path);
      if (!fs.existsSync(file)) continue;
      const markerResult = extracted ?? extractMarkers(fs.readFileSync(file, 'utf8'), entry.path);
      if (!markerResult.ok) continue;
      const attestation = attestInventoryEntry(entry, fs.readFileSync(file, 'utf8'), markerResult.spans);
      diagnostics.push(...attestation.diagnostics);
    }
  }
  return { diagnostics, bindings };
}

function latestLedger(graph, diagnostics) {
  const changes = graph.changes.map((item) => item.data);
  if (changes.length === 0) return null;
  const byId = new Map(changes.map((change) => [change.change_id, change]));
  const children = new Set(changes.filter((change) => change.parent_change).map((change) => change.parent_change.change_id));
  const heads = changes.filter((change) => !children.has(change.change_id));
  if (heads.length !== 1) {
    diagnostics.push(txDiagnostic('SKG-LEDGER-CHAIN-INVALID', 'Immutable ledger must have exactly one head.', 'plugin/src/knowledge/changes', { heads: heads.map((item) => item.change_id) }, 'Repair the ledger parent chain before starting another transaction.'));
    return null;
  }
  let cursor = heads[0]; const seen = new Set();
  while (cursor) {
    if (seen.has(cursor.change_id)) { diagnostics.push(txDiagnostic('SKG-LEDGER-CHAIN-INVALID', 'Immutable ledger parent chain contains a cycle.', 'plugin/src/knowledge/changes', { change_id: cursor.change_id }, 'Repair the parent_change link.')); break; }
    seen.add(cursor.change_id);
    if (!cursor.parent_change) break;
    const parent = byId.get(cursor.parent_change.change_id);
    if (!parent || parent.result_graph_sha256 !== cursor.parent_change.result_graph_sha256) {
      diagnostics.push(txDiagnostic('SKG-LEDGER-CHAIN-INVALID', 'Ledger parent link does not match an existing finalized record.', 'plugin/src/knowledge/changes', { change_id: cursor.change_id, parent_change: cursor.parent_change }, 'Repair the immutable parent link.')); break;
    }
    cursor = parent;
  }
  return heads[0];
}

function graphHash(graph, bindings, changeHead) {
  return canonicalGraphHash({
    manifests: graph.manifests.map((item) => item.data),
    span_hashes: Object.fromEntries([...bindings.spans].map(([id, span]) => [id, span.sha256])),
    inventory: graph.skills.flatMap((skill) => skill.data.canonical_source_inventory ?? []),
    change_head: changeHead,
  });
}

// K-I14: compare the authored graph as semantic identities and relations, not
// merely as files.  Container lists are represented by the identities they
// contain (and by point/edge placement), so formatting and JSON key order do
// not create a transaction delta while a changed owner, authority, lifecycle,
// binding, edge, or Markdown span always does.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function semanticEntity(kind, data) {
  const clone = structuredClone(data);
  if (kind === 'portfolio') { delete clone.skills; delete clone.entries; }
  if (kind === 'skill') delete clone.modules;
  if (kind === 'module') { delete clone.points; delete clone.edges; }
  return clone;
}

function semanticSnapshot(graph, bindings) {
  const values = new Map();
  for (const [id, entries] of graph.identities) {
    if (entries.length !== 1) continue;
    const entry = entries[0];
    values.set(`identity:${id}`, { category: 'identity', id, kind: entry.kind, value: semanticEntity(entry.kind, entry.data) });
  }
  for (const [id, entry] of graph.points) values.set(`placement:point:${id}`, { category: 'placement', id, kind: 'point', value: entry.module.data.id });
  for (const [id, entry] of graph.edges) values.set(`placement:edge:${id}`, { category: 'placement', id, kind: 'edge', value: entry.module.data.id });
  for (const [id, span] of bindings.spans) values.set(`span:${id}`, { category: 'span', id, kind: 'point', value: span.sha256 });
  return values;
}

function changedPaths(before, after, prefix = '') {
  if (canonicalJson(before) === canonicalJson(after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after)) return [prefix || '$'];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].sort().flatMap((key) => changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key));
}

function canonicalSemanticDiff(base, candidate, baseBindings, candidateBindings) {
  const before = semanticSnapshot(base, baseBindings);
  const after = semanticSnapshot(candidate, candidateBindings);
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].sort().flatMap((key) => {
    const left = before.get(key); const right = after.get(key);
    if (left && right && canonicalJson(left.value) === canonicalJson(right.value)) return [];
    const meta = left ?? right;
    return [{ key, category: meta.category, id: meta.id, kind: meta.kind, before: left?.value ?? null, after: right?.value ?? null, paths: changedPaths(left?.value, right?.value) }];
  });
}

function lifecycleChange(delta, state, replacement) {
  return delta.category === 'identity'
    && delta.paths.every((item) => item === 'lifecycle' || item.startsWith('lifecycle.'))
    && delta.after?.lifecycle?.state === state
    && delta.after?.lifecycle?.replacement === replacement;
}

function rewriteExplainsDelta(rewrite, delta) {
  if (delta.category === 'placement' && delta.kind === 'edge' && delta.id === rewrite.edge) {
    return (rewrite.action === 'add' && delta.before === null && delta.after !== null)
      || (rewrite.action === 'remove' && delta.before !== null && delta.after === null);
  }
  if (delta.category !== 'identity' || delta.kind !== 'edge' || delta.id !== rewrite.edge) return false;
  if (rewrite.action === 'add') return delta.before === null && delta.after !== null;
  if (rewrite.action === 'remove') return delta.after === null || (delta.paths.every((item) => item === 'lifecycle' || item.startsWith('lifecycle.')) && delta.after?.lifecycle?.state !== 'accepted');
  return rewrite.action === 'retarget'
    && delta.before !== null && delta.after !== null
    && delta.paths.every((item) => item === 'to')
    && (!rewrite.from || delta.before.from === rewrite.from)
    && (!rewrite.to || delta.after.to === rewrite.to);
}

function operationExplainsDelta(operation, delta, base, candidate) {
  const ids = operation.entities ?? operation.results ?? [];
  const subjects = operation.subjects ?? (operation.subject ? [operation.subject] : []);
  const isNew = delta.before === null && delta.after !== null;
  const isRemoved = delta.before !== null && delta.after === null;
  const idListed = ids.includes(delta.id) || (operation.op === 'merge' && operation.result === delta.id);
  const subjectListed = subjects.includes(delta.id);
  const isAddedIdentityOrSpan = () => isNew && idListed && (delta.category === 'identity' || delta.category === 'placement' || delta.category === 'span');
  if ((operation.edge_rewrites ?? []).some((rewrite) => rewriteExplainsDelta(rewrite, delta))) return true;
  if (operation.op === 'add') return isAddedIdentityOrSpan();
  if (operation.op === 'wording') return delta.category === 'span' && delta.id === operation.subject && delta.before !== null && delta.after !== null;
  if (operation.op === 'refine') {
    if (delta.category !== 'identity' || delta.id !== operation.subject || !delta.before || !delta.after) return false;
    const fields = new Set(operation.changed_fields ?? []);
    return delta.paths.length > 0 && delta.paths.every((item) => fields.has(delta.kind === 'edge' ? `edge.${item}` : item));
  }
  if (operation.op === 'move') {
    if (delta.id !== operation.subject) return false;
    if (delta.category === 'placement') return delta.before === operation.from?.module && delta.after === operation.to?.module;
    if (delta.category === 'identity' && delta.kind === 'point' && operation.from?.binding && operation.to?.binding) {
      return delta.paths.every((item) => item === 'binding' || item.startsWith('binding.'))
        && canonicalJson(delta.before.binding) === canonicalJson(operation.from.binding)
        && canonicalJson(delta.after.binding) === canonicalJson(operation.to.binding);
    }
  }
  if (operation.op === 'split' || operation.op === 'merge') {
    if (isAddedIdentityOrSpan()) return true;
    if (operation.op === 'split' && delta.id === operation.subject && lifecycleChange(delta, 'retired', undefined)) return true;
    if (operation.op === 'merge' && subjectListed && lifecycleChange(delta, 'retired', undefined)) return true;
    if ((operation.op === 'split' && delta.id === operation.subject) || (operation.op === 'merge' && subjectListed)) return delta.category === 'span' && isRemoved;
  }
  if (operation.op === 'transfer_owner') {
    return delta.category === 'identity' && delta.kind === 'module' && delta.id === operation.subject
      && delta.paths.every((item) => item === 'owner_skill')
      && delta.before.owner_skill === operation.from_skill && delta.after.owner_skill === operation.to_skill;
  }
  if (operation.op === 'deprecate' || operation.op === 'retire') {
    const state = operation.op === 'deprecate' ? 'deprecated' : 'retired';
    if (subjectListed && lifecycleChange(delta, state, operation.replacement)) return true;
    if (subjectListed && delta.category === 'span' && isRemoved) return true;
  }
  return false;
}

function validateSemanticDiff(base, candidate, baseBindings, candidateBindings, operations) {
  const diagnostics = [];
  const deltas = canonicalSemanticDiff(base, candidate, baseBindings, candidateBindings);
  for (const delta of deltas) {
    if ((operations ?? []).some((operation) => operationExplainsDelta(operation, delta, base, candidate))) continue;
    diagnostics.push(txDiagnostic('SKG-CHANGE-UNEXPLAINED-DIFF', 'Candidate graph contains a semantic delta not completely explained by a declared typed operation.', 'change.draft.json', {
      delta: { key: delta.key, category: delta.category, id: delta.id, kind: delta.kind, paths: delta.paths, before: delta.before, after: delta.after },
    }, 'Declare the matching typed operation and exact fields, or remove the unrelated candidate mutation.'));
  }
  return diagnostics;
}

function validateOperations(base, candidate, baseBindings, candidateBindings, operations) {
  const diagnostics = [];
  for (const operation of operations ?? []) {
    if (!OPERATIONS.includes(operation.op)) {
      diagnostics.push(txDiagnostic('SKG-CHANGE-OPERATION-UNKNOWN', 'Change draft contains an operation outside the closed operation set.', 'change.draft.json', { op: operation.op }, 'Use one of the nine declared typed operations.', EXIT_CODES.source_contract));
      continue;
    }
    const baseHas = (id) => base.identities.has(id);
    const candidateHas = (id) => candidate.identities.has(id);
    const requireBase = (id) => { if (!baseHas(id)) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'Operation subject is not present in the frozen base graph.', 'change.draft.json', { op: operation.op, id }, 'Start from a known active base identity or correct the operation.')); };
    const requireCandidate = (id) => { if (!candidateHas(id)) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'Operation result is not present in the candidate graph.', 'change.draft.json', { op: operation.op, id }, 'Materialize the declared result in candidate manifests.')); };
    if (operation.op === 'add') {
      for (const id of operation.entities ?? []) { if (baseHas(id)) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'add may only introduce identities absent from the base graph.', 'change.draft.json', { id }, 'Use refine/move/etc. for an existing identity.')); requireCandidate(id); }
    } else if (operation.op === 'wording') {
      requireBase(operation.subject); requireCandidate(operation.subject);
      const before = baseBindings.spans.get(operation.subject)?.sha256;
      const after = candidateBindings.spans.get(operation.subject)?.sha256;
      if (!before || !after || before === after || (operation.before_sha256 !== before) || (operation.after_sha256 !== after)) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'wording must declare the exact changed canonical span hashes.', 'change.draft.json', { subject: operation.subject, declared_before: operation.before_sha256, actual_before: before ?? null, declared_after: operation.after_sha256, actual_after: after ?? null }, 'Set hashes to the frozen base and candidate marker span hashes.'));
      if (canonicalJson(base.points.get(operation.subject)?.point.binding) !== canonicalJson(operation.binding) || canonicalJson(candidate.points.get(operation.subject)?.point.binding) !== canonicalJson(operation.binding)) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'wording binding must exactly name the unchanged candidate point binding.', 'change.draft.json', { subject: operation.subject, declared_binding: operation.binding, base_binding: base.points.get(operation.subject)?.point.binding ?? null, candidate_binding: candidate.points.get(operation.subject)?.point.binding ?? null }, 'Keep wording bound to the exact unchanged point binding.'));
    } else if (operation.op === 'refine') {
      requireBase(operation.subject); requireCandidate(operation.subject);
      const beforeEntry = base.identities.get(operation.subject)?.[0];
      const afterEntry = candidate.identities.get(operation.subject)?.[0];
      const actualFields = beforeEntry && afterEntry
        ? changedPaths(semanticEntity(beforeEntry.kind, beforeEntry.data), semanticEntity(afterEntry.kind, afterEntry.data)).map((item) => afterEntry.kind === 'edge' ? `edge.${item}` : item)
        : [];
      const declaredFields = [...(operation.changed_fields ?? [])].sort();
      if (actualFields.length === 0 || canonicalJson([...new Set(actualFields)].sort()) !== canonicalJson(declaredFields)) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'refine must change exactly the declared semantic fields of its existing subject.', 'change.draft.json', { subject: operation.subject, declared_fields: declaredFields, actual_fields: [...new Set(actualFields)].sort() }, 'Make the candidate change exactly the declared refine fields; use another typed operation for other deltas.'));
    } else if (operation.op === 'move') {
      requireBase(operation.subject); requireCandidate(operation.subject);
      const before = base.points.get(operation.subject); const after = candidate.points.get(operation.subject);
      const beforeModule = before?.module?.data.id;
      const afterModule = after?.module?.data.id;
      const beforeBinding = before?.point?.binding;
      const afterBinding = after?.point?.binding;
      const moduleEndpointMismatch = (operation.from?.module !== undefined && beforeModule !== operation.from.module)
        || (operation.to?.module !== undefined && afterModule !== operation.to.module);
      const bindingEndpointMismatch = (operation.from?.binding !== undefined && canonicalJson(beforeBinding) !== canonicalJson(operation.from.binding))
        || (operation.to?.binding !== undefined && canonicalJson(afterBinding) !== canonicalJson(operation.to.binding));
      if (moduleEndpointMismatch) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'move module endpoints do not match frozen base and candidate membership.', 'change.draft.json', { subject: operation.subject, from: operation.from, to: operation.to, actual_from: beforeModule ?? null, actual_to: afterModule ?? null }, 'Make the candidate membership match the declared move.'));
      if (bindingEndpointMismatch) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'move binding endpoints do not match frozen base and candidate point bindings.', 'change.draft.json', { subject: operation.subject, from: operation.from, to: operation.to, actual_from: beforeBinding ?? null, actual_to: afterBinding ?? null }, 'Make each declared binding exactly match its frozen base or candidate point binding.'));
      if (beforeModule === afterModule && canonicalJson(beforeBinding) === canonicalJson(afterBinding)) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'move must change module membership or point binding.', 'change.draft.json', { subject: operation.subject, from_module: beforeModule ?? null, to_module: afterModule ?? null, from_binding: beforeBinding ?? null, to_binding: afterBinding ?? null }, 'Use wording/refine for a non-placement change, or make the move change module membership or binding.'));
    } else if (operation.op === 'split') {
      requireBase(operation.subject); for (const id of operation.results ?? []) { if (baseHas(id)) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'split results must be new identities.', 'change.draft.json', { id }, 'Use a fresh result identity.')); requireCandidate(id); }
      if (candidate.points.get(operation.subject)?.point.lifecycle?.state !== 'retired') diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'split source must be retired in the candidate graph.', 'change.draft.json', { subject: operation.subject }, 'Retire the source identity and retain lineage through the change record.'));
    } else if (operation.op === 'merge') {
      for (const id of operation.subjects ?? []) { requireBase(id); if (candidate.points.get(id)?.point.lifecycle?.state !== 'retired') diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'merge subjects must be retired in the candidate graph.', 'change.draft.json', { id }, 'Retire each merged source identity.')); }
      if (baseHas(operation.result)) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'merge result must be a new identity.', 'change.draft.json', { result: operation.result }, 'Use a new result identity.')); requireCandidate(operation.result);
    } else if (operation.op === 'transfer_owner') {
      requireBase(operation.subject); requireCandidate(operation.subject);
      if (base.modulesById.get(operation.subject)?.data.owner_skill !== operation.from_skill || candidate.modulesById.get(operation.subject)?.data.owner_skill !== operation.to_skill) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'transfer_owner must match base and candidate owner skills.', 'change.draft.json', { subject: operation.subject, from_skill: operation.from_skill, to_skill: operation.to_skill }, 'Synchronize module owner and both skills module membership.'));
    } else {
      for (const id of operation.subjects ?? []) {
        requireBase(id); requireCandidate(id);
        const target = candidate.points.get(id)?.point ?? candidate.modulesById.get(id)?.data;
        const state = target?.lifecycle?.state;
        const expected = operation.op === 'deprecate' ? 'deprecated' : 'retired';
        if (state !== expected || target?.lifecycle?.replacement !== operation.replacement) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'Lifecycle operation must materialize the exact declared state and replacement.', 'change.draft.json', { id, expected, declared_replacement: operation.replacement ?? null, actual: state ?? null, candidate_replacement: target?.lifecycle?.replacement ?? null }, 'Set candidate lifecycle.state and lifecycle.replacement exactly to the declared operation values.'));
      }
    }
    for (const rewrite of operation.edge_rewrites ?? []) {
      const before = base.edges.get(rewrite.edge)?.edge;
      const after = candidate.edges.get(rewrite.edge)?.edge;
      if (rewrite.action === 'add' && (base.edges.has(rewrite.edge) || !after)) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'Added edge rewrite must introduce a new candidate edge.', 'change.draft.json', { edge: rewrite.edge }, 'Create the edge only in the candidate graph.'));
      else if (rewrite.action === 'remove' && (!before || after?.lifecycle?.state === 'accepted')) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'Removed edge rewrite must retire or remove an existing base edge.', 'change.draft.json', { edge: rewrite.edge }, 'Remove the edge from candidate or mark it retired.'));
      else if (rewrite.action === 'retarget' && (!before || !after || (rewrite.to && after.to !== rewrite.to) || (rewrite.from && before.from !== rewrite.from))) diagnostics.push(txDiagnostic('SKG-CHANGE-PRECONDITION', 'Retarget edge rewrite does not match base/candidate endpoints.', 'change.draft.json', { edge: rewrite.edge, declared: rewrite, actual_before: before ?? null, actual_after: after ?? null }, 'Set the candidate edge endpoint to the declared target.'));
    }
  }
  return diagnostics;
}

function checkScopeFresh(repoRoot, scope) {
  const diagnostics = [];
  for (const item of scope) {
    const target = path.join(repoRoot, item.path);
    const actual = fs.existsSync(target) ? sha256Hex(fs.readFileSync(target)) : null;
    if (actual !== item.sha256) diagnostics.push(txDiagnostic('SKG-CHANGE-STALE-SCOPE', 'Accepted scope bytes no longer match the transaction precondition.', item.path, { path: item.path, expected_sha256: item.sha256, actual_sha256: actual }, 'Begin a new transaction from the current accepted bytes.', EXIT_CODES.drift));
  }
  return diagnostics;
}

function workspaceId(operation) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `change:${date}.${operation.replaceAll('_', '-')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

export function beginTransaction({ repoRoot, operation, scope, base, sourceRoot = DEFAULT_SOURCE_ROOT }) {
  const diagnostics = [];
  if (!OPERATIONS.includes(operation)) diagnostics.push(txDiagnostic('SKG-USAGE', 'Unknown typed operation.', 'argv', { operation, allowed: [...OPERATIONS] }, 'Use one of the nine declared operations.', EXIT_CODES.usage));
  const baseRef = resolveBase(repoRoot, base);
  if (!baseRef) diagnostics.push(txDiagnostic('SKG-CHANGE-BASE-INVALID', 'Base ref does not resolve to a commit.', 'argv', { base }, 'Pass a resolvable Git commit or ref.', EXIT_CODES.usage));
  const normalizedScope = [...new Set(scope ?? [])].map((value) => safeScopePath(repoRoot, value));
  if (normalizedScope.length === 0 || normalizedScope.some((item) => !item)) diagnostics.push(txDiagnostic('SKG-USAGE', 'Change begin requires one or more safe repository-relative scope paths.', 'argv', { scope }, 'Pass existing repository-relative authored manifest or Markdown paths.', EXIT_CODES.usage));
  for (const item of normalizedScope.filter(Boolean)) if (!fs.existsSync(item.absolute) || !fs.statSync(item.absolute).isFile()) diagnostics.push(txDiagnostic('SKG-CHANGE-SCOPE-MISSING', 'Scope path must exist as an accepted file at begin.', item.relative, { path: item.relative }, 'Add the file outside this transaction first, then begin from its exact bytes.', EXIT_CODES.source_contract));
  if (diagnostics.length) return { exitCode: selectExitCode(diagnostics), diagnostics };
  const graph = loadGraph({ repoRoot, sourceRoot });
  const invariant = validateGraph(graph, repoRoot, null, []);
  diagnostics.push(...invariant.diagnostics);
  const head = latestLedger(graph, diagnostics);
  const baseGraphHash = graphHash(graph, invariant.bindings, head);
  if (diagnostics.some((item) => item.severity === 'error')) return { exitCode: selectExitCode(diagnostics), diagnostics };
  const changeId = workspaceId(operation);
  const workspace = path.join(repoRoot, WORKSPACE_ROOT, changeId.slice('change:'.length));
  const frozenScope = normalizedScope.map((item) => ({ path: item.relative, sha256: sha256Hex(fs.readFileSync(item.absolute)) }));
  for (const item of normalizedScope) {
    const target = path.join(workspace, 'candidate', item.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(item.absolute, target);
  }
  const workspaceDocument = { schema_version: 'cc-master/skill-knowledge-workspace/v1alpha1', kind: 'change_workspace', change_id: changeId, operation, base_ref: baseRef, base_graph_sha256: baseGraphHash, scope: frozenScope, candidate_root: normalized(path.relative(repoRoot, path.join(workspace, 'candidate'))), status: 'begun' };
  writeJson(path.join(workspace, 'workspace.json'), workspaceDocument);
  writeJson(path.join(workspace, 'change.draft.json'), { schema_version: CHANGE_SCHEMA_VERSION, kind: 'change', change_id: changeId, base_ref: baseRef, base_graph_sha256: baseGraphHash, parent_change: head ? { change_id: head.change_id, result_graph_sha256: head.result_graph_sha256 } : null, reason: 'Fill in why this typed change is needed.', operations: [], evidence: [], expected_effects: { identity_delta: 0, canonical_subject_delta: 0, max_hop_regression_allowed: 0, coverage_debt_allowed: false } });
  return { exitCode: 0, diagnostics: [], workspace, workspaceDocument };
}

function readWorkspace(workspace, diagnostics) {
  const document = readJson(path.join(workspace, 'workspace.json'), diagnostics);
  if (!document) return null;
  if (document.kind !== 'change_workspace' || !Array.isArray(document.scope)) {
    diagnostics.push(txDiagnostic('SKG-CHANGE-WORKSPACE-INVALID', 'workspace.json does not match the change workspace contract.', path.join(workspace, 'workspace.json'), { kind: document.kind ?? null }, 'Recreate the workspace with change begin.', EXIT_CODES.source_contract)); return null;
  }
  return document;
}

function candidateTransitions(repoRoot, workspace, scope) {
  return scope.map((item) => ({ path: item.path, before_sha256: item.sha256, after_sha256: sha256Hex(fs.readFileSync(path.join(workspace, 'candidate', item.path))) }));
}

export function validateTransaction({ repoRoot, workspace, sourceRoot = DEFAULT_SOURCE_ROOT }) {
  const diagnostics = [];
  const allowedWorkspaceRoot = path.resolve(repoRoot, WORKSPACE_ROOT);
  if (!inside(allowedWorkspaceRoot, path.resolve(workspace))) {
    const item = txDiagnostic('SKG-CHANGE-WORKSPACE-INVALID', 'Transaction workspace must be under the ignored workspace root.', normalized(workspace), { workspace: normalized(workspace), workspace_root: relativePath(repoRoot, allowedWorkspaceRoot) }, 'Create the workspace with change begin and validate that exact path.', EXIT_CODES.usage);
    return { exitCode: EXIT_CODES.usage, diagnostics: [item] };
  }
  const metadata = readWorkspace(workspace, diagnostics);
  if (!metadata) return { exitCode: selectExitCode(diagnostics), diagnostics };
  diagnostics.push(...checkScopeFresh(repoRoot, metadata.scope));
  const draft = readJson(path.join(workspace, 'change.draft.json'), diagnostics);
  if (!draft) return { exitCode: selectExitCode(diagnostics), diagnostics };
  const base = loadGraph({ repoRoot, sourceRoot });
  const baseInvariant = validateGraph(base, repoRoot, null, []);
  diagnostics.push(...baseInvariant.diagnostics);
  const head = latestLedger(base, diagnostics);
  const actualBaseHash = graphHash(base, baseInvariant.bindings, head);
  if (actualBaseHash !== metadata.base_graph_sha256 || draft.base_graph_sha256 !== metadata.base_graph_sha256 || draft.base_ref !== metadata.base_ref) diagnostics.push(txDiagnostic('SKG-CHANGE-BASE-STALE', 'Workspace base graph/ref precondition no longer matches the accepted graph.', path.join(workspace, 'workspace.json'), { expected_graph_sha256: metadata.base_graph_sha256, actual_graph_sha256: actualBaseHash, expected_ref: metadata.base_ref, draft_ref: draft.base_ref }, 'Begin a new transaction from the current accepted graph.', EXIT_CODES.drift));
  if (head && metadata.base_graph_sha256 !== head.result_graph_sha256) diagnostics.push(txDiagnostic('SKG-LEDGER-CHAIN-INVALID', 'New change base graph hash must equal the finalized parent result hash.', path.join(workspace, 'workspace.json'), { base_graph_sha256: metadata.base_graph_sha256, parent_change: head.change_id, parent_result_graph_sha256: head.result_graph_sha256 }, 'Begin again from the current finalized ledger head.', EXIT_CODES.drift));
  const candidate = loadGraph({ repoRoot, sourceRoot, workspace, scope: metadata.scope });
  const candidateInvariant = validateGraph(candidate, repoRoot, workspace, metadata.scope);
  diagnostics.push(...candidateInvariant.diagnostics);
  diagnostics.push(...validateOperations(base, candidate, baseInvariant.bindings, candidateInvariant.bindings, draft.operations));
  diagnostics.push(...validateSemanticDiff(base, candidate, baseInvariant.bindings, candidateInvariant.bindings, draft.operations));
  const transitions = candidateTransitions(repoRoot, workspace, metadata.scope);
  const finalChange = { ...draft, parent_change: head ? { change_id: head.change_id, result_graph_sha256: head.result_graph_sha256 } : null, scope: transitions, result_graph_sha256: ZERO_HASH };
  const resultHash = graphHash(candidate, candidateInvariant.bindings, finalChange);
  finalChange.result_graph_sha256 = resultHash;
  const changeSchema = validatorsAvailable() ? validateAuthoredDocument(finalChange, 'change') : { ok: false, errors: [] };
  if (!changeSchema.ok) diagnostics.push(txDiagnostic('SKG-CHANGE-SCHEMA-INVALID', 'Finalized candidate change record fails the committed change schema.', 'change.draft.json', { errors: changeSchema.errors?.slice(0, 8) ?? [] }, 'Repair draft required fields, operations, evidence, and expected effects.', EXIT_CODES.source_contract));
  const patchPath = path.join(workspace, 'apply.patch');
  const patchParts = [];
  for (const item of metadata.scope) {
    const before = item.path;
    const after = normalized(path.relative(repoRoot, path.join(workspace, 'candidate', item.path)));
    const result = spawnSync('git', ['diff', '--no-index', '--binary', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', before, after], { cwd: repoRoot, encoding: 'utf8' });
    if (result.status !== 0 && result.status !== 1) diagnostics.push(txDiagnostic('SKG-CHANGE-PATCH-FAILED', 'Unable to produce transaction patch.', item.path, { stderr: result.stderr }, 'Repair candidate file paths and rerun validate.', EXIT_CODES.drift));
    patchParts.push(result.stdout.replaceAll(after, item.path));
  }
  const patch = patchParts.join(''); fs.writeFileSync(patchPath, patch);
  const applyCheck = spawnSync('git', ['apply', '--check', '--unsafe-paths', patchPath], { cwd: repoRoot, encoding: 'utf8' });
  if (applyCheck.status !== 0) diagnostics.push(txDiagnostic('SKG-CHANGE-GIT-APPLY-CHECK', 'Generated candidate patch cannot be applied to accepted scope.', patchPath, { stderr: applyCheck.stderr }, 'Rebase by beginning a new transaction from current bytes.', EXIT_CODES.drift));
  const validation = { schema_version: 'cc-master/skill-knowledge-validation/v1alpha1', kind: 'change_validation', change_id: metadata.change_id, base_ref: metadata.base_ref, base_graph_sha256: metadata.base_graph_sha256, scope: metadata.scope, result_graph_sha256: resultHash, candidate_valid: diagnostics.length === 0, optimistic_lock_valid: !diagnostics.some((item) => item.code.includes('STALE') || item.code.includes('GIT-APPLY')), git_apply_check: applyCheck.status === 0, patch_sha256: sha256Hex(patch), diagnostics: diagnostics.map(({ exit_code, ...item }) => item) };
  writeJson(path.join(workspace, 'validation.json'), validation);
  if (validation.candidate_valid) { metadata.status = 'validated'; writeJson(path.join(workspace, 'workspace.json'), metadata); }
  return { exitCode: selectExitCode(diagnostics), diagnostics, validation, change: finalChange, patchPath };
}

function ledgerPath(repoRoot, changeId) {
  return path.join(repoRoot, DEFAULT_SOURCE_ROOT, 'changes', `${changeId.slice('change:'.length)}.change.json`);
}

function recoveryBundle(files, recoveryRoot) {
  const recoveryDirectory = path.join(recoveryRoot, 'recovery', `publish-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const originals = files.map((item) => ({ ...item, exists: fs.existsSync(item.target), originalBytes: fs.existsSync(item.target) && fs.statSync(item.target).isFile() ? fs.readFileSync(item.target) : null }));
  const manifest = { schema_version: 'cc-master/skill-knowledge-recovery/v1alpha1', kind: 'change_publish_recovery', status: 'prepared', targets: [] };
  for (const item of originals) {
    const before = path.join(recoveryDirectory, 'before', item.relative);
    const after = path.join(recoveryDirectory, 'after', item.relative);
    fs.mkdirSync(path.dirname(after), { recursive: true });
    fs.writeFileSync(after, item.bytes);
    if (item.exists && item.originalBytes !== null) { fs.mkdirSync(path.dirname(before), { recursive: true }); fs.writeFileSync(before, item.originalBytes); }
    manifest.targets.push({ path: item.relative, existed_before: item.exists, before_sha256: item.originalBytes === null ? null : sha256Hex(item.originalBytes), after_sha256: sha256Hex(item.bytes), before_artifact: item.originalBytes === null ? null : normalized(path.relative(recoveryDirectory, before)), after_artifact: normalized(path.relative(recoveryDirectory, after)) });
  }
  writeJson(path.join(recoveryDirectory, 'manifest.json'), manifest);
  return { recoveryDirectory, originals, manifest };
}

function removeRecoveryBundle(recoveryDirectory) {
  fs.rmSync(recoveryDirectory, { recursive: true, force: true });
  const parent = path.dirname(recoveryDirectory);
  if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
}

function rollbackOriginals(originals) {
  const recoveredPaths = [];
  const unrecoveredPaths = [];
  for (const item of originals) {
    try {
      if (item.exists) fs.writeFileSync(item.target, item.originalBytes);
      else if (fs.existsSync(item.target)) fs.unlinkSync(item.target);
      const restored = item.exists
        ? fs.existsSync(item.target) && fs.statSync(item.target).isFile() && fs.readFileSync(item.target).equals(item.originalBytes)
        : !fs.existsSync(item.target);
      if (!restored) throw new Error('target does not match its exact pre-publication state');
      recoveredPaths.push(item.relative);
    } catch (error) {
      unrecoveredPaths.push({ path: item.relative, error: error.message });
    }
  }
  return { recoveredPaths, unrecoveredPaths };
}

function atomicPublish(files, recoveryRoot, failureInjector) {
  let bundle;
  try {
    bundle = recoveryBundle(files, recoveryRoot);
  } catch (error) {
    return { error, recoveryDirectory: null, recoveredPaths: [], unrecoveredPaths: files.map((item) => ({ path: item.relative, error: `unable to persist recovery bundle: ${error.message}` })) };
  }
  const temps = [];
  try {
    for (const item of bundle.originals) {
      fs.mkdirSync(path.dirname(item.target), { recursive: true });
      const temporary = path.join(path.dirname(item.target), `.${path.basename(item.target)}.skg-${process.pid}-${Math.random().toString(36).slice(2)}`);
      fs.writeFileSync(temporary, item.bytes); temps.push({ temporary, target: item.target });
    }
    for (let index = 0; index < temps.length; index += 1) {
      failureInjector?.(index, temps[index].target);
      fs.renameSync(temps[index].temporary, temps[index].target);
    }
    removeRecoveryBundle(bundle.recoveryDirectory);
    return null;
  } catch (error) {
    const rollback = rollbackOriginals(bundle.originals);
    const manifest = { ...bundle.manifest, status: rollback.unrecoveredPaths.length === 0 ? 'rolled_back' : 'rollback_incomplete', recovered_paths: rollback.recoveredPaths, unrecovered_paths: rollback.unrecoveredPaths };
    writeJson(path.join(bundle.recoveryDirectory, 'manifest.json'), manifest);
    if (rollback.unrecoveredPaths.length === 0) removeRecoveryBundle(bundle.recoveryDirectory);
    return { error, recoveryDirectory: rollback.unrecoveredPaths.length === 0 ? null : bundle.recoveryDirectory, ...rollback };
  } finally {
    for (const item of temps) if (fs.existsSync(item.temporary)) { try { fs.unlinkSync(item.temporary); } catch {} }
  }
}

export function applyTransaction({ repoRoot, workspace, sourceRoot = DEFAULT_SOURCE_ROOT, failureInjector }) {
  const validation = validateTransaction({ repoRoot, workspace, sourceRoot });
  if (validation.exitCode !== 0 || !validation.validation?.candidate_valid) return validation;
  const metadata = readWorkspace(workspace, validation.diagnostics);
  const targetLedger = ledgerPath(repoRoot, metadata.change_id);
  if (fs.existsSync(targetLedger)) {
    const item = txDiagnostic('SKG-LEDGER-IMMUTABLE', 'Finalized change ledger record already exists and cannot be overwritten.', relativePath(repoRoot, targetLedger), { change_id: metadata.change_id }, 'Begin a new change with a fresh identity.', EXIT_CODES.drift);
    return { ...validation, exitCode: EXIT_CODES.drift, diagnostics: [...validation.diagnostics, item] };
  }
  const files = metadata.scope.map((item) => ({ target: path.join(repoRoot, item.path), relative: item.path, bytes: fs.readFileSync(path.join(workspace, 'candidate', item.path)) }));
  const ledgerDirectory = path.dirname(targetLedger);
  const ledgerDirectoryExisted = fs.existsSync(ledgerDirectory);
  files.push({ target: targetLedger, relative: relativePath(repoRoot, targetLedger), bytes: Buffer.from(`${JSON.stringify(validation.change, null, 2)}\n`) });
  const environmentFailure = process.env.SKG_SIMULATE_WRITE_FAILURE_AT;
  const injected = failureInjector ?? (environmentFailure === undefined ? undefined : (index) => { if (index === Number(environmentFailure)) throw new Error('simulated transaction write failure'); });
  const publication = atomicPublish(files, workspace, injected);
  if (publication) {
    if (!ledgerDirectoryExisted && fs.existsSync(ledgerDirectory) && fs.readdirSync(ledgerDirectory).length === 0) {
      fs.rmdirSync(ledgerDirectory);
    }
    const recoveryDir = publication.recoveryDirectory ? normalized(path.relative(workspace, publication.recoveryDirectory)) : null;
    const item = txDiagnostic('SKG-CHANGE-PUBLISH-FAILED', publication.unrecoveredPaths.length === 0 ? 'Atomic transaction publication failed; every canonical target was confirmed rolled back.' : 'Atomic transaction publication failed and rollback is incomplete; preserve and use the recovery bundle before retrying.', relativePath(repoRoot, targetLedger), { error: publication.error.message, recovery_dir: recoveryDir, recovered_paths: publication.recoveredPaths, unrecovered_paths: publication.unrecoveredPaths.map((entry) => entry.path), rollback_failures: publication.unrecoveredPaths }, 'Use the retained recovery bundle to restore every unrecovered path, then begin a new transaction from the repaired accepted graph.', EXIT_CODES.drift);
    return { ...validation, exitCode: EXIT_CODES.drift, diagnostics: [...validation.diagnostics, item] };
  }
  metadata.status = 'applied'; writeJson(path.join(workspace, 'workspace.json'), metadata);
  return { ...validation, exitCode: 0, diagnostics: [], ledgerPath: targetLedger };
}
