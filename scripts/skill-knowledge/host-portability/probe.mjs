import fs from 'node:fs';
import path from 'node:path';
import {
  executeHostTokenContract,
  HOST_ADAPTER_CONTRACT,
  PAYLOAD_MODES,
  PRODUCT_HOSTS,
} from './adapter-contract.mjs';
import {
  extractMarkdownLinks,
  findDuplicateHtmlAnchorIds,
  findHtmlNameAliasAnchors,
  inspectHtmlAnchorIds,
  isPortableAnchorId,
  splitLinkTarget,
} from './anchors.mjs';

const FORBIDDEN_PATH_TOKEN_RE =
  /\$\{(?:CLAUDE_PLUGIN_ROOT|CLAUDE_SKILL_DIR|CODEX_PLUGIN_ROOT|PLUGIN_ROOT|PLUGIN_DATA|CURSOR_PLUGIN_ROOT|CURSOR_SKILL_DIR|KIMI_PLUGIN_ROOT|KIMI_SKILL_DIR|CC_MASTER_PLUGIN_ROOT)\}/;

function diagnostic({ code, message, location, witness, remediation }) {
  return {
    severity: 'error',
    code,
    message,
    location,
    witness,
    remediation,
  };
}

function walkMarkdownFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
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
  visit(root);
  return files;
}

function displayPath(payloadRoot, absolute) {
  const relative = path.relative(payloadRoot, absolute).split(path.sep).join('/');
  return relative || '.';
}

