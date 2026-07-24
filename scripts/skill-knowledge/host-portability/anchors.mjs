const POINT_ID_RE = /^point:[a-z0-9][a-z0-9.-]*$/;
/** Exact documented portable id pattern: ccm-k-(point|module|skill)-… */
const PORTABLE_ANCHOR_RE = /^ccm-k-(?:point|module|skill)(?:-[a-z0-9]+)+$/;

/**
 * Normalize a point ID into a portable explicit HTML anchor.
 * Host differences in heading auto-slugs are unverifiable; knowledge surfaces
 * must emit this explicit form instead of relying on renderer slugification.
 */
export function normalizePointAnchor(pointId) {
  if (typeof pointId !== 'string' || !POINT_ID_RE.test(pointId)) {
    throw new Error(`fail closed: invalid point id for anchor normalization: ${pointId}`);
  }
  const htmlId = `ccm-k-${pointId.replaceAll(':', '-').replaceAll('.', '-')}`;
  if (!PORTABLE_ANCHOR_RE.test(htmlId)) {
    throw new Error(`fail closed: normalized anchor is not portable: ${htmlId}`);
  }
  return {
    source_id: pointId,
    html_id: htmlId,
    fragment: `#${htmlId}`,
    html: `<a id="${htmlId}"></a>`,
  };
}

export function isPortableAnchorId(value) {
  return typeof value === 'string' && PORTABLE_ANCHOR_RE.test(value);
}

function isHtmlWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/**
 * Quote-aware `<a …>` start-tag attribute scanner (Node stdlib only).
 * Smallest result contract:
 * - `{ kind: 'not-a-tag' }` — `<` is not an a start tag (caller advances by 1)
 * - `{ kind: 'malformed' }` — confirmed a-tag with broken quoting/structure
 * - `{ kind: 'ok', attrs, end }` — well-formed a start tag
 */
function parseAStartTagAttributes(markdown, startIndex) {
  const len = markdown.length;
  if (startIndex + 2 >= len) return { kind: 'not-a-tag' };
  if (markdown[startIndex] !== '<') return { kind: 'not-a-tag' };
  const tag0 = markdown[startIndex + 1];
  if (tag0 !== 'a' && tag0 !== 'A') return { kind: 'not-a-tag' };
  const afterTag = markdown[startIndex + 2];
  // `<a` must be followed by whitespace, `/`, or `>` — not `ab` / `article`.
  if (afterTag !== '/' && afterTag !== '>' && !isHtmlWhitespace(afterTag)) {
    return { kind: 'not-a-tag' };
  }

  let i = startIndex + 2;
  const attrs = [];

  while (i < len) {
    while (i < len && isHtmlWhitespace(markdown[i])) i += 1;
    if (i >= len) return { kind: 'malformed' };

    const ch = markdown[i];
    if (ch === '>') {
      return { kind: 'ok', attrs, end: i + 1 };
    }
    if (ch === '/') {
      i += 1;
      while (i < len && isHtmlWhitespace(markdown[i])) i += 1;
      if (i < len && markdown[i] === '>') {
        return { kind: 'ok', attrs, end: i + 1 };
      }
      return { kind: 'malformed' };
    }

    // Attribute name: stop at whitespace, =, /, >, quotes, or `<`.
    const nameStart = i;
    while (i < len) {
      const c = markdown[i];
      if (
        isHtmlWhitespace(c) ||
        c === '=' ||
        c === '/' ||
        c === '>' ||
        c === '"' ||
        c === "'" ||
        c === '<'
      ) {
        break;
      }
      i += 1;
    }
    if (i === nameStart) return { kind: 'malformed' };
    const name = markdown.slice(nameStart, i).toLowerCase();

    while (i < len && isHtmlWhitespace(markdown[i])) i += 1;
    if (i >= len) return { kind: 'malformed' };

    let value = '';
    if (markdown[i] === '=') {
      i += 1;
      while (i < len && isHtmlWhitespace(markdown[i])) i += 1;
      if (i >= len) return { kind: 'malformed' };

      const q = markdown[i];
      if (q === '"' || q === "'") {
        i += 1;
        const valueStart = i;
        while (i < len && markdown[i] !== q) i += 1;
        if (i >= len) return { kind: 'malformed' }; // unclosed quote
        value = markdown.slice(valueStart, i);
        i += 1; // closing quote
      } else {
        // Unquoted value: ends at whitespace, >, or /.
        const valueStart = i;
        while (i < len) {
          const c = markdown[i];
          if (isHtmlWhitespace(c) || c === '>' || c === '/') break;
          if (c === '"' || c === "'" || c === '<' || c === '=') {
            return { kind: 'malformed' };
          }
          i += 1;
        }
        if (i === valueStart) return { kind: 'malformed' };
        value = markdown.slice(valueStart, i);
      }
    }

    attrs.push({ name, value });
  }

  return { kind: 'malformed' };
}

