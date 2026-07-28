import { diagnostic } from './diagnostics.mjs';
import { normalizeNewlines } from './hash.mjs';

const START_RE = /^<!--\s*ccm:k:start\s+(point:[a-z0-9][a-z0-9.-]*)\s*-->\s*$/;
const END_RE = /^<!--\s*ccm:k:end\s+(point:[a-z0-9][a-z0-9.-]*)\s*-->\s*$/;

function markerDiagnostic(code, message, location, witness, remediation) {
  return diagnostic({
    severity: 'error',
    code,
    message,
    location,
    witness,
    remediation,
    exitCode: 3,
  });
}

/**
 * Extract Markdown point markers into spans + source map (C7).
 * Allows full nesting; rejects partial crossing, unclosed, mismatched, and duplicate IDs.
 */
export function extractMarkers(rawText, location = '<markdown>') {
  const text = normalizeNewlines(rawText);
  const lines = text.split('\n');
  // Preserve trailing empty segment only if file ends with newline? split keeps final empty if ends with \n
  if (lines.length > 0 && lines[lines.length - 1] === '' && text.endsWith('\n')) {
    lines.pop();
  }

  const diagnostics = [];
  const stack = [];
  /** @type {Map<string, {startLine:number, endLine:number|null}>} */
  const openById = new Map();
  /** @type {Array<{point_id:string, start_line:number, end_line:number, content:string}>} */
  const closed = [];
  const seenClosed = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const startMatch = lines[index].match(START_RE);
    const endMatch = lines[index].match(END_RE);

    if (startMatch) {
      const pointId = startMatch[1];
      if (seenClosed.has(pointId) || openById.has(pointId)) {
        diagnostics.push(
          markerDiagnostic(
            'SKG-MARKER-DUPLICATE',
            `Duplicate marker id in file: ${pointId}`,
            location,
            { point_id: pointId, line: lineNumber },
            'Keep one start/end pair per point id in a file.',
          ),
        );
        continue;
      }
      openById.set(pointId, { startLine: lineNumber, endLine: null });
      stack.push({ pointId, startLine: lineNumber });
      continue;
    }

    if (endMatch) {
      const pointId = endMatch[1];
      if (stack.length === 0) {
        diagnostics.push(
          markerDiagnostic(
            'SKG-MARKER-MISMATCH',
            `End marker without open start: ${pointId}`,
            location,
            { point_id: pointId, line: lineNumber },
            'Close markers in nesting order with matching point ids.',
          ),
        );
        continue;
      }
      const top = stack[stack.length - 1];
      if (top.pointId !== pointId) {
        diagnostics.push(
          markerDiagnostic(
            'SKG-MARKER-OVERLAP',
            `Partial crossing or mismatched end marker: expected ${top.pointId}, got ${pointId}`,
            location,
            {
              expected: top.pointId,
              actual: pointId,
              start_line: top.startLine,
              end_line: lineNumber,
            },
            'Use full nesting only; partial crossing is forbidden.',
          ),
        );
        // Pop nothing — leave unclosed for later diagnostics, but record overlap.
        continue;
      }
      stack.pop();
      openById.delete(pointId);
      if (seenClosed.has(pointId)) {
        diagnostics.push(
          markerDiagnostic(
            'SKG-MARKER-DUPLICATE',
            `Duplicate marker id in file: ${pointId}`,
            location,
            { point_id: pointId, line: lineNumber },
            'Keep one start/end pair per point id in a file.',
          ),
        );
        continue;
      }
      seenClosed.add(pointId);
      const contentLines = lines.slice(top.startLine, lineNumber - 1);
      const content = contentLines.join('\n') + (contentLines.length > 0 ? '\n' : '');
      closed.push({
        point_id: pointId,
        start_line: top.startLine,
        end_line: lineNumber,
        content,
      });
    }
  }

  for (const open of stack) {
    diagnostics.push(
      markerDiagnostic(
        'SKG-MARKER-UNCLOSED',
        `Unclosed start marker: ${open.pointId}`,
        location,
        { point_id: open.pointId, start_line: open.startLine },
        'Add a matching end marker in the same file.',
      ),
    );
  }

  if (diagnostics.length > 0) {
    return { ok: false, spans: [], source_map: [], diagnostics };
  }

  const spans = closed.sort((left, right) =>
    left.point_id.localeCompare(right.point_id),
  );
  const source_map = spans.map((span) => ({
    point_id: span.point_id,
    path: location,
    start_line: span.start_line,
    end_line: span.end_line,
  }));

  return { ok: true, spans, source_map, diagnostics: [] };
}
