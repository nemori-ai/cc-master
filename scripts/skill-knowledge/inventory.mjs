import { diagnostic } from './diagnostics.mjs';
import { hashMarkdownSpan, normalizeNewlines } from './hash.mjs';

/**
 * Split normalized text into exact line byte ranges.
 * Each range is [start, end) over `text` and includes the trailing LF when present.
 */
function lineRanges(text) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      ranges.push([start, index + 1]);
      start = index + 1;
    }
  }
  if (start < text.length) {
    ranges.push([start, text.length]);
  }
  return ranges;
}

/**
 * Build unbound regions by removing each bound span inclusive of its marker lines.
 * Preserves exact remaining bytes (including EOF newline presence). Contiguous unbound
 * runs are length-prefixed before hashing so naive concatenation cannot collide.
 */
export function hashUnboundRegions(rawText, spans) {
  const text = normalizeNewlines(rawText);
  const ranges = lineRanges(text);
  const covered = new Array(ranges.length).fill(false);

  for (const span of spans) {
    const start = Math.max(1, span.start_line);
    const end = Math.max(start, span.end_line);
    for (let line = start; line <= end; line += 1) {
      if (line - 1 < covered.length) covered[line - 1] = true;
    }
  }

  /** @type {string[]} */
  const runs = [];
  let runStart = null;
  let runEnd = null;
  for (let index = 0; index < ranges.length; index += 1) {
    if (covered[index]) {
      if (runStart !== null) {
        runs.push(text.slice(runStart, runEnd));
        runStart = null;
        runEnd = null;
      }
      continue;
    }
    const [start, end] = ranges[index];
    if (runStart === null) {
      runStart = start;
      runEnd = end;
    } else if (start === runEnd) {
      runEnd = end;
    } else {
      runs.push(text.slice(runStart, runEnd));
      runStart = start;
      runEnd = end;
    }
  }
  if (runStart !== null) {
    runs.push(text.slice(runStart, runEnd));
  }

  if (runs.length === 0) return hashMarkdownSpan('');

  // Length-prefixed framing: exact run bytes + unambiguous boundaries.
  const framed = runs
    .map((run) => {
      const byteLength = Buffer.byteLength(run, 'utf8');
      return `${byteLength}:${run}`;
    })
    .join('\n');
  return hashMarkdownSpan(framed);
}

export function attestInventoryEntry(entry, rawText, spans) {
  const expectedPoints = new Set(entry.point_ids ?? []);
  const relevantSpans = spans.filter((span) => expectedPoints.has(span.point_id));
  const actual = hashUnboundRegions(rawText, relevantSpans);
  const expected = entry.reviewed_unbound_sha256;

  if (actual !== expected) {
    return {
      ok: false,
      attestation: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'SKG-INVENTORY-STALE-UNBOUND',
          message: `Reviewed unbound hash is stale for ${entry.path}`,
          location: entry.path,
          witness: {
            path: entry.path,
            expected_sha256: expected,
            actual_sha256: actual,
            coverage: entry.coverage,
            point_ids: [...expectedPoints],
          },
          remediation:
            'Re-review unbound prose and update reviewed_unbound_sha256, or bind the new knowledge to points.',
          exitCode: 4,
        }),
      ],
    };
  }

  return {
    ok: true,
    attestation: {
      path: entry.path,
      coverage: entry.coverage,
      point_ids: [...expectedPoints],
      reviewed_unbound_sha256: actual,
      fresh: true,
    },
    diagnostics: [],
  };
}