function resolveLinkPath(fromFile, linkPath) {
  if (!linkPath || linkPath === '') return fromFile;
  return path.resolve(path.dirname(fromFile), linkPath);
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

/**
 * Deterministic host portability probe over a checked-in or temporary payload tree.
 * Does not claim live host click-through; only proves fixture link/anchor/path rules
 * against the frozen adapter contract, plus a host-specific token-contract execution.
 */
export function probeHostPayload({ host, mode, payloadRoot, repoRoot }) {
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
      }),
    );
    return failureResult({ host, mode, diagnostics });
  }

  if (!PAYLOAD_MODES.includes(mode)) {
    diagnostics.push(
      diagnostic({
        code: 'SKG-HOST-PAYLOAD-MODE-UNKNOWN',
        message: `Unknown payload mode "${mode}"`,
        location: 'mode',
        witness: { mode, payload_modes: [...PAYLOAD_MODES] },
        remediation: 'Use canonical, partial, or stub.',
      }),
    );
    return failureResult({ host, mode, diagnostics });
  }

  const profile = HOST_ADAPTER_CONTRACT.hosts[host];
  if (!profile) {
    diagnostics.push(
      diagnostic({
        code: 'SKG-HOST-UNKNOWN',
        message: `Host profile missing for "${host}"`,
        location: 'adapter-contract',
        witness: { host },
        remediation: 'Restore HOST_ADAPTER_CONTRACT.hosts entry.',
      }),
    );
    return failureResult({ host, mode, diagnostics });
  }

  const tokenContract = executeHostTokenContract(host);
  if (!tokenContract.ok) {
    diagnostics.push(...tokenContract.diagnostics);
  }
  const executedChecks = [
    ...tokenContract.executed_checks,
    'relative-links',
    'explicit-html-id-anchors',
    'realpath-path-containment',
  ];

  if (!fs.existsSync(absolutePayload) || !fs.statSync(absolutePayload).isDirectory()) {
    diagnostics.push(
      diagnostic({
        code: 'SKG-HOST-PAYLOAD-MISSING',
        message: `Payload root does not exist: ${payloadRoot}`,
        location: String(payloadRoot),
        witness: { payload_root: payloadRoot, repo_root: repoRoot },
        remediation: 'Point probeHostPayload at a checked-in fixture or temp payload tree.',
      }),
    );
    return failureResult({ host, mode, diagnostics, executedChecks });
  }

  const payloadReal = tryRealpath(absolutePayload);
  if (!payloadReal) {
    diagnostics.push(
      diagnostic({
        code: 'SKG-HOST-PAYLOAD-MISSING',
        message: `Payload root realpath unavailable: ${payloadRoot}`,
        location: String(payloadRoot),
        witness: { payload_root: payloadRoot },
        remediation: 'Ensure the payload root is a real directory, not a broken symlink.',
      }),
    );
    return failureResult({ host, mode, diagnostics, executedChecks });
  }

  const files = walkMarkdownFiles(absolutePayload);
  const anchorsByFile = new Map();
  let pointAnchorCount = 0;
  let resolvedLinks = 0;

  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8');
    const relative = displayPath(absolutePayload, file);
    const inspection = inspectHtmlAnchorIds(markdown);
    if (inspection.malformed) {
      diagnostics.push(
        diagnostic({
          code: 'SKG-HOST-ANCHOR-MALFORMED',
          message:
            'Malformed <a> start tag (unclosed quote or broken attributes); fail closed for this Markdown unit',
          location: relative,
          witness: { host, mode, anchor_form: HOST_ADAPTER_CONTRACT.anchor_form },
          remediation:
            'Close quoted attributes on <a> tags; do not rely on nested lookalike id text inside broken values.',
        }),
      );
    }
    const anchors = inspection.ids;
    anchorsByFile.set(file, new Set(anchors));

    for (const alias of findHtmlNameAliasAnchors(markdown)) {
      diagnostics.push(
        diagnostic({
          code: 'SKG-HOST-ANCHOR-NAME-ALIAS',
          message: `Anchor name alias is forbidden; require explicit HTML id only: name="${alias}"`,
          location: relative,
          witness: { host, mode, alias, anchor_form: HOST_ADAPTER_CONTRACT.anchor_form },
          remediation: 'Replace <a name="…"> with <a id="ccm-k-…"> matching the documented pattern.',
        }),
      );
    }

    for (const duplicate of findDuplicateHtmlAnchorIds(markdown)) {
      diagnostics.push(
        diagnostic({
          code: 'SKG-HOST-ANCHOR-DUPLICATE',
          message: `Duplicate explicit HTML id "${duplicate.id}" (${duplicate.count} times)`,
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
              remediation:
                'Remove point anchors from stub payloads; unsupported/stub must not claim coverage.',
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
            message: `Arbitrary ccm-k fragment/id is not the documented portable pattern: "${anchor}"`,
            location: relative,
            witness: { host, mode, anchor },
            remediation:
              'Use normalizePointAnchor() / ccm-k-(point|module|skill)-… ids only.',
          }),
        );
      }
    }

    if (FORBIDDEN_PATH_TOKEN_RE.test(markdown)) {
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
            rejected_fiction_tokens: profile.path_tokens.rejected_fiction_tokens,
          },
          remediation:
            'Use relative final-host paths for knowledge links; keep host tokens out of nav blocks.',
        }),
      );
    }

    for (const link of extractMarkdownLinks(markdown)) {
      const { path: linkPath, fragment } = splitLinkTarget(link.target);
      if (/^[a-z][a-z0-9+.-]*:/i.test(link.target) || link.target.startsWith('//')) {
        diagnostics.push(
          diagnostic({
            code: 'SKG-HOST-LINK-SCHEME-FORBIDDEN',
            message: `External or schemed link is outside the relative path policy: ${link.target}`,
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
            message: `Absolute link path is forbidden under relative-final-host-path policy: ${link.target}`,
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
              'Do not rely on heading auto-slugs or arbitrary ccm-k-* strings; link to normalizePointAnchor() ids only.',
          }),
        );
      }

      const resolved = resolveLinkPath(file, linkPath);
      const resolvedRelative = displayPath(absolutePayload, resolved);
      const resolvedReal = tryRealpath(resolved);

      if (!resolvedReal) {
        diagnostics.push(
          diagnostic({
            code: 'SKG-HOST-LINK-TARGET-MISSING',
            message: `Relative link target missing: ${link.target}`,
            location: relative,
            witness: { host, mode, target: link.target, resolved: resolvedRelative },
            remediation:
              mode === 'partial'
                ? 'Partial payloads may only link inside the real projected subset.'
                : 'Fix the relative path or restore the missing Markdown file.',
          }),
        );
        continue;
      }

      if (!isInsideRoot(resolvedReal, payloadReal)) {
        diagnostics.push(
          diagnostic({
            code: 'SKG-HOST-LINK-TARGET-MISSING',
            message: `Link escapes payload root via symlink/realpath: ${link.target}`,
            location: relative,
            witness: {
              host,
              mode,
              target: link.target,
              resolved: resolvedRelative,
              resolved_realpath: resolvedReal,
              payload_realpath: payloadReal,
            },
            remediation: 'Keep relative links inside the projected payload subset; deny symlink escapes.',
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
            remediation:
              mode === 'partial'
                ? 'Partial payloads may only link inside the real projected subset.'
                : 'Fix the relative path or restore the missing Markdown file.',
          }),
        );
        continue;
      }

      if (fragment) {
        let targetAnchors = anchorsByFile.get(resolvedReal);
        if (!targetAnchors) {
          // Prefer the lexical path when it stayed inside the payload; otherwise use realpath file.
          const targetPath = isInsideRoot(resolved, payloadReal) ? resolved : resolvedReal;
          const targetMarkdown = fs.readFileSync(
            fs.existsSync(targetPath) ? targetPath : resolvedReal,
            'utf8',
          );
          const targetInspection = inspectHtmlAnchorIds(targetMarkdown);
          if (targetInspection.malformed) {
            diagnostics.push(
              diagnostic({
                code: 'SKG-HOST-ANCHOR-MALFORMED',
                message:
                  'Malformed <a> start tag in link target Markdown; fail closed for fragment resolution',
                location: relative,
                witness: {
                  host,
                  mode,
                  target: link.target,
                  resolved: resolvedRelative,
                },
                remediation:
                  'Close quoted attributes on <a> tags in the destination file before linking fragments.',
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

      if (!fragment || isPortableAnchorId(fragment)) {
        resolvedLinks += 1;
      }
    }
  }

  const claimsPointCoverage = mode !== 'stub' && pointAnchorCount > 0;
  const errors = diagnostics.length;
  return {
    ok: errors === 0,
    host,
    mode,
    payload_root: path.relative(repoRoot, absolutePayload).split(path.sep).join('/') || '.',
    claims_point_coverage: claimsPointCoverage,
    executed_checks: executedChecks,
    summary: {
      files: files.length,
      point_anchors: pointAnchorCount,
      resolved_links: resolvedLinks,
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

function failureResult({ host, mode, diagnostics, executedChecks = [] }) {
  return {
    ok: false,
    host,
    mode,
    payload_root: null,
    claims_point_coverage: false,
    executed_checks: executedChecks,
    summary: {
      files: 0,
      point_anchors: 0,
      resolved_links: 0,
      errors: diagnostics.length,
    },
    diagnostics,
    host_profile: null,
  };
}

export function probeAllHostFixtures({ fixturesRoot, repoRoot }) {
  const results = [];
  for (const host of PRODUCT_HOSTS) {
    for (const mode of PAYLOAD_MODES) {
      results.push(
        probeHostPayload({
          host,
          mode,
          payloadRoot: path.join(fixturesRoot, 'payloads', mode),
          repoRoot,
        }),
      );
    }
  }
  return results;
}
