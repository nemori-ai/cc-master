#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/usage-pacing/implementations/codex/usage-pacing-core.js"

seed_board() {
  mkdir -p "$1/boards"
  printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"%s"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' "$2" >"$1/boards/armed.board.json"
}

status_json() {
  local state="$1" revision="$2" covered="$3"
  node -e '
const [state, revision, covered] = process.argv.slice(1);
const decisions = state === "none" ? [] : [{
  scope_digest: `sha256:${"a".repeat(64)}`,
  target: {
    harness_id: "codex", surface_id: "codex-cli", provider_id: "codex",
    window: { kind: "rolling", name: "seven_day", duration_sec: 604800 },
  },
  quota_scope_digest: `sha256:${"e".repeat(64)}`,
  state,
  freshness: state === "unknown" ? "unknown" : "fresh",
  reason_codes: state === "healthy" ? [] : [`QUOTA_${state.toUpperCase()}`],
  source: { collector_id: "codex-app-server", source_schema: "codex/account-rate-limits/v1", auth_source: "codex-cli-current-login" },
  decision_revision: `sha256:${revision.repeat(64)}`,
  observation_revision: `sha256:${"0".repeat(64)}`,
  fanout_covered: covered === "true",
}];
process.stdout.write(JSON.stringify({
  schema: "ccm/machine-quota-status/v1",
  summary: { schema: "ccm/machine-quota-summary/v1", decisions },
  readings: [],
  capacity_views: { schema: "ccm/machine-quota-capacity-views/v1", known_capacities: [], unresolved_scope_digests: [], unresolved_capacity_units: null },
}));
' "$state" "$revision" "$covered"
}

mutate_status() {
  local kind="$1"
  KIND="$kind" node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => raw += chunk);
process.stdin.on("end", () => {
  const value = JSON.parse(raw);
  const decision = value.summary.decisions[0];
  if (process.env.KIND === "five-hour") {
    decision.target.window = { kind: "rolling", name: "five_hour", duration_sec: 18000 };
  }
  if (process.env.KIND === "legacy-switch") decision.reason_codes = ["QUOTA_SWITCH"];
  if (process.env.KIND === "legacy-stop-5h") decision.reason_codes = ["QUOTA_STOP_5H"];
  if (process.env.KIND === "source-five-hour") decision.source.collector_id = "codex-five_hour";
  if (process.env.KIND === "source-five-hour-dotted") decision.source.collector_id = "codex.five.hour";
  if (process.env.KIND === "source-switch") decision.source.source_schema = "codex/switch-action/v1";
  if (process.env.KIND === "source-stop-5h") decision.source.auth_source = "codex-stop_5h";
  process.stdout.write(JSON.stringify(value));
});
'
}

write_stub() {
  local home="$1" response="$2"
  printf '%s' "$response" >"$home/status.json"
  cat >"$home/ccm" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$home/calls"
if [ "\$1 \$2" = "quota status" ]; then cat "$home/status.json"; exit 0; fi
exit 29
STUB
  chmod +x "$home/ccm"
}

run_stop() {
  local home="$1" sid="$2" active="${3:-false}"
  HOOK_OUT="$(
    printf '{"session_id":"%s","hook_event_name":"Stop","stop_hook_active":%s}' "$sid" "$active" |
      CC_MASTER_HOME="$home" CCM_BIN="$home/ccm" node "$LAUNCHER" --event Stop --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
}

H="$(make_project)"
seed_board "$H" "sess-u"

write_stub "$H" "$(status_json healthy 1 true)"
run_stop "$H" "sess-u"
assert_eq "" "$HOOK_OUT" "healthy covered status -> silent"

write_stub "$H" "$(status_json tight 2 false)"
run_stop "$H" "sess-u"
assert_contains "$HOOK_OUT" '"systemMessage"' "uncovered tight -> Codex systemMessage"
assert_contains "$HOOK_OUT" "codex/codex-cli/codex" "target scope retained"
assert_contains "$HOOK_OUT" "state=tight" "state retained"
assert_contains "$HOOK_OUT" "7d hard ceiling" "Codex 7d-only policy is explicit"
assert_not_contains "$HOOK_OUT" "5h quota" "no 5h pacing branch"
assert_contains "$HOOK_OUT" "automatic account switching are ignored" "no automatic account switch is explicit"

run_stop "$H" "sess-u"
assert_eq "" "$HOOK_OUT" "same scope+revision -> sidecar dedupe"

write_stub "$H" "$(status_json exhausted 3 false)"
run_stop "$H" "sess-u"
assert_contains "$HOOK_OUT" "state=exhausted" "changed revision surfaces"

write_stub "$H" "$(status_json exhausted 4 true)"
run_stop "$H" "sess-u"
assert_eq "" "$HOOK_OUT" "machine fan-out covered revision -> direct floor silent"

run_stop "$H" "sess-u" "true"
assert_eq "" "$HOOK_OUT" "stop_hook_active -> silent"

CALLS="$(cat "$H/calls")"
assert_contains "$CALLS" "quota status --machine-wide --json" "cached machine-wide status is the only read"
assert_not_contains "$CALLS" "usage advise" "legacy usage adapter is never invoked"
assert_not_contains "$CALLS" "coordination notify" "hook does not duplicate ccm fan-out"
assert_not_contains "$CALLS" "account switch" "Codex never switches accounts"
rm -rf "$H"

for BAD_KIND in five-hour legacy-switch legacy-stop-5h source-five-hour source-five-hour-dotted source-switch source-stop-5h; do
  H="$(make_project)"
  seed_board "$H" "sess-codex-negative-$BAD_KIND"
  write_stub "$H" "$(status_json tight 6 false | mutate_status "$BAD_KIND")"
  run_stop "$H" "sess-codex-negative-$BAD_KIND"
  assert_eq "" "$HOOK_OUT" "Codex rejects $BAD_KIND machine decisions"
  assert_no_file "$H/hooks/usage-pacing-machine-quota" "Codex $BAD_KIND creates no agent line or sidecar"
  rm -rf "$H"
done

META="$(cat "$REPO_ROOT/plugin/src/hooks/usage-pacing/implementations/codex/meta.yaml")"
STRATEGY="$(sed -n '/^usage_pacing:/,/^[a-z_]*:/p' "$REPO_ROOT/plugin/src/hooks/_hosts/codex/strategy.yaml")"
assert_contains "$META" "quota status --machine-wide --json" "Codex adapter metadata names cached machine-wide status"
assert_not_contains "$META" "usage advise" "Codex adapter metadata does not advertise legacy usage advise"
assert_contains "$STRATEGY" "seven_day" "Codex host strategy declares seven-day-only decision authority"
assert_not_contains "$STRATEGY" "stop_5h" "Codex host strategy no longer declares stop_5h output"
assert_not_contains "$STRATEGY" "switch," "Codex host strategy no longer declares switch output"

H="$(make_project)"
write_stub "$H" "$(status_json tight 5 false)"
run_stop "$H" "sess-unarmed"
assert_eq "" "$HOOK_OUT" "unarmed -> silent"
assert_no_file "$H/calls" "unarmed -> no ccm read"
rm -rf "$H"

finish
