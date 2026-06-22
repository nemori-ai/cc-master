#!/usr/bin/env bash
# Tests for the file-vault delete-line skeleton in commands/accounts.md (§4 step① refresh & §5 remove).
#
# This is NOT a hook (commands/accounts.md is a command-body prose that prints a shell skeleton for the
# USER to run in their own terminal — token never reaches the agent). But the skeleton is load-bearing
# safety code (a stale OAuth token left in the vault is a bearer-secret residue), so we regression-test
# the EXACT skeleton shape here and wire it into run-tests.sh's hook-test loop (tests/hooks/test_*.sh).
#
# The bug (codex round-3 P2-A, endpoint-reproduced): the OLD skeleton was
#     grep -v "^K_TOKEN=" f | grep -v "^K_EXPIRES=" > f.tmp && mv f.tmp f
# When the deleted account is the file's ONLY entry (its _TOKEN= / _EXPIRES= are the only two lines —
# the MOST COMMON refresh/remove case), BOTH lines get filtered → the final grep emits nothing and
# exits 1 → `&& mv` short-circuits → tmp is NOT mv'd → the original file stays UNCHANGED → the OLD
# TOKEN RESIDES. switch-account.sh's `grep -m1` then still reads the stale token.
#
# The fix (single grep -Ev, one exit code, rc≤1 gate):
#     grep -Ev "^K_(TOKEN|EXPIRES)=" f > f.tmp; rc=$?
#     if [ "$rc" -le 1 ]; then mv f.tmp f; else rm -f f.tmp; fi
#   rc 0 = other lines remain; rc 1 = all filtered (normal empty — single-account case, NOT an error);
#   rc≥2 = real grep error (e.g. unreadable file) → do NOT mv (防把空文件覆盖好文件). Portable across
#   sh/bash/zsh (single grep -E, no PIPESTATUS / pipefail bashism), token-blind (prefix-anchored ^key_,
#   never reads the value to the right of =).
. "$(dirname "$0")/helpers.sh"

# del_line_FIXED KEY FILE — the skeleton AS SHIPPED in commands/accounts.md (§4 step① / §5 remove).
del_line_FIXED() {
  local key="$1" file="$2"
  grep -Ev "^${key}_(TOKEN|EXPIRES)=" "$file" > "$file.tmp"; local rc=$?
  if [ "$rc" -le 1 ]; then mv "$file.tmp" "$file"; else rm -f "$file.tmp"; fi
}

# del_line_OLD KEY FILE — the BUGGY pre-fix skeleton (kept ONLY for the teeth proof at the bottom: the
# new asserts MUST fail against this shape). The chained `&& mv` short-circuits on the all-filtered rc 1.
del_line_OLD() {
  local key="$1" file="$2"
  grep -v "^${key}_TOKEN=" "$file" | grep -v "^${key}_EXPIRES=" > "$file.tmp" && mv "$file.tmp" "$file"
}

# run the four core assertions against a given delete impl (so the teeth proof can re-run them on OLD).
# Sets PASS/FAILED via helpers' assert_*. Returns nothing.
run_core_asserts() {
  local del_fn="$1" tag="$2" D
  D="$(make_project)"

  # ── (1·single-account full delete) the deleted key is the ONLY entry → both lines filtered ──────────
  printf 'acctA_TOKEN=secret-old-token-AAA\nacctA_EXPIRES=2026-12-31\n' > "$D/single.env"
  "$del_fn" acctA "$D/single.env"
  # old token must be GONE
  if grep -q "secret-old-token-AAA" "$D/single.env" 2>/dev/null; then
    FAILED=$((FAILED+1)); _red "FAIL: $tag (1) single-account delete → OLD TOKEN RESIDUAL"
  else PASS=$((PASS+1)); fi
  # tmp must NOT linger
  assert_no_file "$D/single.env.tmp" "$tag (1) single-account delete → no tmp residue"

  # ── (2·refresh multi-account) delete acctA (it has siblings) then re-append a NEW acctA line ────────
  printf 'acctA_TOKEN=stale-A\nacctA_EXPIRES=2025-01-01\nacctB_TOKEN=keep-B\nacctB_EXPIRES=2026-06-06\n' > "$D/multi.env"
  "$del_fn" acctA "$D/multi.env"
  printf 'acctA_TOKEN=fresh-A-999\n' >> "$D/multi.env"
  printf 'acctA_EXPIRES=2027-12-31\n' >> "$D/multi.env"
  # switch-account.sh reads with grep -m1 (first match) — it MUST see the NEW value, not the stale one.
  local got; got="$(grep -m1 "^acctA_TOKEN=" "$D/multi.env" 2>/dev/null)"
  assert_eq "acctA_TOKEN=fresh-A-999" "$got" "$tag (2) refresh → grep -m1 reads NEW token (no stale dup)"
  # exactly one acctA_TOKEN line survives (same key collapsed to one)
  local n; n="$(grep -c "^acctA_TOKEN=" "$D/multi.env" 2>/dev/null)"
  assert_eq "1" "$n" "$tag (2) refresh → exactly one acctA_TOKEN= line"
  # sibling acctB untouched
  if grep -q "keep-B" "$D/multi.env" 2>/dev/null; then PASS=$((PASS+1));
  else FAILED=$((FAILED+1)); _red "FAIL: $tag (2) refresh → sibling acctB clobbered"; fi

  rm -rf "$D"
}

