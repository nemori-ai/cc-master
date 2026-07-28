/**
 * CommonJS bridge for structured JSON stdout framing (see json-framing.mjs).
 */
'use strict';

const BEGIN = '<<<SKG_JSON_BEGIN>>>';
const END = '<<<SKG_JSON_END>>>';

function parseStructuredJsonStdout(stdout, { label = 'subprocess' } = {}) {
  const raw = String(stdout ?? '');
  const trimmed = raw.trim();
  if (!trimmed) {
    const error = new Error(`${label}: empty stdout (expected a single JSON document)`);
    error.code = 'SKG-JSON-FRAMING';
    throw error;
  }

  const beginIdx = trimmed.indexOf(BEGIN);
  const endIdx = trimmed.indexOf(END);
  if (beginIdx !== -1 || endIdx !== -1) {
    if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
      const error = new Error(
        `${label}: malformed SKG_JSON framing (require both BEGIN and END markers)`,
      );
      error.code = 'SKG-JSON-FRAMING';
      throw error;
    }
    const framed = trimmed.slice(beginIdx + BEGIN.length, endIdx).trim();
    try {
      return JSON.parse(framed);
    } catch (cause) {
      const error = new Error(
        `${label}: framed region is not valid JSON (pretty-printed diagnostics must stay inside the frame)`,
      );
      error.code = 'SKG-JSON-FRAMING';
      error.cause = cause;
      throw error;
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch (cause) {
    const error = new Error(
      `${label}: trimmed stdout must be a single JSON document (pretty-printed OK; last-line-only parsing is forbidden)`,
    );
    error.code = 'SKG-JSON-FRAMING';
    error.cause = cause;
    throw error;
  }
}

module.exports = {
  parseStructuredJsonStdout,
  SKG_JSON_BEGIN: BEGIN,
  SKG_JSON_END: END,
};
