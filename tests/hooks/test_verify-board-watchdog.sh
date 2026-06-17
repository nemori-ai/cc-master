#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# ── watchdog self-wakeup reminder (ADR-011) ───────────────────────────────────────────────────────
# verify-board.sh's completion-state handshake gains a soft-observed clause: when a matched (armed)
# board is in a completion state (no ready/uncertain) but still carries an `in_flight` background task
# AND has no armed top-level `wakeup` OBJECT, the handshake reason additionally nudges the orchestrator
# to "arm a watchdog wakeup" (canonical phrase) so a silently-failing background task has someone come
# back to recon it. An already-armed `wakeup` object silences it (graceful-degrade, like wip_limit).
# Mirrors the verify-board.sh test harness exactly (mkactive + run_stop_sid degraded/sid runners).

mkactive() { mkdir -p "$1"; printf '%s' "$3" > "$1/$2.board.json"; }
run_stop() {
  HOOK_OUT="$(CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
             bash "$PLUGIN_ROOT/hooks/scripts/verify-board.sh" </dev/null 2>/dev/null)"; HOOK_RC=$?
}
run_stop_sid() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               bash "$PLUGIN_ROOT/hooks/scripts/verify-board.sh" 2>/dev/null)"; HOOK_RC=$?
}

CANON="arm a watchdog wakeup"   # canonical hook-injection anchor phrase (impl-contract §2.3)

# Case WD-a: completion state, an in_flight task, NO `wakeup` field → completion handshake block whose
#            reason carries the canonical watchdog nudge. (T1 done, T2 in_flight → no ready/uncertain →
#            completion state; fresh SID/home → first Stop reaches the handshake.)
H="$(make_project)"; SID="sess-wd-a"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "WD-a: in_flight + no wakeup → completion handshake block"
assert_contains "$HOOK_OUT" "self-check" "WD-a: in_flight + no wakeup → still the self-check handshake"
assert_contains "$HOOK_OUT" "$CANON" "WD-a: in_flight + no wakeup → reason carries canonical 'arm a watchdog wakeup' nudge"
assert_valid_json "$HOOK_OUT" "WD-a: hook stdout is well-formed JSON with watchdog clause appended"
rm -rf "$H"

# Case WD-b: completion state, an in_flight task, WITH an armed top-level `wakeup` OBJECT whose `fire_at`
#            is still in the FUTURE → still a completion handshake block (in_flight is a completion
#            state), but the reason must NOT carry the watchdog nudge (graceful-degrade: a non-stale
#            armed watchdog silences the reminder). fire_at fixed far in the future so it is unambiguously
#            non-stale under the expiry-aware read (簇#2).
H="$(make_project)"; SID="sess-wd-b"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"wakeup\":{\"armed_at\":\"2099-01-01T00:00:00Z\",\"fire_at\":\"2099-01-01T00:30:00Z\",\"mechanism\":\"cron\",\"job_id\":\"job-1\",\"checklist\":[\"recon T2 handle vs ground truth\"]},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "self-check" "WD-b: in_flight + armed (future) wakeup → still the completion self-check handshake"
assert_not_contains "$HOOK_OUT" "$CANON" "WD-b: in_flight + armed (future) wakeup OBJECT → NO watchdog nudge (graceful-degrade like wip_limit)"
rm -rf "$H"

# Case WD-c: completion state with NO in_flight task (all done) → no watchdog nudge (nothing can fail
#            silently in the background; the reminder is purely in_flight-gated).
H="$(make_project)"; SID="sess-wd-c"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"done\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "self-check" "WD-c: no in_flight → still the completion self-check handshake"
assert_not_contains "$HOOK_OUT" "$CANON" "WD-c: no in_flight task → NO watchdog nudge (in_flight-gated)"
rm -rf "$H"

# Case WD-d (red line 6 regression): an UNARMED board — owner.active:false (archived), owner.session_id
#            == this session's sid, with an in_flight task and no wakeup. An unarmed board must keep the
#            hook fully DORMANT: empty stdout, rc 0, no block — and certainly no watchdog nudge.
H="$(make_project)"; SID="sess-wd-d"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":false,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "WD-d: unarmed (archived) board → rc 0"
assert_eq "" "$HOOK_OUT" "WD-d: unarmed board → empty stdout (fully dormant, red line 6)"
assert_not_contains "$HOOK_OUT" "$CANON" "WD-d: unarmed board → no watchdog nudge"
rm -rf "$H"

# ── EXTRA ROBUSTNESS (beyond the four contract cases) ─────────────────────────────────────────────