echo "== accounts.md file-vault delete-line skeleton =="

# ── core asserts against the SHIPPED (fixed) skeleton ────────────────────────────────────────────────
run_core_asserts del_line_FIXED "FIXED"

# ── (3·real grep error) unreadable source MUST keep the original (rc≥2 → no mv) ──────────────────────
# Guards the "防把空文件覆盖好文件" property: a real grep failure must not clobber a good vault.
D="$(make_project)"
printf 'acctA_TOKEN=must-survive-ZZZ\n' > "$D/perm.env"; chmod 000 "$D/perm.env"
# inline the shipped skeleton against the unreadable file
grep -Ev "^acctA_(TOKEN|EXPIRES)=" "$D/perm.env" > "$D/perm.env.tmp" 2>/dev/null; rc=$?
if [ "$rc" -le 1 ]; then mv "$D/perm.env.tmp" "$D/perm.env" 2>/dev/null; else rm -f "$D/perm.env.tmp"; fi
chmod 644 "$D/perm.env" 2>/dev/null
# rc≥2 expected (grep can't read the file) → mv aborted → original intact
if [ "$rc" -ge 2 ]; then PASS=$((PASS+1));
else FAILED=$((FAILED+1)); _red "FAIL: (3) unreadable file expected grep rc≥2 (got $rc)"; fi
if grep -q "must-survive-ZZZ" "$D/perm.env" 2>/dev/null; then PASS=$((PASS+1));
else FAILED=$((FAILED+1)); _red "FAIL: (3) real grep error CLOBBERED the good vault"; fi
assert_no_file "$D/perm.env.tmp" "(3) real grep error → no tmp residue"
rm -rf "$D"

# ── TEETH PROOF (self-checking) ──────────────────────────────────────────────────────────────────────
# Regress the fix to the OLD `&& mv` shape and assert the single-account scenario FAILS. We run it in an
# ISOLATED counter (not the suite PASS/FAILED) and assert the OLD shape leaves the stale token + the tmp.
# If a future edit silently restores the `&& mv` short-circuit, THIS block flips and the suite fails.
echo "-- teeth: OLD '&& mv' skeleton must regress (stale token residual on single-account delete) --"
TD="$(make_project)"
printf 'acctA_TOKEN=secret-old-token-AAA\nacctA_EXPIRES=2026-12-31\n' > "$TD/single.env"
del_line_OLD acctA "$TD/single.env"
teeth_ok=1
if grep -q "secret-old-token-AAA" "$TD/single.env" 2>/dev/null; then
  : # GOOD: old skeleton DID leave the stale token (bug reproduced) → teeth have bite
else
  teeth_ok=0
fi
if [ "$teeth_ok" -eq 1 ]; then
  PASS=$((PASS+1)); _green "teeth OK: OLD '&& mv' skeleton leaves stale token (single-account) → fix is load-bearing"
else
  FAILED=$((FAILED+1)); _red "FAIL: teeth proof — OLD '&& mv' skeleton did NOT regress; the test has no bite"
fi
rm -rf "$TD"

# ── P2-12 (codex round-4): account-delete.sh must honor EXPLICIT --vault-file / --keychain-service ────
# Bug: account-delete.sh applied registry-inferred vault.service / vault.path UNCONDITIONALLY — even when
#   the user EXPLICITLY passed --keychain-service / --vault-file (to delete from a NON-default / repaired
#   vault location). The explicit override silently lost to the registry value → in a stale-registry
#   scenario (registry points at the OLD / wrong vault location) the script deletes the WRONG vault item
#   / fails to delete the target token. Fix mirrors switch-account.sh's *_EXPLICIT guard: explicit CLI >
#   registry inference > default. We drive the REAL shipped account-delete.sh in --dry-run and assert it
#   PLANS to delete the EXPLICIT location, not the registry one. dry-run prints the exact target:
#     keychain → "... -s <KEYCHAIN_SERVICE>"   file → "... @ <VAULT_FILE>"
echo "-- P2-12: account-delete.sh explicit --vault-file/--keychain-service must beat registry inference --"
DEL_SH="$PLUGIN_ROOT/skills/account-management/scripts/account-delete.sh"

