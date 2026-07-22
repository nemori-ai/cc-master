// Codex host-only apply_patch carrier normalization. Keep this at the classifier boundary so both
// launched and direct-core hook paths receive the same `{ patch: string }` contract.

function normalizeApplyPatchInput(rawToolInput) {
  if (typeof rawToolInput === 'string') return { patch: rawToolInput };
  if (rawToolInput && typeof rawToolInput === 'object' && !Array.isArray(rawToolInput)) {
    if (typeof rawToolInput.patch === 'string') return { patch: rawToolInput.patch };
    if (typeof rawToolInput.input === 'string') return { patch: rawToolInput.input };
  }
  // Preserve unrecognized carriers. The parser treats them as unusable and fails closed.
  return rawToolInput;
}

module.exports = { normalizeApplyPatchInput };
