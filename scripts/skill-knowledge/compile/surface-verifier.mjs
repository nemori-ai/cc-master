import fs from 'node:fs';
import path from 'node:path';
import {
  executeHostTokenContract,
  HOST_ADAPTER_CONTRACT,
  PRODUCT_HOSTS,
} from '../host-portability/adapter-contract.mjs';
import {
  extractMarkdownLinks,
  findDuplicateHtmlAnchorIds,
  findHtmlNameAliasAnchors,
  inspectHtmlAnchorIds,
  isPortableAnchorId,
  normalizePointAnchor,
  splitLinkTarget,
} from '../host-portability/anchors.mjs';
import { compareCodePoint } from '../hash.mjs';
import {
  atlasDistPath,
  canonicalBindingToDistPath,
  entrySurfaceToDistPath,
  moduleAnchorId,
  moduleRouterDistPath,
} from './paths.mjs';

const FORBIDDEN_PATH_TOKEN_RE =
  /\$\{(?:CLAUDE_PLUGIN_ROOT|CLAUDE_SKILL_DIR|CODEX_PLUGIN_ROOT|PLUGIN_ROOT|PLUGIN_DATA|CURSOR_PLUGIN_ROOT|CURSOR_SKILL_DIR|KIMI_PLUGIN_ROOT|KIMI_SKILL_DIR|CC_MASTER_PLUGIN_ROOT)\}/;

function diagnostic({ code, message, location, witness, remediation, exitCode = 5 }) {
  return {
    severity: 'error',
    code,
    message,
    location,
    witness,
    remediation,
    exit_code: exitCode,
  };
}

