#!/usr/bin/env node
'use strict';

const FORBIDDEN_CODEX_SIGNAL = /(?:FIVE_HOUR|FIVE-HOUR|5H|SWITCH)/i;

function codexSevenDayOnly(target, reasonCodes) {
  if (!target || target.harness_id !== 'codex') return true;
  const window = target.window;
  return (
    target.surface_id === 'codex-cli' &&
    target.provider_id === 'codex' &&
    window &&
    window.kind === 'rolling' &&
    window.name === 'seven_day' &&
    window.duration_sec === 604800 &&
    Array.isArray(reasonCodes) &&
    !reasonCodes.some((code) => typeof code !== 'string' || FORBIDDEN_CODEX_SIGNAL.test(code))
  );
}

module.exports = { codexSevenDayOnly };
