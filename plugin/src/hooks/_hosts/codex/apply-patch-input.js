// Codex host-only apply_patch carrier normalization. Keep this at the classifier boundary so both
// launched and direct-core hook paths receive the same `{ patch: string }` contract.

// Recognized carriers form one validated set. Presence is own-property membership; values are
// compared by exact string equality (no trim/normalization). Validation failure returns `{}` so the
// parser never sees a usable patch and fails closed — including when a string `patch` would otherwise
// first-win over a conflicting or non-string sibling alias.
const APPLY_PATCH_ALIASES = ['patch', 'input', 'command'];

function normalizeApplyPatchInput(rawToolInput) {
  if (typeof rawToolInput === 'string') return { patch: rawToolInput };
  if (!rawToolInput || typeof rawToolInput !== 'object' || Array.isArray(rawToolInput)) {
    return rawToolInput;
  }

  const present = APPLY_PATCH_ALIASES.filter((key) => (
    Object.prototype.hasOwnProperty.call(rawToolInput, key)
  ));
  if (present.length === 0) return rawToolInput;

  const values = present.map((key) => rawToolInput[key]);
  if (values.some((value) => typeof value !== 'string')) return {};
  const unique = new Set(values);
  if (unique.size !== 1) return {};
  return { patch: values[0] };
}

module.exports = { normalizeApplyPatchInput };