function walkMarkdownFiles(root, { scopedRoots = null } = {}) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const roots = scopedRoots?.length
    ? scopedRoots.map((item) => path.join(root, item)).filter((item) => fs.existsSync(item))
    : [root];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(target);
    }
  };
  for (const start of roots) {
    if (fs.statSync(start).isFile()) {
      if (start.endsWith('.md')) files.push(start);
    } else {
      visit(start);
    }
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

function displayPath(payloadRoot, absolute) {
  return path.relative(payloadRoot, absolute).split(path.sep).join('/') || '.';
}

function tryRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function isInsideRoot(candidateReal, rootReal) {
  return candidateReal === rootReal || candidateReal.startsWith(rootReal + path.sep);
}

function nodeKey(kind, id) {
  if (typeof id === 'string' && id.includes(':')) return id;
  return `${kind}:${id}`;
}

/**
 * Parse a projected host payload and count only real clickable relative links
 * whose fragments resolve to portable explicit HTML anchors.
 * Reuses host-portability parsers; does not invent a second link/anchor grammar.
 */
export function countEnabledRuntimeEdges({
  host,
  payloadRoot,
  repoRoot,
  mode = 'canonical',
  scopedRoots = null,
}) {
  const diagnostics = [];
  const absolutePayload = path.resolve(payloadRoot);

  if (!PRODUCT_HOSTS.includes(host)) {
    diagnostics.push(
      diagnostic({
        code: 'SKG-HOST-UNKNOWN',
        message: `Unknown product host "${host}"`,
        location: 'host',
        witness: { host, product_hosts: [...PRODUCT_HOSTS] },
        remediation: 'Use one of claude-code / codex / cursor / kimi-code.',
        exitCode: 2,
      }),
    );
    return emptyResult(host, mode, diagnostics);
  }

  const tokenContract = executeHostTokenContract(host);
  if (!tokenContract.ok) diagnostics.push(...tokenContract.diagnostics);

  const executedChecks = [
    ...tokenContract.executed_checks,
    'relative-links',
    'explicit-html-id-anchors',
    'realpath-path-containment',
    'final-surface-reparse',
  ];

  if (!fs.existsSync(absolutePayload) || !fs.statSync(absolutePayload).isDirectory()) {
    diagnostics.push(
      diagnostic({
        code: 'SKG-HOST-PAYLOAD-MISSING',
        message: `Payload root does not exist: ${payloadRoot}`,
        location: String(payloadRoot),
        witness: { payload_root: payloadRoot, repo_root: repoRoot },
        remediation: 'Point the verifier at plugin/dist/<host> or a temp payload tree.',
      }),
    );
    return emptyResult(host, mode, diagnostics, executedChecks);
  }

  const payloadReal = tryRealpath(absolutePayload);
  if (!payloadReal) {
    diagnostics.push(
      diagnostic({
        code: 'SKG-HOST-PAYLOAD-MISSING',
        message: `Payload root realpath unavailable: ${payloadRoot}`,
        location: String(payloadRoot),
        witness: { payload_root: payloadRoot },
        remediation: 'Ensure the payload root is a real directory.',
      }),
    );
    return emptyResult(host, mode, diagnostics, executedChecks);
  }

  const profile = HOST_ADAPTER_CONTRACT.hosts[host];
  const files = walkMarkdownFiles(absolutePayload, { scopedRoots });
  const anchorsByFile = new Map();
  const enabledEdges = [];
  let pointAnchorCount = 0;

  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8');
    const relative = displayPath(absolutePayload, file);
    const inspection = inspectHtmlAnchorIds(markdown);
    if (inspection.malformed) {
      diagnostics.push(
        diagnostic({
          code: 'SKG-HOST-ANCHOR-MALFORMED',
          message: 'Malformed <a> start tag; fail closed for this Markdown unit',
          location: relative,
          witness: { host, mode, anchor_form: HOST_ADAPTER_CONTRACT.anchor_form },
          remediation: 'Close quoted attributes on <a> tags.',
        }),
      );
    }
    const anchors = inspection.ids;
    anchorsByFile.set(file, new Set(anchors));

    for (const alias of findHtmlNameAliasAnchors(markdown)) {
      diagnostics.push(
        diagnostic({
          code: 'SKG-HOST-ANCHOR-NAME-ALIAS',
          message: `Anchor name alias is forbidden: name="${alias}"`,
          location: relative,
          witness: { host, mode, alias },
          remediation: 'Replace <a name="…"> with <a id="ccm-k-…">.',
        }),
      );
    }

    for (const duplicate of findDuplicateHtmlAnchorIds(markdown)) {
      diagnostics.push(
        diagnostic({
          code: 'SKG-HOST-ANCHOR-DUPLICATE',
          message: `Duplicate explicit HTML id "${duplicate.id}"`,
          location: relative,
          witness: { host, mode, id: duplicate.id, count: duplicate.count },
          remediation: 'Keep portable anchor ids unique within each Markdown file.',
        }),
      );
    }

    for (const anchor of anchors) {
      if (anchor.startsWith('ccm-k-point-')) {
        pointAnchorCount += 1;
        if (mode === 'stub') {
          diagnostics.push(
            diagnostic({
              code: 'SKG-HOST-STUB-FALSE-COVERAGE',
              message: `Stub payload claims point coverage via portable anchor "${anchor}"`,
              location: relative,
              witness: { host, mode, anchor },
              remediation: 'Remove point anchors from stub payloads.',
            }),
          );
        } else if (!isPortableAnchorId(anchor)) {
          diagnostics.push(
            diagnostic({
              code: 'SKG-HOST-ANCHOR-UNVERIFIABLE',
              message: `Non-portable point anchor "${anchor}"`,
              location: relative,
              witness: { host, mode, anchor },
              remediation: 'Emit explicit ccm-k-* anchors via normalizePointAnchor().',
            }),
          );
        }
      } else if (anchor.startsWith('ccm-k-') && !isPortableAnchorId(anchor)) {
        diagnostics.push(
          diagnostic({
            code: 'SKG-HOST-ANCHOR-UNVERIFIABLE',
            message: `Arbitrary ccm-k fragment/id is not portable: "${anchor}"`,
            location: relative,
            witness: { host, mode, anchor },
            remediation: 'Use normalizePointAnchor() / ccm-k-(point|module|skill)-… ids only.',
          }),
        );
      }
    }

    if (FORBIDDEN_PATH_TOKEN_RE.test(markdown)) {
      const relativePosix = relative.split(path.sep).join('/');
      const inKnowledge = relativePosix === 'knowledge' || relativePosix.startsWith('knowledge/');
      // Skill/command bodies may still contain host path tokens outside generated nav blocks.
      // Knowledge routers must stay token-free.
      if (inKnowledge) {
        const token = markdown.match(FORBIDDEN_PATH_TOKEN_RE)?.[0];
        diagnostics.push(
          diagnostic({
            code: 'SKG-HOST-PATH-TOKEN-FORBIDDEN',
            message: `Knowledge navigation must not depend on host path token ${token}`,
            location: relative,
            witness: {
              host,
              mode,
              token,
              path_policy: HOST_ADAPTER_CONTRACT.path_policy,
              profile: profile.path_tokens,
            },
            remediation: 'Use relative final-host paths for knowledge links.',
          }),
        );
      }
    }

    for (const link of extractMarkdownLinks(markdown)) {
      // Outside knowledge/, when compiling a host dist, only generated nav/entry-pin links
      // count. Fixture probes (scopedRoots == null) still scan every relative link.
      const relativePosix = relative.split(path.sep).join('/');
      const inKnowledge = relativePosix === 'knowledge' || relativePosix.startsWith('knowledge/');
      if (scopedRoots != null && !inKnowledge) {
        const inGenerated = [
          ...markdown.matchAll(
            /<!--\s*ccm:k:(?:nav:start|entry-pin:start)[\s\S]*?<!--\s*ccm:k:(?:nav:end|entry-pin:end)\s*-->/g,
          ),
        ].some((match) => {
          const start = match.index ?? 0;
          return link.index >= start && link.index < start + match[0].length;
        });
        if (!inGenerated) continue;
      }

      const { path: linkPath, fragment } = splitLinkTarget(link.target);
      if (/^[a-z][a-z0-9+.-]*:/i.test(link.target) || link.target.startsWith('//')) {
        diagnostics.push(
          diagnostic({
            code: 'SKG-HOST-LINK-SCHEME-FORBIDDEN',
            message: `External or schemed link is outside relative path policy: ${link.target}`,
            location: relative,
            witness: { host, mode, target: link.target },
            remediation: 'Use relative paths under the payload root.',
          }),
        );
        continue;
      }
      if (linkPath.startsWith('/')) {
        diagnostics.push(
          diagnostic({
            code: 'SKG-HOST-PATH-TOKEN-FORBIDDEN',
            message: `Absolute link path is forbidden: ${link.target}`,
            location: relative,
            witness: { host, mode, target: link.target },
            remediation: 'Rewrite to a relative path from the final host Markdown file.',
          }),
        );
        continue;
      }

      if (fragment && !isPortableAnchorId(fragment)) {
        diagnostics.push(
          diagnostic({
            code: 'SKG-HOST-ANCHOR-UNVERIFIABLE',
            message: `Fragment "#${fragment}" is not a portable explicit HTML anchor`,
            location: relative,
            witness: {
              host,
              mode,
              target: link.target,
              claim: HOST_ADAPTER_CONTRACT.claims.heading_autogenerated_slugs,
            },
            remediation:
              'Do not rely on heading auto-slugs; link to normalizePointAnchor() ids only.',
          }),
        );
        continue;
      }

      const resolved = path.resolve(path.dirname(file), linkPath || '.');
      const resolvedRelative = displayPath(absolutePayload, resolved);
      const resolvedReal = tryRealpath(resolved);
      if (!resolvedReal || !isInsideRoot(resolvedReal, payloadReal)) {
        diagnostics.push(
          diagnostic({
            code: 'SKG-HOST-LINK-TARGET-MISSING',
            message: `Relative link target missing or escapes payload: ${link.target}`,
            location: relative,
            witness: { host, mode, target: link.target, resolved: resolvedRelative },
            remediation: 'Fix the relative path or restore the missing Markdown file.',
          }),
        );
        continue;
      }
      if (!fs.existsSync(resolvedReal) || !fs.statSync(resolvedReal).isFile()) {
        diagnostics.push(
          diagnostic({
            code: 'SKG-HOST-LINK-TARGET-MISSING',
            message: `Relative link target missing: ${link.target}`,
            location: relative,
            witness: { host, mode, target: link.target, resolved: resolvedRelative },
            remediation: 'Fix the relative path or restore the missing Markdown file.',
          }),
        );
        continue;
      }

      if (fragment) {
        let targetAnchors = anchorsByFile.get(resolvedReal);
        if (!targetAnchors) {
          const targetMarkdown = fs.readFileSync(resolvedReal, 'utf8');
          const targetInspection = inspectHtmlAnchorIds(targetMarkdown);
          if (targetInspection.malformed) {
            diagnostics.push(
              diagnostic({
                code: 'SKG-HOST-ANCHOR-MALFORMED',
                message: 'Malformed <a> start tag in link target Markdown',
                location: relative,
                witness: { host, mode, target: link.target, resolved: resolvedRelative },
                remediation: 'Close quoted attributes in the destination file.',
              }),
            );
            continue;
          }
          targetAnchors = new Set(targetInspection.ids);
          anchorsByFile.set(resolvedReal, targetAnchors);
        }
        if (!targetAnchors.has(fragment)) {
          diagnostics.push(
            diagnostic({
              code: 'SKG-HOST-ANCHOR-UNVERIFIABLE',
              message: `Fragment "#${fragment}" is not present as an explicit HTML anchor`,
              location: relative,
              witness: {
                host,
                mode,
                target: link.target,
                resolved: resolvedRelative,
                available_anchors: [...targetAnchors].sort(),
              },
              remediation: 'Add <a id="ccm-k-..."></a> at the destination or fix the fragment.',
            }),
          );
          continue;
        }
      }

      // Only fragment links to portable anchors count as enabled runtime edges.
      // File-only links to atlas/modules still count when no fragment (traversal surface entry).
      if (!fragment || isPortableAnchorId(fragment)) {
        enabledEdges.push({
          from_file: relative,
          to_file: resolvedRelative,
          fragment: fragment ?? null,
          text: link.text,
          index: link.index,
        });
      }
    }
  }

  const errors = diagnostics.filter((item) => item.severity === 'error').length;
  return {
    ok: errors === 0,
    host,
    mode,
    payload_root: path.relative(repoRoot, absolutePayload).split(path.sep).join('/') || '.',
    claims_point_coverage: mode !== 'stub' && pointAnchorCount > 0,
    executed_checks: executedChecks,
    enabled_edges: mode === 'stub' ? 0 : enabledEdges.length,
    enabled_edge_list: mode === 'stub' ? [] : enabledEdges,
    point_anchors: pointAnchorCount,
    summary: {
      files: files.length,
      point_anchors: pointAnchorCount,
      resolved_links: mode === 'stub' ? 0 : enabledEdges.length,
      errors,
    },
    diagnostics,
    host_profile: {
      worker_eligible: profile.worker_eligible,
      path_tokens: profile.path_tokens,
      evidence: profile.evidence,
    },
  };
}

