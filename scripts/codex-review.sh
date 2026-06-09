#!/usr/bin/env bash
# codex-review.sh — use codex as an independent second endpoint verifier.
#
# Out-of-band, manual/orchestrator-driven (NOT a hook). codex runs a review-only,
# read-only-sandbox pass over the diff against a base branch and emits a verdict
# (approve | needs-attention) conforming to the openai-codex plugin's
# review-output.schema.json. This is the dogfood reviewer for skill/plugin quality.
#
# Requires: codex CLI, logged in (OAuth). Usage: codex-review.sh [--base <branch>]
#
# Silent-pass-through guard (see skills/orchestrating-to-completion/references/
# resume-verify.md §3): an empty review or a failed call is treated as NOT passed.
# A null/missing verdict is never silent approval — we exit 2 so the caller's
# endpoint gate maps it to "not passed" (Replan), never to done.
set -euo pipefail

# --- args: [--base <branch>], default main ---
BASE="main"
if [ "${1:-}" = "--base" ]; then
  BASE="${2:-main}"
elif [ -n "${1:-}" ]; then
  BASE="$1"
fi

OUT="$(mktemp -t codex-review.XXXXXX)"
trap 'rm -f "$OUT"' EXIT

# Review-only instruction. Focus on skill/plugin quality; respect the filesystem
# boundary — other AIs' skill definitions are out of scope.
PROMPT='Review-only. Do NOT modify any file. Focus on skill/plugin quality of THIS repo:
- SKILL.md description: does it actually trigger at the moments it should (trigger force)?
- instruction ambiguity: are any directives vague or self-contradictory?
- bash code blocks: would they actually run (syntax, quoting, regex, shell/boundary bugs)?
- dead references: any pointer to a file/section/anchor that does not exist?
- hooks: are they still pure bash with NO jq / node dependency?
FILESYSTEM BOUNDARY — IGNORE these entirely (they are OTHER AIs skill definitions, not this repo):
  ~/.claude/ , .claude/skills/ , agents/ .
Output the verdict per review-output.schema.json (verdict: approve | needs-attention).'

# Core call. `< /dev/null` prevents a stdin deadlock (codex reads instructions
# from the PROMPT arg, not stdin). --json streams JSONL events to stdout; -o writes
# the final agent message (the verdict) to $OUT.
if ! codex exec review "$PROMPT" --base "$BASE" \
      -m gpt-5.5 -c model_reasoning_effort=high \
      --json -o "$OUT" < /dev/null; then
  echo "CODEX_REVIEW_FAILED (treat as NOT passed)"
  exit 2
fi

# Empty / whitespace-only review == failure (silent-pass-through guard).
if [ ! -s "$OUT" ] || ! grep -q '[^[:space:]]' "$OUT"; then
  echo "CODEX_REVIEW_FAILED (treat as NOT passed)"
  exit 2
fi

echo "--- codex review verdict ($OUT) ---"
cat "$OUT"
# verdict: approve | needs-attention (per openai-codex review-output.schema.json).
# Caller maps it to the endpoint gate: needs-attention -> Replan(feedback);
# approve + non-empty + diff actually read -> done; empty/failed (exit 2) -> NOT passed.
