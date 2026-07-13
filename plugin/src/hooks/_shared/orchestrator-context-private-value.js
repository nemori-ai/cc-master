#!/usr/bin/env node
'use strict';

// This executable classifier is shared by the Claude Code, Codex, and Cursor origin consumers.
// The marked language and algorithm blocks intentionally remain byte-identical to the producer;
// the engine conformance test enforces that constraint without coupling either runtime package.

// BEGIN ORIGIN_PRIVATE_VALUE_LANGUAGE
const SECRET_SK_VALUE = /(?:^|[^A-Za-z0-9])(sk-[A-Za-z0-9_-]{16,})(?=$|[^A-Za-z0-9_-])/i;
const SECRET_JWT_VALUE =
  /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?=$|[^A-Za-z0-9_-])/;
const SECRET_GITHUB_VALUE =
  /(?:^|[^A-Za-z0-9_])(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{8,}(?=$|[^A-Za-z0-9_])/i;
const SECRET_ASSIGNMENT_VALUE =
  /\b(?:api[\s_-]*key|credentials?|(?:access|refresh)[\s_-]*token|client[\s_-]*secret|secret[\s_-]*key)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{8,})/i;
const BEARER_VALUE = /\bBearer\s+([A-Za-z0-9._~+/=-]{8,})(?=$|[^A-Za-z0-9._~+/=-])/i;
const NON_SECRET_ASSIGNMENT_VALUES = new Set([
  'unknown',
  'unavailable',
  'redacted',
  'missing',
  'none',
  'not-configured',
  'forbidden',
]);
const NON_SECRET_BEARER_VALUES = new Set([
  'unknown',
  'unavailable',
  'redacted',
  'missing',
  'none',
  'not-configured',
  'forbidden',
]);
const NON_SECRET_BEARER_AUTH_STATUS =
  /^(?:(?:\s+is)?\s+|:\s*)(?:unknown|unavailable|missing|not[- ]configured|forbidden)\b/i;
// END ORIGIN_PRIVATE_VALUE_LANGUAGE

function secretShapedValue(value) {
  // BEGIN ORIGIN_PRIVATE_VALUE_ALGORITHM
  if (SECRET_SK_VALUE.test(value)) return true;
  if (SECRET_JWT_VALUE.test(value)) return true;
  if (SECRET_GITHUB_VALUE.test(value)) return true;
  for (const match of value.matchAll(new RegExp(SECRET_ASSIGNMENT_VALUE.source, 'gi'))) {
    const assignment = match[1]?.toLowerCase();
    if (assignment === undefined || NON_SECRET_ASSIGNMENT_VALUES.has(assignment)) continue;
    return true;
  }
  for (const match of value.matchAll(new RegExp(BEARER_VALUE.source, 'gi'))) {
    const bearer = match[1]?.toLowerCase();
    if (bearer === undefined || NON_SECRET_BEARER_VALUES.has(bearer)) continue;
    const suffix = value.slice((match.index ?? 0) + match[0].length);
    if (
      (bearer === 'authentication' || bearer === 'auth') &&
      NON_SECRET_BEARER_AUTH_STATUS.test(suffix)
    ) {
      continue;
    }
    return true;
  }
  return false;
  // END ORIGIN_PRIVATE_VALUE_ALGORITHM
}

module.exports = { secretShapedValue };