function emptyResult(host, mode, diagnostics, executedChecks = []) {
  return {
    ok: false,
    host,
    mode,
    payload_root: null,
    claims_point_coverage: false,
    executed_checks: executedChecks,
    enabled_edges: 0,
    enabled_edge_list: [],
    point_anchors: 0,
    summary: { files: 0, point_anchors: 0, resolved_links: 0, errors: diagnostics.length },
    diagnostics,
    host_profile: null,
  };
}

function bfs(adjacency, from, to) {
  if (from === to) return { reachable: true, hops: 0, nodes: [from] };
  const queue = [from];
  const prev = new Map([[from, null]]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, current);
      if (next === to) {
        const nodes = [to];
        let cursor = to;
        while (prev.get(cursor) !== null) {
          cursor = prev.get(cursor);
          nodes.push(cursor);
        }
        nodes.reverse();
        return { reachable: true, hops: nodes.length - 1, nodes };
      }
      queue.push(next);
    }
  }
  return { reachable: false, hops: null, nodes: [] };
}

function hostRelativeToDistPath(host, relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (normalized.startsWith('plugin/dist/')) return normalized;
  return `plugin/dist/${host}/${normalized}`;
}

function distPathToHostRelative(host, distPath) {
  const prefix = `plugin/dist/${host}/`;
  const normalized = distPath.split(path.sep).join('/');
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

/**
 * Resolve a link target to a graph node only when fragment + file path both bind.
 * Returns { node } on success, or { diagnostic } — never silently skips.
 */
function resolveTargetNode(host, relativePath, fragment, graph) {
  const normalized = relativePath.split(path.sep).join('/');
  const fullPath = hostRelativeToDistPath(host, normalized);

  if (fragment && fragment.startsWith('ccm-k-point-')) {
    let matchedPoint = null;
    for (const point of graph.points) {
      const anchor = normalizePointAnchor(point.id);
      if (anchor.html_id === fragment) {
        matchedPoint = point;
        break;
      }
    }
    if (!matchedPoint) {
      return {
        diagnostic: diagnostic({
          code: 'SKG-SURFACE-TARGET-UNRESOLVED',
          message: `Point fragment "#${fragment}" does not match any authored point`,
          location: normalized,
          witness: { host, fragment, path: fullPath },
          remediation: 'Link only to normalizePointAnchor() ids for accepted points.',
        }),
      };
    }
    const expected = canonicalBindingToDistPath(host, matchedPoint.binding.path);
    if (!expected || expected !== fullPath) {
      return {
        diagnostic: diagnostic({
          code: 'SKG-SURFACE-BINDING-MISMATCH',
          message: `Point ${matchedPoint.id} target must resolve to binding path, not ${normalized}`,
          location: normalized,
          witness: {
            host,
            point: matchedPoint.id,
            fragment,
            actual_path: fullPath,
            expected_path: expected,
          },
          remediation:
            'Keep point anchors and inbound links on canonicalBindingToDistPath(host, point.binding.path).',
        }),
      };
    }
    return { node: nodeKey('point', matchedPoint.id) };
  }

  if (fragment && fragment.startsWith('ccm-k-module-')) {
    let matchedModule = null;
    for (const module of graph.modules) {
      if (moduleAnchorId(module.id) === fragment) {
        matchedModule = module;
        break;
      }
    }
    if (!matchedModule) {
      return {
        diagnostic: diagnostic({
          code: 'SKG-SURFACE-TARGET-UNRESOLVED',
          message: `Module fragment "#${fragment}" does not match any authored module`,
          location: normalized,
          witness: { host, fragment, path: fullPath },
          remediation: 'Link only to moduleAnchorId() on the matching module router.',
        }),
      };
    }
    const expected = moduleRouterDistPath(host, matchedModule.id);
    if (expected !== fullPath) {
      return {
        diagnostic: diagnostic({
          code: 'SKG-SURFACE-BINDING-MISMATCH',
          message: `Module ${matchedModule.id} anchor may only live on its router file`,
          location: normalized,
          witness: {
            host,
            module: matchedModule.id,
            fragment,
            actual_path: fullPath,
            expected_path: expected,
          },
          remediation: 'Place module anchors only in moduleRouterDistPath(host, module.id).',
        }),
      };
    }
    return { node: nodeKey('module', matchedModule.id) };
  }

  const atlasExpected = atlasDistPath(host);
  if (fullPath === atlasExpected && !fragment) {
    return { node: nodeKey('atlas', 'knowledge-atlas') };
  }
  if (fullPath === atlasExpected && fragment) {
    return {
      diagnostic: diagnostic({
        code: 'SKG-SURFACE-TARGET-UNRESOLVED',
        message: `Atlas target has unexpected fragment "#${fragment}"`,
        location: normalized,
        witness: { host, fragment, path: fullPath },
        remediation:
          'Atlas file links use no fragment; module/point fragments bind to their own files.',
      }),
    };
  }

  for (const module of graph.modules) {
    const expected = moduleRouterDistPath(host, module.id);
    if (fullPath === expected && !fragment) {
      return { node: nodeKey('module', module.id) };
    }
  }

  return {
    diagnostic: diagnostic({
      code: 'SKG-SURFACE-TARGET-UNRESOLVED',
      message: `Cannot resolve link target ${normalized}${fragment ? `#${fragment}` : ''}`,
      location: normalized,
      witness: { host, fragment: fragment ?? null, path: fullPath },
      remediation: 'Use atlas/module/point binding paths with matching portable fragments.',
    }),
  };
}

/**
 * Resolve a link source to a graph node with binding-path checks.
 * Returns { node } on success, or { diagnostic } — never silently skips.
 */
function resolveSourceNode(host, relativePath, markdown, linkIndex, graph) {
  const normalized = relativePath.split(path.sep).join('/');
  const fullPath = hostRelativeToDistPath(host, normalized);

  const navBlocks = [
    ...markdown.matchAll(
      /<!--\s*ccm:k:nav:start\s+(point:[a-z0-9][a-z0-9.-]*)\s*-->[\s\S]*?<!--\s*ccm:k:nav:end\s*-->/g,
    ),
  ];
  for (const match of navBlocks) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (linkIndex >= start && linkIndex < end) {
      const pointId = match[1];
      const point = graph.points.find((item) => item.id === pointId);
      if (!point) {
        return {
          diagnostic: diagnostic({
            code: 'SKG-SURFACE-SOURCE-UNRESOLVED',
            message: `Nav block references unknown point ${pointId}`,
            location: normalized,
            witness: { host, point: pointId, path: fullPath },
            remediation: 'Emit nav blocks only for accepted authored points.',
          }),
        };
      }
      const expected = canonicalBindingToDistPath(host, point.binding.path);
      if (!expected || expected !== fullPath) {
        return {
          diagnostic: diagnostic({
            code: 'SKG-SURFACE-BINDING-MISMATCH',
            message: `Point ${pointId} nav source must be its binding file`,
            location: normalized,
            witness: {
              host,
              point: pointId,
              actual_path: fullPath,
              expected_path: expected,
            },
            remediation:
              'Keep point nav blocks on canonicalBindingToDistPath(host, point.binding.path).',
          }),
        };
      }
      return { node: nodeKey('point', pointId) };
    }
  }

  const entryBlocks = [
    ...markdown.matchAll(
      /<!--\s*ccm:k:entry-pin:start\s*-->[\s\S]*?<!--\s*ccm:k:entry-pin:end\s*-->/g,
    ),
  ];
  for (const match of entryBlocks) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (linkIndex >= start && linkIndex < end) {
      let matchedEntry = null;
      for (const entry of graph.entries ?? []) {
        for (const surface of entry.surfaces ?? []) {
          if (surface.host !== host) continue;
          const expected = entrySurfaceToDistPath(host, surface.source_file);
          if (expected === fullPath) {
            matchedEntry = entry;
            break;
          }
        }
        if (matchedEntry) break;
      }
      if (!matchedEntry) {
        return {
          diagnostic: diagnostic({
            code: 'SKG-SURFACE-BINDING-MISMATCH',
            message: `Entry pin block is not on the authored entry surface for ${host}`,
            location: normalized,
            witness: { host, path: fullPath },
            remediation:
              'Emit entry pins only on entrySurfaceToDistPath for the matching host surface.',
          }),
        };
      }
      return { node: nodeKey('entry', matchedEntry.id) };
    }
  }

  if (fullPath === atlasDistPath(host)) {
    return { node: nodeKey('atlas', 'knowledge-atlas') };
  }
  for (const module of graph.modules) {
    if (fullPath === moduleRouterDistPath(host, module.id)) {
      return { node: nodeKey('module', module.id) };
    }
  }

  return {
    diagnostic: diagnostic({
      code: 'SKG-SURFACE-SOURCE-UNRESOLVED',
      message: `Cannot resolve link source in ${normalized}`,
      location: normalized,
      witness: { host, path: fullPath, link_index: linkIndex },
      remediation: 'Place links in atlas / module routers / point nav / entry pin surfaces only.',
    }),
  };
}