if [ ! -f "$DEL_SH" ]; then
  FAILED=$((FAILED+1)); _red "FAIL: (P2-12) account-delete.sh not found at $DEL_SH"
else
  PD="$(make_project)"

  # ── (P2-12a·keychain) registry says vault.service=registry-svc; user explicitly --keychain-service explicit-svc.
  #    Plan MUST target explicit-svc, NOT registry-svc.
  printf '%s\n' '{
    "schema": "cc-master/accounts/v1",
    "accounts": {
      "victim@x.com": { "vault": { "kind": "keychain", "service": "registry-svc", "account": "victim@x.com" },
        "token_added_at": "2026-01-01T00:00:00Z", "token_refreshed_at": "2026-01-01T00:00:00Z",
        "token_expires_at": "2027-01-01T00:00:00Z", "active": false, "last_switch_out": null }
    }
  }' > "$PD/accounts.json"
  out_kc="$(CC_MASTER_HOME="$PD" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
            bash "$DEL_SH" --email "victim@x.com" --vault-kind keychain --keychain-service "explicit-svc" --dry-run 2>&1)"; rc_kc=$?
  assert_eq "0" "$rc_kc" "(P2-12a) keychain explicit-service dry-run exits 0"
  assert_contains "$out_kc" "-s explicit-svc" "(P2-12a) plan targets EXPLICIT keychain service (not registry)"
  assert_not_contains "$out_kc" "registry-svc" "(P2-12a) plan must NOT fall back to registry service when explicit given"

  # ── (P2-12b·file) registry says vault.path=/registry/stale.env; user explicitly --vault-file /explicit/fixed.env.
  #    Plan MUST target /explicit/fixed.env, NOT the registry path.
  printf '%s\n' '{
    "schema": "cc-master/accounts/v1",
    "accounts": {
      "victim@x.com": { "vault": { "kind": "file", "path": "/registry/stale.env", "key": "victim@x.com" },
        "token_added_at": "2026-01-01T00:00:00Z", "token_refreshed_at": "2026-01-01T00:00:00Z",
        "token_expires_at": "2027-01-01T00:00:00Z", "active": false, "last_switch_out": null }
    }
  }' > "$PD/accounts.json"
  out_f="$(CC_MASTER_HOME="$PD" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
           bash "$DEL_SH" --email "victim@x.com" --vault-kind file --vault-file "/explicit/fixed.env" --dry-run 2>&1)"; rc_f=$?
  assert_eq "0" "$rc_f" "(P2-12b) file explicit-vault-file dry-run exits 0"
  assert_contains "$out_f" "@ /explicit/fixed.env" "(P2-12b) plan targets EXPLICIT vault file (not registry path)"
  assert_not_contains "$out_f" "/registry/stale.env" "(P2-12b) plan must NOT fall back to registry path when explicit given"

  # ── (P2-12c·no explicit → registry inference still works) confirm the guard didn't break inference: with NO
  #    --keychain-service, the registry value MUST still be used (explicit > registry > default ordering intact).
  printf '%s\n' '{
    "schema": "cc-master/accounts/v1",
    "accounts": {
      "victim@x.com": { "vault": { "kind": "keychain", "service": "registry-svc", "account": "victim@x.com" },
        "token_added_at": "2026-01-01T00:00:00Z", "token_refreshed_at": "2026-01-01T00:00:00Z",
        "token_expires_at": "2027-01-01T00:00:00Z", "active": false, "last_switch_out": null }
    }
  }' > "$PD/accounts.json"
  out_inf="$(CC_MASTER_HOME="$PD" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
             bash "$DEL_SH" --email "victim@x.com" --vault-kind keychain --dry-run 2>&1)"; rc_inf=$?
  assert_eq "0" "$rc_inf" "(P2-12c) no-explicit dry-run exits 0"
  assert_contains "$out_inf" "-s registry-svc" "(P2-12c) registry inference still used when NO explicit flag (guard didn't break inference)"

  rm -rf "$PD"

  # ── TEETH PROOF (P2-12): reproduce the OLD unconditional-override shape and assert it CLOBBERS the explicit
  #    value with the registry value → the new asserts would FAIL against it. Isolated counter (not suite).
  echo "-- teeth: OLD unconditional registry override must regress (explicit --keychain-service ignored) --"
  # Simulate the OLD logic in isolation: KEYCHAIN_SERVICE starts as the user's explicit value, then OLD code
  #   `[ -n "$REG_SERVICE" ] && KEYCHAIN_SERVICE="$REG_SERVICE"` overwrites it unconditionally.
  EXPLICIT_VAL="explicit-svc"; REG_VAL="registry-svc"
  KEYCHAIN_SERVICE_old="$EXPLICIT_VAL"; KEYCHAIN_SERVICE_EXPLICIT_old=1; REG_SERVICE_old="$REG_VAL"
  # OLD shape (no _EXPLICIT guard):
  [ -n "$REG_SERVICE_old" ] && KEYCHAIN_SERVICE_old="$REG_SERVICE_old"
  # NEW shape (with _EXPLICIT guard):
  KEYCHAIN_SERVICE_new="$EXPLICIT_VAL"
  [ "$KEYCHAIN_SERVICE_EXPLICIT_old" -ne 1 ] && [ -n "$REG_SERVICE_old" ] && KEYCHAIN_SERVICE_new="$REG_SERVICE_old"
  p12_teeth_ok=1
  # OLD must have CLOBBERED explicit → registry value (bug reproduced)
  [ "$KEYCHAIN_SERVICE_old" = "$REG_VAL" ] || p12_teeth_ok=0
  # NEW must have KEPT the explicit value (fix holds)
  [ "$KEYCHAIN_SERVICE_new" = "$EXPLICIT_VAL" ] || p12_teeth_ok=0
  if [ "$p12_teeth_ok" -eq 1 ]; then
    PASS=$((PASS+1)); _green "teeth OK: OLD unconditional override clobbers explicit (${EXPLICIT_VAL} -> ${REG_VAL}); NEW guard keeps explicit -> fix is load-bearing"
  else
    FAILED=$((FAILED+1)); _red "FAIL: (P2-12) teeth proof - OLD shape did not regress / NEW guard did not hold; test has no bite"
  fi