# Case WD-e (non-object wakeup → still remind): a top-level `wakeup` whose value is a STRING (not an
#            armed object) must NOT silence the reminder — graceful-degrade only honors an armed OBJECT
#            (impl-contract §2.3: "无 wakeup（或 wakeup 非对象）→ 注入提醒").
H="$(make_project)"; SID="sess-wd-e"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"wakeup\":\"not-an-object\",\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "$CANON" "WD-e: wakeup is a STRING (non-object) → reminder still fires (only an armed OBJECT silences it)"
rm -rf "$H"

# Case WD-f (single-line, format-agnostic): a compact single-line board with in_flight + no wakeup →
#            reminder fires identically to the multi-line case (awk scan is layout-agnostic).
H="$(make_project)"; SID="sess-wd-f"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "$CANON" "WD-f: single-line board, in_flight + no wakeup → reminder fires (format-agnostic)"
rm -rf "$H"

# Case WD-g (no-active-board dormancy): no board at all → fully dormant, no nudge (sanity that the new
#            clause never fires on an empty home — the global dormant-until-armed gate still wins).
H="$(make_project)"
run_stop "$H"
assert_eq 0 "$HOOK_RC" "WD-g: empty home → rc 0"
assert_eq "" "$HOOK_OUT" "WD-g: empty home → empty stdout (dormant)"
rm -rf "$H"

# Case WD-h (wakeup buried in a task payload must NOT silence): a flexible task-local `wakeup` object
#            inside tasks[] is agent-shaped noise — only a ROOT-depth `wakeup` object counts. So a board
#            with in_flight + a NESTED wakeup but no ROOT wakeup must STILL fire the reminder (root-only
#            discipline, same as owner_region / wip_limit).
H="$(make_project)"; SID="sess-wd-h"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[],\"wakeup\":{\"job_id\":\"decoy\"}}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "$CANON" "WD-h: nested task-local wakeup decoy does NOT silence → root-only read, reminder still fires"
rm -rf "$H"

