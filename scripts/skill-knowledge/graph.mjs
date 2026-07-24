import fs from 'node:fs';
import path from 'node:path';
import { HARDENING_CONTRACT } from './contracts.mjs';
import { diagnostic } from './diagnostics.mjs';
import {
  canonicalGraphHash,
  compareCodePoint,
  estimateBudget,
  hashMarkdownSpan,
} from './hash.mjs';
import { attestInventoryEntry } from './inventory.mjs';
import { loadKnowledgeSource } from './loader.mjs';
import { extractMarkers } from './markers.mjs';

const NAV_EDGE_TYPES = new Set([
  'requires',
  'next',
  'deepens_to',
  'operationalizes',
  'applies_to',
  'contrasts_with',
  'fallback_to',
  'routes_to',
]);

const HOSTS = new Set(HARDENING_CONTRACT.C9.hosts);

function displayPath(repoRoot, target) {
  const relative = path.relative(repoRoot, target);
  if (relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..') {
    return relative.split(path.sep).join('/');
  }
  return path.resolve(target);
}

function walkMarkdownFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      compareCodePoint(a.name, b.name),
    )) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(target);
    }
  };
  visit(root);
  return files;
}

function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((left, right) => {
    const byCode = compareCodePoint(left.code, right.code);
    if (byCode !== 0) return byCode;
    const byLocation = compareCodePoint(left.location ?? '', right.location ?? '');
    if (byLocation !== 0) return byLocation;
    return compareCodePoint(left.message, right.message);
  });
}

function pushError(diagnostics, fields) {
  diagnostics.push(
    diagnostic({
      severity: 'error',
      ...fields,
    }),
  );
}

function pushDebt(diagnostics, fields) {
  diagnostics.push(
    diagnostic({
      severity: 'debt',
      exitCode: 0,
      ...fields,
    }),
  );
}

/**
 * Build the accepted authored graph IR and validate K1 pilot invariants.
 * Consumes loader / markers / hash / inventory — no second parser.
 */