fi

# ── (P3a) **codex round#3 — account-delete.sh delete_vault_file matches ONLY exact rows (sibling safety)** ──
# 病根：旧 delete_vault_file 用宽前缀 `<email>_` 删——删 `foo` 会把 sibling `foo_bar_TOKEN=`/`_EXPIRES=` 也删掉
#   → 误毁另一个号、使其 unswitchable。修：只删本号**精确**的 `<email>_TOKEN=` / `<email>_EXPIRES=` 两类行。
# teeth：file vault 预置 sibling `foo_bar@x.com` + 目标 `foo@x.com` → 真跑 account-delete.sh 删 `foo@x.com`（file
#   vault·--registry 指向无该 entry 的空 registry·走 file 删行）→ 断言 foo 两行删净、sibling foo_bar 两行**存活**.
echo "-- (P3a) account-delete.sh delete_vault_file overlapping-identifier safety (deleting foo must NOT clobber foo_bar) --"
DEL_SH2="$PLUGIN_ROOT/skills/account-management/scripts/account-delete.sh"
# account-delete.sh resolves the registry via defaultRegistryPath() = $CC_MASTER_HOME/accounts.json (no --registry flag).
P3A="$(make_project)"; P3A_VF="$P3A/accounts.env"; P3A_REG="$P3A/accounts.json"
printf '%s\n' '{ "schema": "cc-master/accounts/v1", "accounts": {} }' > "$P3A_REG"
{
  printf 'foo_bar@x.com_TOKEN=sibling-keep-BBB\n'
  printf 'foo_bar@x.com_EXPIRES=2099-01-01\n'
  printf 'foo@x.com_TOKEN=target-gone-AAA\n'
  printf 'foo@x.com_EXPIRES=2099-01-01\n'
} > "$P3A_VF"; chmod 600 "$P3A_VF"
out_p3a="$(CC_MASTER_HOME="$P3A" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
          bash "$DEL_SH2" --email "foo@x.com" --vault-kind file --vault-file "$P3A_VF" 2>&1)"; rc_p3a=$?