/**
 * Scan projected Markdown for misplaced / duplicate point|module anchors.
 */
function validateAnchorPlacements({ host, graph, surface, repoRoot, diagnostics }) {
  const payloadRoot = path.join(repoRoot, 'plugin/dist', host);
  const seenPointAnchors = new Map();
  const seenModuleAnchors = new Map();

  const files = new Set();
  for (const edge of surface.enabled_edge_list ?? []) {
    files.add(edge.from_file.split(path.sep).join('/'));
    files.add(edge.to_file.split(path.sep).join('/'));
  }
  files.add(distPathToHostRelative(host, atlasDistPath(host)));
  for (const module of graph.modules) {
    files.add(distPathToHostRelative(host, moduleRouterDistPath(host, module.id)));
  }
  for (const point of graph.points) {
    const expected = canonicalBindingToDistPath(host, point.binding.path);
    if (expected) files.add(distPathToHostRelative(host, expected));
  }

  for (const relative of [...files].sort()) {
    const absolute = path.join(payloadRoot, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const markdown = fs.readFileSync(absolute, 'utf8');
    const inspection = inspectHtmlAnchorIds(markdown);
    const fullPath = hostRelativeToDistPath(host, relative);

    for (const anchorId of inspection.ids) {
      if (anchorId.startsWith('ccm-k-point-')) {
        const point = graph.points.find(
          (item) => normalizePointAnchor(item.id).html_id === anchorId,
        );
        if (!point) {
          diagnostics.push(
            diagnostic({
              code: 'SKG-SURFACE-ANCHOR-MISPLACED',
              message: `Unknown point anchor "${anchorId}" in ${relative}`,
              location: relative,
              witness: { host, anchor: anchorId, path: fullPath },
              remediation: 'Remove anchors that do not map to an authored point.',
            }),
          );
          continue;
        }
        const expected = canonicalBindingToDistPath(host, point.binding.path);
        if (expected !== fullPath) {
          diagnostics.push(
            diagnostic({
              code: 'SKG-SURFACE-BINDING-MISMATCH',
              message: `Point ${point.id} anchor appears outside its binding file`,
              location: relative,
              witness: {
                host,
                point: point.id,
                anchor: anchorId,
                actual_path: fullPath,
                expected_path: expected,
              },
              remediation:
                'Emit point anchors only at canonicalBindingToDistPath(host, point.binding.path).',
            }),
          );
        }
        if (seenPointAnchors.has(anchorId) && seenPointAnchors.get(anchorId) !== fullPath) {
          diagnostics.push(
            diagnostic({
              code: 'SKG-SURFACE-ANCHOR-MISPLACED',
              message: `Duplicate point anchor "${anchorId}" across files`,
              location: relative,
              witness: {
                host,
                anchor: anchorId,
                paths: [seenPointAnchors.get(anchorId), fullPath],
              },
              remediation: 'Keep each point html id unique and only on its binding file.',
            }),
          );
        } else {
          seenPointAnchors.set(anchorId, fullPath);
        }
      } else if (anchorId.startsWith('ccm-k-module-')) {
        const module = graph.modules.find((item) => moduleAnchorId(item.id) === anchorId);
        if (!module) {
          diagnostics.push(
            diagnostic({
              code: 'SKG-SURFACE-ANCHOR-MISPLACED',
              message: `Unknown module anchor "${anchorId}" in ${relative}`,
              location: relative,
              witness: { host, anchor: anchorId, path: fullPath },
              remediation: 'Remove module anchors that do not map to an authored module.',
            }),
          );
          continue;
        }
        const expected = moduleRouterDistPath(host, module.id);
        if (expected !== fullPath) {
          diagnostics.push(
            diagnostic({
              code: 'SKG-SURFACE-BINDING-MISMATCH',
              message: `Module ${module.id} anchor appears outside its router`,
              location: relative,
              witness: {
                host,
                module: module.id,
                anchor: anchorId,
                actual_path: fullPath,
                expected_path: expected,
              },
              remediation: 'Emit module anchors only in moduleRouterDistPath(host, module.id).',
            }),
          );
        }
        if (seenModuleAnchors.has(anchorId) && seenModuleAnchors.get(anchorId) !== fullPath) {
          diagnostics.push(
            diagnostic({
              code: 'SKG-SURFACE-ANCHOR-MISPLACED',
              message: `Duplicate module anchor "${anchorId}" across files`,
              location: relative,
              witness: {
                host,
                anchor: anchorId,
                paths: [seenModuleAnchors.get(anchorId), fullPath],
              },
              remediation: 'Keep each module html id unique and only on its router file.',
            }),
          );
        } else {
          seenModuleAnchors.set(anchorId, fullPath);
        }
      }
    }
  }
}

/**
 * Verify H1–H4 against the enabled runtime edge list + authored graph metadata.
 * Binding paths are part of identity: fragment-only matches are rejected.
 */
export function verifyHopContracts({ host, graph, surface, repoRoot }) {
  const diagnostics = [];
  const hopPolicy = graph.portfolio?.hop_policy ?? {};
  const adjacency = new Map();
  const ensure = (id) => {
    if (!adjacency.has(id)) adjacency.set(id, new Set());
  };

  const payloadRoot = path.join(repoRoot, 'plugin/dist', host);
  const markdownCache = new Map();
  const readMarkdown = (relative) => {
    if (markdownCache.has(relative)) return markdownCache.get(relative);
    const absolute = path.join(payloadRoot, relative);
    const text = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
    markdownCache.set(relative, text);
    return text;
  };

  validateAnchorPlacements({ host, graph, surface, repoRoot, diagnostics });

  for (const edge of surface.enabled_edge_list ?? []) {
    const fromRel = edge.from_file.split(path.sep).join('/');
    const toRel = edge.to_file.split(path.sep).join('/');
    const markdown = readMarkdown(fromRel);
    const linkIndex = typeof edge.index === 'number' ? edge.index : 0;
    const fromResolved = resolveSourceNode(host, fromRel, markdown, linkIndex, graph);
    const toResolved = resolveTargetNode(host, toRel, edge.fragment, graph);
    if (fromResolved.diagnostic) diagnostics.push(fromResolved.diagnostic);
    if (toResolved.diagnostic) diagnostics.push(toResolved.diagnostic);
    if (!fromResolved.node || !toResolved.node) continue;
    ensure(fromResolved.node);
    ensure(toResolved.node);
    adjacency.get(fromResolved.node).add(toResolved.node);
  }

  const surfaceOk = !diagnostics.some((item) =>
    String(item.code).startsWith('SKG-SURFACE-'),
  );

  for (const point of graph.points) ensure(nodeKey('point', point.id));
  ensure(nodeKey('atlas', 'knowledge-atlas'));
  for (const module of graph.modules) ensure(nodeKey('module', module.id));
  for (const entry of graph.entries ?? []) ensure(nodeKey('entry', entry.id));

  const pointNodes = graph.points.map((point) => nodeKey('point', point.id));

  // H1: exactly one point-reachable SCC (paths may traverse atlas/module).
  const reach = new Map();
  for (const from of pointNodes) {
    const reachable = new Set();
    for (const to of pointNodes) {
      if (bfs(adjacency, from, to).reachable) reachable.add(to);
    }
    reach.set(from, reachable);
  }
  const remaining = new Set(pointNodes);
  const sccs = [];
  for (const seed of pointNodes) {
    if (!remaining.has(seed)) continue;
    const component = [...remaining].filter(
      (other) => reach.get(seed)?.has(other) && reach.get(other)?.has(seed),
    );
    for (const member of component) remaining.delete(member);
    sccs.push(component.sort(compareCodePoint));
  }
  const h1Ok = sccs.length === 1 && sccs[0].length === pointNodes.length;
  if (!h1Ok) {
    diagnostics.push(
      diagnostic({
        code: 'SKG-HOP-H1',
        message: `H1 failed: expected one point-reachable SCC, found ${sccs.length}`,
        location: `plugin/dist/${host}`,
        witness: { host, scc_count: sccs.length, sccs },
        remediation:
          'Ensure every accepted point can reach every other via atlas/module/authored nav links.',
        exitCode: 6,
      }),
    );
  }

  // H2: point→point directed diameter ≤ 3
  let diameter = 0;
  let diameterWitness = null;
  let unreachablePair = null;
  for (const from of pointNodes) {
    for (const to of pointNodes) {
      if (from === to) continue;
      const pathResult = bfs(adjacency, from, to);
      if (!pathResult.reachable) {
        unreachablePair = { from, to };
        diameter = Infinity;
        break;
      }
      if (pathResult.hops > diameter) {
        diameter = pathResult.hops;
        diameterWitness = pathResult;
      }
    }
    if (!Number.isFinite(diameter)) break;
  }
  const h2Max = hopPolicy.point_diameter_max ?? 3;
  const h2Ok = Number.isFinite(diameter) && diameter <= h2Max;
  if (!h2Ok) {
    diagnostics.push(
      diagnostic({
        code: 'SKG-HOP-H2',
        message: `H2 failed: point diameter ${Number.isFinite(diameter) ? diameter : 'unreachable'} > ${h2Max}`,
        location: `plugin/dist/${host}`,
        witness: { host, diameter, max: h2Max, unreachable: unreachablePair, path: diameterWitness },
        remediation: 'Add atlas/module return links or shorten authored nav routes.',
        exitCode: 6,
      }),
    );
  }

  // H3: entry → expected point ≤ entry_discovery_max
  const h3Max = hopPolicy.entry_discovery_max ?? 3;
  const h3Witnesses = [];
  let h3Ok = true;
  for (const entry of graph.entries ?? []) {
    const entryNode = nodeKey('entry', entry.id);
    for (const surface of entry.surfaces ?? []) {
      if (surface.host !== host) continue;
      for (const target of surface.targets ?? []) {
        const to = nodeKey('point', target.point);
        const pathResult = bfs(adjacency, entryNode, to);
        h3Witnesses.push({
          entry: entry.id,
          point: target.point,
          hops: pathResult.hops,
          nodes: pathResult.nodes,
          reachable: pathResult.reachable,
        });
        if (!pathResult.reachable || pathResult.hops > h3Max) {
          h3Ok = false;
          diagnostics.push(
            diagnostic({
              code: 'SKG-HOP-H3',
              message: `H3 failed: entry discovery ${entry.id} → ${target.point}`,
              location: `plugin/dist/${host}`,
              witness: { host, entry: entry.id, point: target.point, path: pathResult, max: h3Max },
              remediation: 'Emit a real relative pin link from the projected entry surface to the point.',
              exitCode: 6,
            }),
          );
        }
      }
    }
  }

  // H4: critical/primary access SLO
  let h4Ok = true;
  const h4Witnesses = [];
  for (const module of graph.modules) {
    const access = module.access ?? {};
    const primaryPoints = access.primary_points ?? [];
    const relevantEntries = access.relevant_entries ?? [];
    const entryMax =
      access.class === 'critical'
        ? hopPolicy.critical_entry_to_primary_max ?? 1
        : access.class === 'primary'
          ? hopPolicy.primary_entry_to_primary_max ?? 2
          : h3Max;
    const anyPointMax =
      access.class === 'critical'
        ? hopPolicy.critical_any_point_to_primary_max ?? 2
        : h2Max;

    for (const primaryId of primaryPoints) {
      const primaryNode = nodeKey('point', primaryId);
      for (const entryId of relevantEntries) {
        const pathResult = bfs(adjacency, nodeKey('entry', entryId), primaryNode);
        h4Witnesses.push({
          kind: 'entry_to_primary',
          module: module.id,
          entry: entryId,
          primary: primaryId,
          hops: pathResult.hops,
          reachable: pathResult.reachable,
        });
        if (!pathResult.reachable || pathResult.hops > entryMax) {
          h4Ok = false;
          diagnostics.push(
            diagnostic({
              code: 'SKG-HOP-H4',
              message: `H4 failed: ${access.class} entry→primary ${entryId} → ${primaryId}`,
              location: `plugin/dist/${host}`,
              witness: {
                host,
                module: module.id,
                class: access.class,
                entry: entryId,
                primary: primaryId,
                path: pathResult,
                max: entryMax,
              },
              remediation: 'Pin critical/primary points directly from relevant entry surfaces.',
              exitCode: 6,
            }),
          );
        }
      }
      if (access.class === 'critical') {
        for (const point of graph.points) {
          const pathResult = bfs(adjacency, nodeKey('point', point.id), primaryNode);
          h4Witnesses.push({
            kind: 'any_point_to_primary',
            module: module.id,
            from: point.id,
            primary: primaryId,
            hops: pathResult.hops,
            reachable: pathResult.reachable,
          });
          if (!pathResult.reachable || pathResult.hops > anyPointMax) {
            h4Ok = false;
            diagnostics.push(
              diagnostic({
                code: 'SKG-HOP-H4',
                message: `H4 failed: any-point→critical primary ${point.id} → ${primaryId}`,
                location: `plugin/dist/${host}`,
                witness: {
                  host,
                  from: point.id,
                  primary: primaryId,
                  path: pathResult,
                  max: anyPointMax,
                },
                remediation: 'Ensure atlas/module routes keep critical primaries within 2 hops.',
                exitCode: 6,
              }),
            );
          }
        }
      }
    }
  }

  const budgets = {
    atlas_path: atlasDistPath(host),
    module_paths: graph.modules.map((module) => moduleRouterDistPath(host, module.id)),
  };

  const hopReport = {
    H1: {
      ok: h1Ok,
      witness: { scc_count: sccs.length, scc: sccs[0] ?? [] },
      remediation: h1Ok
        ? 'Point-reachable SCC is exactly one.'
        : 'Repair navigation so all accepted points mutually reach via real links.',
    },
    H2: {
      ok: h2Ok,
      witness: {
        diameter: Number.isFinite(diameter) ? diameter : null,
        max: h2Max,
        path: diameterWitness,
        unreachable: unreachablePair,
      },
      remediation: h2Ok
        ? `Point diameter ${diameter} ≤ ${h2Max}.`
        : 'Shorten routes or restore atlas/module traversal links.',
    },
    H3: {
      ok: h3Ok,
      witness: { max: h3Max, paths: h3Witnesses },
      remediation: h3Ok
        ? 'Entry discovery distances satisfy the hop policy.'
        : 'Add real entry pin links on projected entry surfaces.',
    },
    H4: {
      ok: h4Ok,
      witness: { paths: h4Witnesses },
      remediation: h4Ok
        ? 'Critical/primary access SLOs hold.'
        : 'Tighten entry pins and atlas routes for critical/primary modules.',
    },
  };

  return {
    ok: diagnostics.length === 0,
    surface_ok: surfaceOk,
    hopReport,
    budgets,
    diagnostics,
    adjacency,
  };
}