export function buildAndValidateGraph({ repoRoot, sourceRoot = 'plugin/src/knowledge' }) {
  const loaded = loadKnowledgeSource({ repoRoot, sourceRoot });
  const diagnostics = [...loaded.diagnostics];
  const portfolios = [];
  const skills = [];
  const modules = [];
  const changes = [];

  for (const document of loaded.documents) {
    if (!document.schema_ok) continue;
    if (document.kind === 'portfolio') portfolios.push(document);
    else if (document.kind === 'skill') skills.push(document);
    else if (document.kind === 'module') modules.push(document);
    else if (document.kind === 'change') changes.push(document);
  }

  if (portfolios.length === 0 && skills.length === 0 && modules.length === 0) {
    if (diagnostics.every((item) => item.severity !== 'error')) {
      pushError(diagnostics, {
        code: 'SKG-COVERAGE-EMPTY',
        message: 'K1 requires a non-empty authored knowledge inventory.',
        location: loaded.source_root,
        witness: { documents: loaded.documents.length, stage: 'K1' },
        remediation:
          'Add an admitted portfolio/skill/module pilot before querying or reporting the graph.',
        exitCode: 4,
      });
    }
    return {
      ok: false,
      source_root: loaded.source_root,
      graph: null,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  if (portfolios.length !== 1) {
    pushError(diagnostics, {
      code: 'SKG-GRAPH-PORTFOLIO-COUNT',
      message: `K1 pilot requires exactly one portfolio document, found ${portfolios.length}.`,
      location: loaded.source_root,
      witness: { count: portfolios.length, ids: portfolios.map((item) => item.id) },
      remediation: 'Keep a single portfolio:cc-master-runtime-skills shard for the admitted pilot.',
      exitCode: 4,
    });
  }

  const portfolio = portfolios[0]?.data ?? null;
  const skillById = new Map();
  const moduleById = new Map();
  const pointById = new Map();
  const edgeById = new Map();
  const entryById = new Map();
  const subjectCanonical = new Map();
  const markdownCache = new Map();
  const spanByPoint = new Map();
  const spanHashes = {};

  const readMarkdown = (relativePath) => {
    if (markdownCache.has(relativePath)) return markdownCache.get(relativePath);
    const absolute = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolute)) {
      const miss = { ok: false, missing: true, text: null, markers: null };
      markdownCache.set(relativePath, miss);
      return miss;
    }
    const text = fs.readFileSync(absolute, 'utf8');
    const markers = extractMarkers(text, relativePath);
    const value = { ok: markers.ok, missing: false, text, markers };
    markdownCache.set(relativePath, value);
    return value;
  };

  for (const skillDoc of skills) {
    skillById.set(skillDoc.id, skillDoc.data);
  }
  for (const moduleDoc of modules) {
    moduleById.set(moduleDoc.id, moduleDoc.data);
  }

  const documentByPath = new Map(
    loaded.documents.map((document) => [document.path, document]),
  );

  // Structural ownership tree: portfolio→skill→module refs resolve to exact loaded shards.
  const moduleOwners = new Map();
  const skillOwners = new Map();
  if (portfolio) {
    for (const ref of portfolio.skills ?? []) {
      const doc = documentByPath.get(ref.manifest);
      if (!doc || doc.kind !== 'skill' || doc.id !== ref.id || !doc.schema_ok) {
        pushError(diagnostics, {
          code: 'SKG-OWNERSHIP-REF',
          message: `Portfolio skill manifest ref does not resolve to exact loaded skill: ${ref.id}`,
          location: portfolios[0].path,
          witness: {
            ref,
            loaded_kind: doc?.kind ?? null,
            loaded_id: doc?.id ?? null,
            loaded_path: doc?.path ?? null,
          },
          remediation:
            'Point portfolio.skills[].manifest at the skill shard whose kind/id exactly match the ref.',
          exitCode: 4,
        });
        continue;
      }
      const owners = skillOwners.get(ref.id) ?? [];
      owners.push(portfolio.id);
      skillOwners.set(ref.id, owners);
    }
  }

  for (const skillDoc of skills) {
    const skill = skillDoc.data;
    if (!skillOwners.has(skill.id)) {
      pushError(diagnostics, {
        code: 'SKG-OWNERSHIP-ORPHAN',
        message: `Skill shard is not owned by the portfolio: ${skill.id}`,
        location: skillDoc.path,
        witness: { skill: skill.id, path: skillDoc.path },
        remediation: 'Add the skill to portfolio.skills or remove the orphan shard.',
        exitCode: 4,
      });
    }
    for (const ref of skill.modules ?? []) {
      const doc = documentByPath.get(ref.manifest);
      if (!doc || doc.kind !== 'module' || doc.id !== ref.id || !doc.schema_ok) {
        pushError(diagnostics, {
          code: 'SKG-OWNERSHIP-REF',
          message: `Skill module manifest ref does not resolve to exact loaded module: ${ref.id}`,
          location: skillDoc.path,
          witness: {
            skill: skill.id,
            ref,
            loaded_kind: doc?.kind ?? null,
            loaded_id: doc?.id ?? null,
            loaded_path: doc?.path ?? null,
          },
          remediation:
            'Point skill.modules[].manifest at the module shard whose kind/id exactly match the ref.',
          exitCode: 4,
        });
      }
      const owners = moduleOwners.get(ref.id) ?? [];
      owners.push(skill.id);
      moduleOwners.set(ref.id, owners);
    }
  }

  for (const [moduleId, owners] of [...moduleOwners.entries()].sort(([left], [right]) =>
    compareCodePoint(left, right),
  )) {
    const uniqueOwners = [...new Set(owners)].sort(compareCodePoint);
    if (uniqueOwners.length > 1) {
      pushError(diagnostics, {
        code: 'SKG-OWNERSHIP-MULTIPLY',
        message: `Module shard is claimed by multiple skills: ${moduleId}`,
        location: moduleById.get(moduleId) ? `module:${moduleId}` : loaded.source_root,
        witness: { module: moduleId, owners: uniqueOwners },
        remediation: 'Keep exactly one owning skill.modules[] ref per active module shard.',
        exitCode: 4,
      });
    }
  }

  for (const moduleDoc of modules) {
    const owners = [...new Set(moduleOwners.get(moduleDoc.id) ?? [])].sort(compareCodePoint);
    if (owners.length === 0) {
      pushError(diagnostics, {
        code: 'SKG-OWNERSHIP-ORPHAN',
        message: `Module shard is not owned by any skill: ${moduleDoc.id}`,
        location: moduleDoc.path,
        witness: { module: moduleDoc.id, path: moduleDoc.path },
        remediation: 'Add the module to exactly one skill.modules list or remove the orphan shard.',
        exitCode: 4,
      });
    } else if (owners.length === 1 && moduleDoc.data.owner_skill !== owners[0]) {
      pushError(diagnostics, {
        code: 'SKG-OWNERSHIP-REF',
        message: `Module owner_skill does not match its owning skill ref: ${moduleDoc.id}`,
        location: moduleDoc.path,
        witness: {
          module: moduleDoc.id,
          owner_skill: moduleDoc.data.owner_skill,
          owning_skill_ref: owners[0],
        },
        remediation: 'Align module.owner_skill with the unique skill.modules[] owner.',
        exitCode: 4,
      });
    }
  }

  // Structural ownership + point/edge index.
  for (const moduleDoc of modules) {
    const module = moduleDoc.data;
    if (!skillById.has(module.owner_skill)) {
      pushError(diagnostics, {
        code: 'SKG-GRAPH-OWNER-MISSING',
        message: `Module owner skill is missing: ${module.owner_skill}`,
        location: moduleDoc.path,
        witness: { module: module.id, owner_skill: module.owner_skill },
        remediation: 'Point owner_skill at an authored skill shard in the same source root.',
        exitCode: 4,
      });
    }
    for (const point of module.points ?? []) {
      if (pointById.has(point.id)) {
        pushError(diagnostics, {
          code: 'SKG-ID-DUPLICATE',
          message: `Point id declared more than once: ${point.id}`,
          location: moduleDoc.path,
          witness: {
            id: point.id,
            previous_module: pointById.get(point.id).module_id,
            module: module.id,
          },
          remediation: 'Keep one active owner module per point id.',
          exitCode: 4,
        });
        continue;
      }
      pointById.set(point.id, { ...point, module_id: module.id, owner_skill: module.owner_skill });
      const role = point.authority?.role;
      const subject = point.authority?.subject;
      if (role === 'canonical' && subject) {
        if (subjectCanonical.has(subject)) {
          pushError(diagnostics, {
            code: 'SKG-AUTHORITY-DUPLICATE-CANONICAL',
            message: `Subject has more than one active canonical point: ${subject}`,
            location: moduleDoc.path,
            witness: {
              subject,
              points: [subjectCanonical.get(subject), point.id],
            },
            remediation: 'Keep exactly one active canonical point per subject.',
            exitCode: 4,
          });
        } else {
          subjectCanonical.set(subject, point.id);
        }
      }
    }
    for (const edge of module.edges ?? []) {
      if (edgeById.has(edge.id)) {
        pushError(diagnostics, {
          code: 'SKG-ID-DUPLICATE',
          message: `Edge id declared more than once: ${edge.id}`,
          location: moduleDoc.path,
          witness: { id: edge.id },
          remediation: 'Keep globally unique edge ids.',
          exitCode: 4,
        });
        continue;
      }
      edgeById.set(edge.id, { ...edge, module_id: module.id });
    }
  }

  if (portfolio) {
    for (const entry of portfolio.entries ?? []) {
      if (entryById.has(entry.id)) {
        pushError(diagnostics, {
          code: 'SKG-ID-DUPLICATE',
          message: `Entry id declared more than once: ${entry.id}`,
          location: portfolios[0].path,
          witness: {
            id: entry.id,
            previous_label: entryById.get(entry.id).label,
            label: entry.label,
          },
          remediation: 'Keep globally unique entry ids (K-I01); do not reuse an active entry id.',
          exitCode: 4,
        });
        continue;
      }
      entryById.set(entry.id, entry);
      for (const surface of entry.surfaces ?? []) {
        if (!HOSTS.has(surface.host)) {
          pushError(diagnostics, {
            code: 'SKG-ENTRY-HOST-UNKNOWN',
            message: `Entry surface host is outside the frozen host set: ${surface.host}`,
            location: portfolios[0].path,
            witness: { entry: entry.id, host: surface.host, allowed: [...HOSTS] },
            remediation: 'Use one of claude-code / codex / cursor / kimi-code.',
            exitCode: 4,
          });
        }
        const sourceFile = surface.source_file;
        const absolute = path.join(repoRoot, sourceFile);
        if (!fs.existsSync(absolute)) {
          pushError(diagnostics, {
            code: 'SKG-ENTRY-SURFACE-MISSING',
            message: `Entry surface source file is missing: ${sourceFile}`,
            location: portfolios[0].path,
            witness: { entry: entry.id, host: surface.host, source_file: sourceFile },
            remediation: 'Point surfaces at real adapter Markdown, or declare unsupported coverage.',
            exitCode: 4,
          });
          continue;
        }
        const text = fs.readFileSync(absolute, 'utf8');
        const binding = surface.binding;
        if (binding?.kind === 'anchor') {
          if (!text.includes(binding.value)) {
            pushError(diagnostics, {
              code: 'SKG-ENTRY-ANCHOR-MISSING',
              message: `Entry surface anchor not found in source: ${binding.value}`,
              location: sourceFile,
              witness: { entry: entry.id, host: surface.host, binding },
              remediation: 'Add the explicit anchor or retarget the surface binding.',
              exitCode: 4,
            });
          }
        } else if (binding?.kind === 'marker') {
          const markers = extractMarkers(text, sourceFile);
          if (!markers.ok) {
            diagnostics.push(...markers.diagnostics);
          } else if (!markers.spans.some((span) => span.point_id === binding.value)) {
            pushError(diagnostics, {
              code: 'SKG-ENTRY-MARKER-MISSING',
              message: `Entry surface marker not found in source: ${binding.value}`,
              location: sourceFile,
              witness: { entry: entry.id, host: surface.host, binding },
              remediation: 'Add the matching ccm:k marker pair or retarget the surface binding.',
              exitCode: 4,
            });
          }
        }
        for (const target of surface.targets ?? []) {
          const skillId = target.skill ?? null;
          const moduleId = target.module ?? null;
          const pointId = target.point ?? null;
          const chainBroken = (() => {
            if (skillId && !skillById.has(skillId)) return true;
            if (moduleId && !moduleById.has(moduleId)) return true;
            if (pointId && !pointById.has(pointId)) return true;
            if (skillId && moduleId) {
              const module = moduleById.get(moduleId);
              if (!module || module.owner_skill !== skillId) return true;
              const owned = (skillById.get(skillId)?.modules ?? []).some(
                (ref) => ref.id === moduleId,
              );
              if (!owned) return true;
            }
            if (moduleId && pointId) {
              const point = pointById.get(pointId);
              if (!point || point.module_id !== moduleId) return true;
            }
            if (skillId && pointId) {
              const point = pointById.get(pointId);
              if (!point || point.owner_skill !== skillId) return true;
            }
            return false;
          })();
          if (chainBroken) {
            pushError(diagnostics, {
              code: 'SKG-ENTRY-TARGET-CHAIN',
              message: `Entry surface target is outside the real ownership chain: ${entry.id}`,
              location: portfolios[0].path,
              witness: { entry: entry.id, host: surface.host, target },
              remediation:
                'Keep entry targets on one real skill→module→point ownership chain; missing skill, wrong module, and cross-module points fail closed.',
              exitCode: 4,
            });
          }
        }
      }
    }
  }

  // Markdown bindings for points + global inventory marker uniqueness.
  const globalMarkerIndex = new Map();
  for (const skillDoc of skills) {
    for (const entry of skillDoc.data.canonical_source_inventory ?? []) {
      const markdown = readMarkdown(entry.path);
      if (markdown.missing || !markdown.markers?.ok) continue;
      for (const span of markdown.markers.spans) {
        const list = globalMarkerIndex.get(span.point_id) ?? [];
        list.push({
          path: entry.path,
          start_line: span.start_line,
          end_line: span.end_line,
        });
        globalMarkerIndex.set(span.point_id, list);
      }
    }
  }

  for (const [pointId, point] of [...pointById.entries()].sort(([a], [b]) =>
    compareCodePoint(a, b),
  )) {
    const binding = point.binding;
    if (!binding?.path || !binding?.marker) {
      pushError(diagnostics, {
        code: 'SKG-BINDING-MISSING',
        message: `Point is missing Markdown binding: ${pointId}`,
        location: point.module_id,
        witness: { point: pointId },
        remediation: 'Bind every active point to a canonical Markdown path + marker.',
        exitCode: 3,
      });
      continue;
    }
    if (binding.marker !== pointId) {
      pushError(diagnostics, {
        code: 'SKG-BINDING-MARKER-MISMATCH',
        message: `Point binding marker must equal point id: ${pointId}`,
        location: binding.path,
        witness: { point: pointId, marker: binding.marker },
        remediation: 'Set binding.marker to the point id.',
        exitCode: 3,
      });
    }
    const globalSpans = globalMarkerIndex.get(pointId) ?? [];
    if (globalSpans.length > 1 || (globalSpans.length === 1 && globalSpans[0].path !== binding.path)) {
      pushError(diagnostics, {
        code: 'SKG-MARKER-DUPLICATE-GLOBAL',
        message: `Point marker is not uniquely bound across canonical inventory: ${pointId}`,
        location: binding.path,
        witness: {
          point: pointId,
          binding_path: binding.path,
          spans: globalSpans,
        },
        remediation:
          'Keep exactly one ccm:k marker pair per point id across the full canonical inventory, matching binding.path.',
        exitCode: 4,
      });
    }
    const markdown = readMarkdown(binding.path);
    if (markdown.missing) {
      pushError(diagnostics, {
        code: 'SKG-BINDING-FILE-MISSING',
        message: `Bound Markdown file is missing: ${binding.path}`,
        location: binding.path,
        witness: { point: pointId, path: binding.path },
        remediation: 'Restore the canonical Markdown file or retarget the binding.',
        exitCode: 3,
      });
      continue;
    }
    if (!markdown.markers.ok) {
      diagnostics.push(...markdown.markers.diagnostics);
      continue;
    }
    const span = markdown.markers.spans.find((item) => item.point_id === pointId);
    if (!span) {
      pushError(diagnostics, {
        code: 'SKG-BINDING-MARKER-MISSING',
        message: `Point marker not found in Markdown: ${pointId}`,
        location: binding.path,
        witness: {
          point: pointId,
          path: binding.path,
          available: markdown.markers.spans.map((item) => item.point_id),
        },
        remediation: 'Add a matching <!-- ccm:k:start/end --> pair around the canonical span.',
        exitCode: 3,
      });
      continue;
    }
    spanByPoint.set(pointId, { ...span, path: binding.path });
    spanHashes[pointId] = hashMarkdownSpan(span.content);
  }

  // Derived authority freshness (C3 / K-I19).
  for (const [pointId, point] of pointById) {
    const role = point.authority?.role;
    if (role !== 'summary' && role !== 'example') continue;
    const canonicalId = point.authority.canonical;
    if (!canonicalId || !pointById.has(canonicalId)) {
      pushError(diagnostics, {
        code: 'SKG-AUTHORITY-CANONICAL-MISSING',
        message: `Derived authority is missing its canonical target: ${pointId}`,
        location: point.binding?.path ?? point.module_id,
        witness: { point: pointId, canonical: canonicalId ?? null },
        remediation: 'Point summary/example authority.canonical at an active canonical point.',
        exitCode: 4,
      });
      continue;
    }
    const canonical = pointById.get(canonicalId);
    if (canonical.authority?.role !== 'canonical') {
      pushError(diagnostics, {
        code: 'SKG-AUTHORITY-CHAIN',
        message: `Derived authority must target a canonical point: ${pointId}`,
        location: point.binding?.path ?? point.module_id,
        witness: { point: pointId, canonical: canonicalId, role: canonical.authority?.role },
        remediation: 'Forbid summary→summary / example→summary chains; target the canonical owner.',
        exitCode: 4,
      });
      continue;
    }
    if (canonical.authority.subject !== point.authority.subject) {
      pushError(diagnostics, {
        code: 'SKG-AUTHORITY-SUBJECT-MISMATCH',
        message: `Derived authority subject must match its canonical: ${pointId}`,
        location: point.binding?.path ?? point.module_id,
        witness: {
          point: pointId,
          subject: point.authority.subject,
          canonical,
          canonical_subject: canonical.authority.subject,
        },
        remediation: 'Align authority.subject with the canonical point subject.',
        exitCode: 4,
      });
    }
    if (point.authority.review_policy === 'review-on-canonical-change') {
      const current = spanHashes[canonicalId];
      const reviewed = point.authority.reviewed_canonical_sha256;
      if (!current || reviewed !== current) {
        pushError(diagnostics, {
          code: 'SKG-AUTHORITY-STALE-REVIEW',
          message: `Derived authority review is stale for ${pointId}`,
          location: point.binding?.path ?? point.module_id,
          witness: {
            point: pointId,
            canonical: canonicalId,
            expected_sha256: reviewed ?? null,
            actual_sha256: current ?? null,
          },
          remediation:
            'Re-review the summary/example against the current canonical span and update reviewed_canonical_sha256.',
          exitCode: 4,
        });
      }
    }
  }

  // Navigation edges: existence + type registry.
  const adjacency = new Map();
  const ensureNode = (id) => {
    if (!adjacency.has(id)) adjacency.set(id, []);
  };
  for (const pointId of pointById.keys()) ensureNode(pointId);
  for (const [edgeId, edge] of edgeById) {
    if (!NAV_EDGE_TYPES.has(edge.type)) {
      pushError(diagnostics, {
        code: 'SKG-EDGE-TYPE-INVALID',
        message: `Navigation edge type is outside the closed set: ${edge.type}`,
        location: edge.module_id,
        witness: { edge: edgeId, type: edge.type },
        remediation: 'Use a typed navigation edge; related_to is forbidden.',
        exitCode: 4,
      });
      continue;
    }
    if (!pointById.has(edge.from) || !pointById.has(edge.to)) {
      pushError(diagnostics, {
        code: 'SKG-EDGE-ENDPOINT-MISSING',
        message: `Navigation edge endpoint is missing: ${edgeId}`,
        location: edge.module_id,
        witness: {
          edge: edgeId,
          from: edge.from,
          to: edge.to,
          from_exists: pointById.has(edge.from),
          to_exists: pointById.has(edge.to),
        },
        remediation: 'Repair or remove dangling edges before claiming connectivity.',
        exitCode: 4,
      });
      continue;
    }
    if (edge.runtime?.enabled_by_default === false) continue;
    ensureNode(edge.from);
    ensureNode(edge.to);
    adjacency.get(edge.from).push({
      to: edge.to,
      edge_id: edgeId,
      type: edge.type,
    });
  }
  for (const [from, edges] of adjacency) {
    edges.sort((left, right) => {
      const byTo = compareCodePoint(left.to, right.to);
      if (byTo !== 0) return byTo;
      return compareCodePoint(left.edge_id, right.edge_id);
    });
    adjacency.set(from, edges);
  }

  // Skill inventory vs git denominator (C2 / C11 / K-I18).
  for (const skillDoc of skills) {
    const skill = skillDoc.data;
    const packageRoot = path.join(repoRoot, skill.package_root, 'canonical');
    const denominator = walkMarkdownFiles(packageRoot).map((absolute) =>
      displayPath(repoRoot, absolute),
    );
    const inventory = [...(skill.canonical_source_inventory ?? [])].sort((left, right) =>
      compareCodePoint(left.path, right.path),
    );
    const inventoryPaths = inventory.map((entry) => entry.path);
    const missing = denominator.filter((item) => !inventoryPaths.includes(item));
    const extra = inventoryPaths.filter((item) => !denominator.includes(item));
    if (missing.length > 0 || extra.length > 0) {
      pushError(diagnostics, {
        code: 'SKG-INVENTORY-DENOMINATOR',
        message: `Skill inventory does not match Git canonical Markdown denominator for ${skill.id}`,
        location: skillDoc.path,
        witness: { skill: skill.id, missing, extra, denominator },
        remediation:
          'Enumerate every plugin/src/skills/<skill>/canonical/**/*.md path; mark unbound files partial/excluded with review.',
        exitCode: 4,
      });
    }

    // Module refs exist.
    for (const ref of skill.modules ?? []) {
      if (!moduleById.has(ref.id)) {
        pushError(diagnostics, {
          code: 'SKG-SKILL-MODULE-MISSING',
          message: `Skill module manifest is missing: ${ref.id}`,
          location: skillDoc.path,
          witness: { skill: skill.id, module: ref.id, manifest: ref.manifest },
          remediation: 'Add the module shard or remove it from skill.modules.',
          exitCode: 4,
        });
      }
    }

    for (const entry of inventory) {
      const markdown = readMarkdown(entry.path);
      if (markdown.missing) {
        pushError(diagnostics, {
          code: 'SKG-INVENTORY-FILE-MISSING',
          message: `Inventory path is missing on disk: ${entry.path}`,
          location: skillDoc.path,
          witness: { path: entry.path },
          remediation: 'Remove the stale inventory row or restore the Markdown file.',
          exitCode: 4,
        });
        continue;
      }
      if (!markdown.markers.ok) {
        diagnostics.push(...markdown.markers.diagnostics);
        continue;
      }
      for (const pointId of entry.point_ids ?? []) {
        if (!pointById.has(pointId)) {
          pushError(diagnostics, {
            code: 'SKG-INVENTORY-POINT-MISSING',
            message: `Inventory lists unknown point id: ${pointId}`,
            location: entry.path,
            witness: { path: entry.path, point: pointId },
            remediation: 'Bind the point in a module shard or drop it from the inventory row.',
            exitCode: 4,
          });
        }
      }
      const attestation = attestInventoryEntry(entry, markdown.text, markdown.markers.spans);
      if (!attestation.ok) diagnostics.push(...attestation.diagnostics);
      if (entry.coverage === 'partial') {
        pushDebt(diagnostics, {
          code: 'SKG-COVERAGE-PARTIAL',
          message: `Partial coverage debt remains for ${entry.path}`,
          location: entry.path,
          witness: {
            path: entry.path,
            unresolved_coverage_debt: entry.unresolved_coverage_debt ?? [],
          },
          remediation: 'Bind remaining prose into points, or keep the debt explicit until K2.',
        });
      }
    }
  }

  // Pin budget (K-I12).
  if (portfolio) {
    const criticalModules = modules
      .map((item) => item.data)
      .filter((module) => module.access?.class === 'critical');
    const maxModules = portfolio.critical_pin_budget?.max_modules ?? 0;
    const maxFraction = portfolio.critical_pin_budget?.max_fraction ?? 1;
    const activeCount = modules.length;
    const fraction = activeCount === 0 ? 0 : criticalModules.length / activeCount;
    if (criticalModules.length > maxModules || fraction > maxFraction + Number.EPSILON) {
      pushError(diagnostics, {
        code: 'SKG-BUDGET-CRITICAL-PIN',
        message: 'Critical pin budget exceeded.',
        location: portfolios[0].path,
        witness: {
          critical_modules: criticalModules.map((item) => item.id).sort(compareCodePoint),
          count: criticalModules.length,
          active_modules: activeCount,
          max_modules: maxModules,
          max_fraction: maxFraction,
          fraction,
        },
        remediation:
          'Demote a critical module to primary/on_demand, or raise the budget with an explicit PR rationale.',
        exitCode: 4,
      });
    }

    // Router budget soft check using deterministic estimator over cue/summary text.
    const atlasText = [
      ...(portfolio.entries ?? []).flatMap((entry) => entry.recognition_cues ?? []),
      ...modules.flatMap((item) => [
        item.data.intent,
        ...(item.data.recognition_cues ?? []),
      ]),
    ].join('\n');
    const atlasBudget = estimateBudget(atlasText);
    const limits = portfolio.router_budget ?? {};
    if (
      (typeof limits.atlas_max_tokens === 'number' &&
        atlasBudget.estimated_tokens > limits.atlas_max_tokens) ||
      (typeof limits.atlas_max_lines === 'number' && atlasBudget.lines > limits.atlas_max_lines)
    ) {
      pushError(diagnostics, {
        code: 'SKG-BUDGET-ROUTER',
        message: 'Atlas/router cue budget exceeded.',
        location: portfolios[0].path,
        witness: { budget: atlasBudget, limits },
        remediation: 'Shrink recognition cues / intents, or raise router_budget with rationale.',
        exitCode: 4,
      });
    }
  }

  // Access references exist.
  for (const moduleDoc of modules) {
    const module = moduleDoc.data;
    for (const entryId of module.access?.relevant_entries ?? []) {
      if (!entryById.has(entryId)) {
        pushError(diagnostics, {
          code: 'SKG-ACCESS-ENTRY-MISSING',
          message: `Module relevant entry is missing: ${entryId}`,
          location: moduleDoc.path,
          witness: { module: module.id, entry: entryId },
          remediation: 'Declare the entry on the portfolio or remove it from access.relevant_entries.',
          exitCode: 4,
        });
      }
    }
    for (const pointId of module.access?.primary_points ?? []) {
      if (!pointById.has(pointId)) {
        pushError(diagnostics, {
          code: 'SKG-ACCESS-POINT-MISSING',
          message: `Module primary point is missing: ${pointId}`,
          location: moduleDoc.path,
          witness: { module: module.id, point: pointId },
          remediation: 'Point primary_points at member points of this module.',
          exitCode: 4,
        });
      }
    }
  }

  const manifests = [
    ...(portfolio ? [portfolio] : []),
    ...skills.map((item) => item.data),
    ...modules.map((item) => item.data),
  ];
  const inventoryForHash = skills.flatMap(
    (item) => item.data.canonical_source_inventory ?? [],
  );
  const graphHash = canonicalGraphHash({
    manifests,
    span_hashes: spanHashes,
    inventory: inventoryForHash,
    change_head: changes[0]?.data ?? null,
  });

  const graph = {
    portfolio,
    skills: [...skillById.entries()]
      .sort(([left], [right]) => compareCodePoint(left, right))
      .map(([, value]) => value),
    modules: [...moduleById.entries()]
      .sort(([left], [right]) => compareCodePoint(left, right))
      .map(([, value]) => value),
    points: [...pointById.entries()]
      .sort(([left], [right]) => compareCodePoint(left, right))
      .map(([id, value]) => ({ id, ...value })),
    edges: [...edgeById.entries()]
      .sort(([left], [right]) => compareCodePoint(left, right))
      .map(([id, value]) => ({ id, ...value })),
    entries: [...entryById.entries()]
      .sort(([left], [right]) => compareCodePoint(left, right))
      .map(([id, value]) => ({ id, ...value })),
    span_hashes: Object.fromEntries(
      Object.entries(spanHashes).sort(([left], [right]) => compareCodePoint(left, right)),
    ),
    spans: [...spanByPoint.entries()]
      .sort(([left], [right]) => compareCodePoint(left, right))
      .map(([pointId, span]) => ({ point_id: pointId, ...span })),
    adjacency,
    graph_hash: graphHash,
    counts: {
      portfolio: portfolios.length,
      skill: skills.length,
      module: modules.length,
      point: pointById.size,
      edge: edgeById.size,
      entry: entryById.size,
      change: changes.length,
    },
  };

  const sorted = sortDiagnostics(diagnostics);
  const ok = sorted.every((item) => item.severity !== 'error');
  return {
    ok,
    source_root: loaded.source_root,
    graph,
    diagnostics: sorted,
  };
}