/**
 * Scan Markdown for `<a>` start tags.
 * On the first malformed a-tag, stop immediately (do not resume inside the
 * broken region) and fail closed for the whole Markdown unit.
 */
function scanAStartTags(markdown) {
  const tags = [];
  let i = 0;
  while (i < markdown.length) {
    const start = markdown.indexOf('<', i);
    if (start < 0) break;
    const parsed = parseAStartTagAttributes(markdown, start);
    if (parsed.kind === 'not-a-tag') {
      i = start + 1;
      continue;
    }
    if (parsed.kind === 'malformed') {
      return { malformed: true, tags: [] };
    }
    tags.push({ attrs: parsed.attrs, end: parsed.end });
    i = parsed.end;
  }
  return { malformed: false, tags };
}

function collectAStartTagAttributeValues(markdown, attributeName) {
  const wanted = attributeName.toLowerCase();
  const scan = scanAStartTags(markdown);
  if (scan.malformed) {
    return { values: [], malformed: true };
  }
  const values = [];
  for (const tag of scan.tags) {
    for (const attr of tag.attrs) {
      if (attr.name === wanted) values.push(attr.value);
    }
  }
  return { values, malformed: false };
}

/**
 * Inspect explicit HTML id anchors and malformed a-tag state together.
 * `malformed: true` means the whole Markdown unit must fail closed.
 */
export function inspectHtmlAnchorIds(markdown) {
  const { values, malformed } = collectAStartTagAttributeValues(markdown, 'id');
  if (malformed) {
    return { ids: [], malformed: true };
  }
  return {
    ids: [...new Set(values)].sort(),
    malformed: false,
  };
}

/**
 * Extract explicit HTML id anchors only.
 * `name=` aliases are intentionally ignored here and reported separately.
 * Only a real independent `id` attribute on an `<a>` start tag counts —
 * id-like text inside any other attribute value does not.
 * Malformed a-tags fail closed: no salvaged ids.
 */
export function extractHtmlAnchorIds(markdown) {
  return inspectHtmlAnchorIds(markdown).ids;
}

export function findDuplicateHtmlAnchorIds(markdown) {
  const { values, malformed } = collectAStartTagAttributeValues(markdown, 'id');
  if (malformed) return [];
  const counts = new Map();
  for (const id of values) {
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function findHtmlNameAliasAnchors(markdown) {
  const { values, malformed } = collectAStartTagAttributeValues(markdown, 'name');
  if (malformed) return [];
  return [...new Set(values)].sort();
}

export function extractMarkdownLinks(markdown) {
  const links = [];
  const pattern = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(pattern)) {
    links.push({
      text: match[1],
      target: match[2],
      index: match.index ?? 0,
    });
  }
  return links;
}

/**
 * Make a label safe inside `[label](target)` — ASCII `[]` would truncate the
 * CommonMark link text matcher (`[^\]]*`) and silently drop the edge.
 * Fullwidth brackets preserve the visual cue without breaking parse.
 */
export function sanitizeMarkdownLinkLabel(label) {
  return String(label ?? '')
    .replace(/\[/g, '［')
    .replace(/\]/g, '］');
}

export function splitLinkTarget(target) {
  const hashIndex = target.indexOf('#');
  if (hashIndex < 0) {
    return { path: target, fragment: null };
  }
  return {
    path: target.slice(0, hashIndex),
    fragment: target.slice(hashIndex + 1),
  };
}