# ── FINGERPRINT-MUST-INCLUDE-WATCHDOG (codex round-2 P2 regression) ────────────────────────────────
# old_fp BOARD_PATH — recompute the OLD-formula completion-state fingerprint (task id+status+blocked_on
# triples only, NO watchdog dimension) for a single matched board. Replicates exactly what a PRE-upgrade
# verify-board.sh wrote into `.stopcheck` so we can simulate a stale handshake record surviving an upgrade.
old_fp() { # $1 = board path
  bash -c '
    . "'"$PLUGIN_ROOT"'/tests/hooks/helpers.sh" >/dev/null 2>&1 || true
    tasks_region() {
      awk '"'"'
        { s = s $0 "\n" }
        END {
          i = index(s, "\"tasks\""); if (!i) exit
          s = substr(s, i + 7)
          j = index(s, "["); if (!j) exit
          s = substr(s, j + 1)
          bd = 1; cd = 0; instr = 0; esc = 0; out = ""
          n = length(s)
          for (k = 1; k <= n; k++) {
            ch = substr(s, k, 1)
            if (instr) {
              if (bd == 1 && cd == 1) out = out ch
              if (esc) esc = 0
              else if (ch == "\\") esc = 1
              else if (ch == "\"") instr = 0
              continue
            }
            if (ch == "\"") { instr = 1; if (bd == 1 && cd == 1) out = out ch; continue }
            if (ch == "[") { bd++; continue }
            if (ch == "]") { bd--; if (bd == 0) break; continue }
            if (ch == "{") { cd++; continue }
            if (ch == "}") { cd--; continue }
            if (bd == 1 && cd == 1) out = out ch
          }
          printf "%s", out
        }'"'"' "$1" 2>/dev/null
    }
    tasks_region "$1" | grep -oE '"'"'"(id|status|blocked_on)"[[:space:]]*:[[:space:]]*"[^"]*"'"'"' | cksum | awk "{print \$1}"
  ' _ "$1"
}

# Case WD-i (STALE/UPGRADE fingerprint, the codex round-2 P2 scenario): a board already handshook under
#            the OLD fingerprint formula (task triples only, no watchdog dimension) — typical when the
#            plugin was upgraded WHILE a task was still in_flight. The board has an in_flight task and NO
#            wakeup. The new hook recomputes the fingerprint with the watchdog dimension folded in → it
#            CANNOT equal the stale value → the hook is forced through ONE fresh handshake → the watchdog
#            reminder fires (NOT silently skipped via the allow-early-exit path). This is the regression.
H="$(make_project)"; SID="sess-wd-i"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
STALE_FP="$(old_fp "$H/b1.board.json")"
printf '0 %s\n' "$STALE_FP" > "$H/.$SID.stopcheck"   # simulate a pre-upgrade handshake record
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "WD-i: stale old-formula fingerprint → NOT allowed early; forced fresh handshake block"
assert_contains "$HOOK_OUT" "$CANON" "WD-i: stale fingerprint (pre-upgrade) does NOT skip the watchdog clause — reminder fires"
rm -rf "$H"

# Case WD-j (same-fingerprint dedup STILL works): with the watchdog dimension folded in, a board whose
#            CURRENT (new-formula) fingerprint was already handshook must STILL be allowed on the next Stop
#            — dedup is not broken into per-tick nagging. We seed the sidecar with the NEW-formula
#            fingerprint (block_streak 0) and confirm the hook takes the allow-early-exit path: no block,
#            no watchdog nag, rc 0, and the handshook fp is kept.
H="$(make_project)"; SID="sess-wd-j"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"                              # 1st Stop: fresh handshake → block + watchdog nudge
assert_contains "$HOOK_OUT" "$CANON" "WD-j: 1st Stop on in_flight/no-wakeup → watchdog nudge (sanity)"
NEW_FP="$(sed -n 's/^[0-9][0-9]* \(.*\)$/\1/p' "$H/.$SID.stopcheck")"   # fp the hook just handshook on
# After a handshake-block, the sidecar holds "<bumped streak> <handshook fp>" (streak 0→1 on first block).
assert_eq "1 $NEW_FP" "$(cat "$H/.$SID.stopcheck")" "WD-j: after handshake-block, sidecar holds the new-formula fp (streak bumped to 1)"
run_stop_sid "$H" "$SID"                              # 2nd Stop, same state: must DEDUP → allow, no nag
assert_not_contains "$HOOK_OUT" "block" "WD-j: 2nd Stop, same fingerprint → allowed (dedup intact, no per-tick nagging)"
assert_not_contains "$HOOK_OUT" "$CANON" "WD-j: 2nd Stop → no repeated watchdog nag (handshook once)"
assert_eq 0 "$HOOK_RC" "WD-j: 2nd Stop → rc 0 (allow path)"
assert_eq "0 $NEW_FP" "$(cat "$H/.$SID.stopcheck")" "WD-j: dedup allow KEEPS the handshook fp (allow_handshook_fp)"
rm -rf "$H"

# ── EXPIRY-AWARE SELF-HEAL (簇#2: a STALE wakeup must not silence the reminder) ────────────────────
# wakeup_armed treats "object + legal fire_at + already past now" as NOT armed (the watchdog should have
# fired but the task is still in_flight → itself the silent-failure signal). The ONLY downgrade case is
# that fully-determined stale trio; missing/malformed fire_at graceful-degrades to "armed" (red line 2).

# Case WD-k (STALE wakeup → re-remind): completion state + an in_flight task + a `wakeup` OBJECT whose
#            `fire_at` is in the PAST (legal ISO-8601-UTC, < now). The stale safety net must NOT silence
#            the reminder — the hook self-heals and re-injects the canonical watchdog nudge.
H="$(make_project)"; SID="sess-wd-k"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"wakeup\":{\"armed_at\":\"2000-01-01T00:00:00Z\",\"fire_at\":\"2000-01-01T00:30:00Z\",\"mechanism\":\"cron\",\"job_id\":\"job-stale\",\"checklist\":[\"recon T2\"]},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "WD-k: stale wakeup (fire_at in past) + in_flight → completion handshake block"
assert_contains "$HOOK_OUT" "$CANON" "WD-k: stale wakeup (fire_at already past) does NOT silence → reminder re-fires (self-heal)"
rm -rf "$H"

# Case WD-l (FUTURE wakeup → stay silent): same as WD-k but `fire_at` is in the FUTURE (not yet expired)
#            → the watchdog is genuinely armed → the reminder must NOT fire (this dimension stays silent).
H="$(make_project)"; SID="sess-wd-l"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"wakeup\":{\"armed_at\":\"2099-01-01T00:00:00Z\",\"fire_at\":\"2099-01-01T00:30:00Z\",\"mechanism\":\"cron\",\"job_id\":\"job-future\",\"checklist\":[\"recon T2\"]},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "self-check" "WD-l: future wakeup + in_flight → still the completion self-check handshake"
assert_not_contains "$HOOK_OUT" "$CANON" "WD-l: future (non-expired) wakeup → reminder stays silent (genuinely armed)"
rm -rf "$H"

finish
