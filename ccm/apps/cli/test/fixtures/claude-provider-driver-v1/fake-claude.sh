#!/usr/bin/env bash
set -euo pipefail

input=''
IFS= read -r -d '' input || true
model=''
effort=''
while (($#)); do
  if [[ $1 == '--model' ]]; then
    model=${2-}
    shift 2
  elif [[ $1 == '--effort' ]]; then
    effort=${2-}
    shift 2
  else
    shift
  fi
done

if [[ $input == *'"objective":"fixture:hang"'* ]]; then
  printf 'fixture-started\n'
  while true; do sleep 60; done
elif [[ $input == *'"objective":"fixture:error"'* ]]; then
  printf '{"type":"result","session_id":"fixture-session-fixture-request","modelUsage":{"%s":{"inputTokens":1,"outputTokens":1}},"subtype":"error_during_execution","is_error":true,"errors":["controlled fixture failure"]}\n' "$model"
  exit 1
elif [[ $input == *'"objective":"fixture:model-mismatch"'* ]]; then
  printf '{"type":"result","session_id":"fixture-session-fixture-request","modelUsage":{"claude-other-fixture":{"inputTokens":1,"outputTokens":1}},"provider_metadata":{"model":"claude-other-fixture","effort":"%s","identity_fingerprint":"fixture-identity"},"subtype":"success","is_error":false,"structured_output":{"outcome":"done","summary":"wrong model"}}\n' "$effort"
elif [[ $input == *'"objective":"fixture:effort-mismatch"'* ]]; then
  printf '{"type":"result","session_id":"fixture-session-fixture-request","modelUsage":{"%s":{"inputTokens":1,"outputTokens":1}},"provider_metadata":{"model":"%s","effort":"low","identity_fingerprint":"fixture-identity"},"subtype":"success","is_error":false,"structured_output":{"outcome":"done","summary":"wrong effort"}}\n' "$model" "$model"
elif [[ $input == *'"objective":"fixture:identity-mismatch"'* ]]; then
  printf '{"type":"result","session_id":"fixture-session-fixture-request","modelUsage":{"%s":{"inputTokens":1,"outputTokens":1}},"provider_metadata":{"model":"%s","effort":"%s","identity_fingerprint":"fixture-other-identity"},"subtype":"success","is_error":false,"structured_output":{"outcome":"done","summary":"wrong identity"}}\n' "$model" "$model" "$effort"
elif [[ $input == *'"objective":"fixture:output-malformed"'* ]]; then
  printf '{"type":"result","session_id":"fixture-session-fixture-request","modelUsage":{"%s":{"inputTokens":1,"outputTokens":1}},"provider_metadata":{"model":"%s","effort":"%s","identity_fingerprint":"fixture-identity"},"subtype":"success","is_error":false,"structured_output":"not-an-object"}\n' "$model" "$model" "$effort"
elif [[ $input == *'"objective":"fixture:terminal-missing-session"'* ]]; then
  printf '{"type":"result","modelUsage":{"%s":{"inputTokens":1,"outputTokens":1}},"provider_metadata":{"model":"%s","effort":"%s","identity_fingerprint":"fixture-identity"},"subtype":"success","is_error":false,"structured_output":{"outcome":"done","summary":"missing session"}}\n' "$model" "$model" "$effort"
else
  printf '{"type":"result","session_id":"fixture-session-fixture-request","modelUsage":{"%s":{"inputTokens":1,"outputTokens":1}},"provider_metadata":{"model":"%s","effort":"%s","identity_fingerprint":"fixture-identity"},"subtype":"success","is_error":false,"structured_output":{"outcome":"done","summary":"controlled success"}}\n' "$model" "$model" "$effort"
fi
