#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

CC_MASTER_INSTALL_SH_TEST_SOURCE=1 source ./install.sh

pass() { printf 'ok - %s\n' "$*"; }
fail() { printf 'not ok - %s\n' "$*" >&2; exit 1; }

asset="$tmp/asset.bin"
manifest="$tmp/SHA256SUMS"
printf 'release asset payload\n' >"$asset"
good_hash="$(sha256_file "$asset")"
printf '%s  asset.bin\n' "$good_hash" >"$manifest"

verify_sha256_manifest "$asset" "$manifest"
pass "valid SHA256SUMS entry verifies"

bad_manifest="$tmp/SHA256SUMS.bad"
printf '%064d  asset.bin\n' 0 >"$bad_manifest"
if ( verify_sha256_manifest "$asset" "$bad_manifest" ) >/dev/null 2>"$tmp/bad.err"; then
  fail "checksum mismatch should fail closed"
fi
grep -q "checksum 校验失败" "$tmp/bad.err" || fail "checksum mismatch explains failure"
pass "checksum mismatch fails closed"

missing_manifest="$tmp/SHA256SUMS.missing"
printf '%s  other.bin\n' "$good_hash" >"$missing_manifest"
if ( verify_sha256_manifest "$asset" "$missing_manifest" ) >/dev/null 2>"$tmp/missing.err"; then
  fail "manifest without asset entry should fail closed"
fi
grep -q "找不到 asset.bin" "$tmp/missing.err" || fail "missing manifest entry explains failure"
pass "missing asset entry fails closed"

LOCAL_SRC="$tmp/local-no-manifest"
mkdir -p "$LOCAL_SRC"
verify_downloaded_release_asset "local" "asset.bin" "$asset" "$tmp/unused-manifest"
pass "CC_MASTER_INSTALL_LOCAL without SHA256SUMS remains usable with explicit warning"

LOCAL_SRC="$tmp/local-bad-manifest"
mkdir -p "$LOCAL_SRC"
cp "$bad_manifest" "$LOCAL_SRC/SHA256SUMS"
if ( verify_downloaded_release_asset "local" "asset.bin" "$asset" "$tmp/unused-manifest" ) >/dev/null 2>"$tmp/local-bad.err"; then
  fail "CC_MASTER_INSTALL_LOCAL with bad SHA256SUMS should fail closed"
fi
grep -q "checksum 校验失败" "$tmp/local-bad.err" || fail "local bad checksum explains failure"
pass "CC_MASTER_INSTALL_LOCAL verifies SHA256SUMS when present"