export function resolveEntityId(graph, rawId) {
  if (!graph) {
    return { ok: false, matches: [], diagnostics: [] };
  }
  const ids = [
    graph.portfolio?.id,
    ...graph.skills.map((item) => item.id),
    ...graph.modules.map((item) => item.id),
    ...graph.points.map((item) => item.id),
    ...graph.edges.map((item) => item.id),
    ...graph.entries.map((item) => item.id),
  ].filter(Boolean);

  const exact = ids.filter((id) => id === rawId);
  if (exact.length === 1) return { ok: true, id: exact[0], matches: exact, diagnostics: [] };
  if (exact.length > 1) {
    return {
      ok: false,
      matches: exact.sort(compareCodePoint),
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'SKG-QUERY-AMBIGUOUS',
          message: `Entity id resolves ambiguously: ${rawId}`,
          location: 'argv',
          witness: { query: rawId, matches: exact.sort(compareCodePoint) },
          remediation: 'Pass a fully qualified unique id.',
          exitCode: 4,
        }),
      ],
    };
  }

  const suffix = ids.filter((id) => id.endsWith(`:${rawId}`) || id.endsWith(`.${rawId}`));
  if (suffix.length === 1) return { ok: true, id: suffix[0], matches: suffix, diagnostics: [] };
  if (suffix.length > 1) {
    return {
      ok: false,
      matches: suffix.sort(compareCodePoint),
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'SKG-QUERY-AMBIGUOUS',
          message: `Entity id resolves ambiguously: ${rawId}`,
          location: 'argv',
          witness: { query: rawId, matches: suffix.sort(compareCodePoint) },
          remediation: 'Pass a fully qualified unique id.',
          exitCode: 4,
        }),
      ],
    };
  }

  return {
    ok: false,
    matches: [],
    diagnostics: [
      diagnostic({
        severity: 'error',
        code: 'SKG-QUERY-NOT-FOUND',
        message: `Entity id not found: ${rawId}`,
        location: 'argv',
        witness: { query: rawId },
        remediation: 'Use explain/report to list admitted ids, then retry with an exact id.',
        exitCode: 4,
      }),
    ],
  };
}