assert_eq "0" "$rc_p3a" "(P3a) delete foo@x.com (file vault) exits 0"
# target foo@x.com both lines GONE.
if grep -q "target-gone-AAA" "$P3A_VF" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (P3a) target foo@x.com token NOT deleted"; else PASS=$((PASS+1)); _green "(P3a) target foo@x.com _TOKEN deleted"; fi
# **CORE**: sibling foo_bar@x.com rows MUST survive (the broad-prefix bug deleted them too).
if grep -q "sibling-keep-BBB" "$P3A_VF" 2>/dev/null; then PASS=$((PASS+1)); _green "(P3a) CORE: sibling foo_bar@x.com _TOKEN SURVIVES delete-of-foo (exact-row match)"; else FAILED=$((FAILED+1)); _red "FAIL: (P3a) sibling foo_bar@x.com _TOKEN DELETED by delete-of-foo — overlapping-identifier bug in delete"; fi
if grep -q '^foo_bar@x.com_EXPIRES=2099-01-01$' "$P3A_VF" 2>/dev/null; then PASS=$((PASS+1)); _green "(P3a) sibling foo_bar@x.com _EXPIRES survives too"; else FAILED=$((FAILED+1)); _red "FAIL: (P3a) sibling foo_bar@x.com _EXPIRES deleted by delete-of-foo"; fi
# token-blind: no token VALUE printed by delete.
assert_not_contains "$out_p3a" "sibling-keep-BBB" "(P3a) delete output does NOT print sibling token value (token-blind)"
rm -rf "$P3A"

# ── (P3b) **codex round#3 — delete_vault_file: rename failure → return non-zero (NOT false-success)** ──
# 病根：旧 delete_vault_file 只看 awk 退出码；mv 失败（权限/race）时仍 fall through 按 before 报成功 → caller 继续
#   删 registry entry，而 token 仍在 vault = token 残留 + 指针丢失（registry 不再指向它、却删不掉）。修：mv 失败 →
#   return 1，caller 不继续删 registry（token 与 registry 仍一致地都留着·可重试）。
# teeth：把 vault 文件所在**目录设只读** → awk 能读、能写 temp？不——temp 也在该目录建不了。改用更精准的注入：让
#   vault 文件本身可读、目录可写到能建 temp，但**目标文件不可替换**——最稳的 deterministic 复现是目录只读（mktemp/temp
#   建不了 → 走 ${VAULT_FILE}.tmp.$$ 也建不了 → awk 重定向失败 → 已在「删行失败」分支 return 1）。为专测 mv 失败分支，
#   用一个 mv STUB（PATH 注入·让 mv 必败）保持 awk 写 temp 成功、只让 rename 失败。断言：exit非0 + 原 vault 原封不动.
echo "-- (P3b) account-delete.sh delete_vault_file rename-failure → exit非0 (token survives·不谎报删净) --"
P3B="$(make_project)"; P3B_VF="$P3B/accounts.env"; P3B_REG="$P3B/accounts.json"
printf '%s\n' '{ "schema": "cc-master/accounts/v1", "accounts": {} }' > "$P3B_REG"
printf 'foo@x.com_TOKEN=must-survive-rename-fail-CCC\nfoo@x.com_EXPIRES=2099-01-01\n' > "$P3B_VF"; chmod 600 "$P3B_VF"
P3B_BEFORE="$(cat "$P3B_VF")"
# mv STUB: always fail (so the rename in delete_vault_file fails while awk-to-temp succeeds). Other tools real.
MVSTUB="$(make_project)"
cat > "$MVSTUB/mv" <<'MV'
#!/usr/bin/env bash
exit 1
MV
chmod +x "$MVSTUB/mv"
out_p3b="$(PATH="$MVSTUB:$PATH" CC_MASTER_HOME="$P3B" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
          bash "$DEL_SH2" --email "foo@x.com" --vault-kind file --vault-file "$P3B_VF" 2>&1)"; rc_p3b=$?
if [ "$rc_p3b" -ne 0 ]; then PASS=$((PASS+1)); _green "(P3b) rename failure → account-delete exits非0 (not false-success)"; else FAILED=$((FAILED+1)); _red "FAIL: (P3b) rename failure but account-delete exited 0 (谎报删净)"; fi
# the original vault file must be UNCHANGED — token still there (delete did NOT complete).
P3B_AFTER="$(cat "$P3B_VF" 2>/dev/null || echo '<UNREADABLE>')"
assert_eq "$P3B_BEFORE" "$P3B_AFTER" "(P3b) ORIGINAL vault UNCHANGED on rename failure (token survives·删未完成)"
if grep -q "must-survive-rename-fail-CCC" "$P3B_VF" 2>/dev/null; then PASS=$((PASS+1)); _green "(P3b) token still present after rename failure (not lost·registry 也不会被删·一致)"; else FAILED=$((FAILED+1)); _red "FAIL: (P3b) token GONE after rename failure"; fi
rm -rf "$P3B" "$MVSTUB"

finish
