#!/usr/bin/env node
'use strict';

function forbiddenCodexSignal(value) {
  if (typeof value !== 'string') return true;
  const normalized = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return normalized.includes('FIVEHOUR') || normalized.includes('5H') || normalized.includes('SWITCH');
}

function codexSevenDayOnly(target, reasonCodes, provenance) {
  if (!target || target.harness_id !== 'codex') return true;
  if (!Array.isArray(reasonCodes) || !Array.isArray(provenance)) return false;
  const window = target.window;
  const evidence = [...reasonCodes, ...provenance];
  return (
    target.surface_id === 'codex-cli' &&
    target.provider_id === 'codex' &&
    window &&
    window.kind === 'rolling' &&
    window.name === 'seven_day' &&
    window.duration_sec === 604800 &&
    !evidence.some(forbiddenCodexSignal)
  );
}

module.exports = { codexSevenDayOnly };