export function shortestPath(graph, fromId, toId) {
  if (fromId === toId) {
    return {
      reachable: true,
      hops: 0,
      nodes: [fromId],
      edges: [],
      witness: { from: fromId, to: toId, algorithm: 'bfs', plane: 'navigation' },
    };
  }
  const queue = [fromId];
  const prev = new Map([[fromId, null]]);
  const via = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    const edges = graph.adjacency.get(current) ?? [];
    for (const edge of edges) {
      if (prev.has(edge.to)) continue;
      prev.set(edge.to, current);
      via.set(edge.to, edge);
      if (edge.to === toId) {
        queue.length = 0;
        break;
      }
      queue.push(edge.to);
    }
  }
  if (!prev.has(toId)) {
    return {
      reachable: false,
      hops: null,
      nodes: [],
      edges: [],
      witness: {
        from: fromId,
        to: toId,
        algorithm: 'bfs',
        plane: 'navigation',
        explored: [...prev.keys()].sort(compareCodePoint),
      },
    };
  }
  const nodes = [];
  const edgeTrail = [];
  let cursor = toId;
  while (cursor !== fromId) {
    nodes.push(cursor);
    edgeTrail.push(via.get(cursor));
    cursor = prev.get(cursor);
  }
  nodes.push(fromId);
  nodes.reverse();
  edgeTrail.reverse();
  return {
    reachable: true,
    hops: edgeTrail.length,
    nodes,
    edges: edgeTrail.map((edge, index) => ({
      from: nodes[index],
      to: nodes[index + 1],
      edge_id: edge.edge_id,
      type: edge.type,
    })),
    witness: { from: fromId, to: toId, algorithm: 'bfs', plane: 'navigation' },
  };
}
