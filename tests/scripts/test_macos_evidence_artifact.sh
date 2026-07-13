#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

source_tree="$tmp/source"
upload_tree="$tmp/upload"
download_tree="$tmp/download"
workflow=".github/workflows/macos-live-qualification.yml"

mkdir -p \
  "$source_tree/Fresh Home with spaces 用户/.cc_master/runtime/transactions" \
  "$source_tree/plugin-extract-claude-code/cc-master/.claude-plugin" \
  "$source_tree/plugins"
printf '%s\n' 'visible evidence' >"$source_tree/environment.log"
printf '%s\n' 'hidden runtime state' \
  >"$source_tree/Fresh Home with spaces 用户/.cc_master/runtime/transactions/tx.json"
printf '%s\n' '{"name":"cc-master"}' \
  >"$source_tree/plugin-extract-claude-code/cc-master/.claude-plugin/plugin.json"
printf '%s\n' 'nested plugin checksum ledger' >"$source_tree/plugins/SHA256SUMS"
printf '%s\n' 'required_failures=0' >"$source_tree/summary.txt"
node scripts/macos-evidence-manifest.mjs write \
  "$source_tree" "$source_tree/SHA256SUMS"
grep -q '  plugins/SHA256SUMS$' "$source_tree/SHA256SUMS"
grep -q '  summary.txt$' "$source_tree/SHA256SUMS"

include_hidden="$(node - "$workflow" <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const match = text.match(
  /- name: Upload raw qualification evidence\n([\s\S]*?)(?=\n {6}- name:|\n {2}[a-z][a-z-]*:|$)/,
);
if (!match) throw new Error('raw qualification evidence upload step is missing');
process.stdout.write(/^[ \t]+include-hidden-files:[ \t]+true[ \t]*$/m.test(match[1]) ? 'true' : 'false');
NODE
)"

node - "$source_tree" "$upload_tree" "$include_hidden" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [source, destination, includeHiddenText] = process.argv.slice(2);
const includeHidden = includeHiddenText === 'true';
function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const entry = path.join(dir, name);
    const relative = path.relative(source, entry);
    const hidden = relative.split(path.sep).some((part) => part.startsWith('.'));
    const stat = fs.lstatSync(entry);
    if (stat.isDirectory()) {
      if (includeHidden || !hidden) walk(entry);
    } else if (stat.isFile() && (includeHidden || !hidden)) {
      const target = path.join(destination, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(entry, target);
    }
  }
}
fs.mkdirSync(destination, { recursive: true });
walk(source);
NODE

tar -C "$upload_tree" -cf "$tmp/evidence-artifact.tar" .
mkdir -p "$download_tree"
tar -C "$download_tree" -xf "$tmp/evidence-artifact.tar"

node scripts/macos-evidence-manifest.mjs verify \
  "$download_tree" "$download_tree/SHA256SUMS"

outer_tree="$tmp/outer"
mkdir -p "$outer_tree"
cp -R "$download_tree" "$outer_tree/macos-live-evidence-darwin-arm64"
cp -R "$download_tree" "$outer_tree/macos-live-evidence-darwin-x64"
node scripts/macos-evidence-manifest.mjs write \
  "$outer_tree" "$tmp/EVIDENCE_SHA256SUMS"
node scripts/macos-evidence-manifest.mjs verify \
  "$outer_tree" "$tmp/EVIDENCE_SHA256SUMS"

outer_missing_tree="$tmp/outer-missing-hidden"
cp -R "$outer_tree" "$outer_missing_tree"
rm "$outer_missing_tree/macos-live-evidence-darwin-arm64/Fresh Home with spaces 用户/.cc_master/runtime/transactions/tx.json"
if node scripts/macos-evidence-manifest.mjs verify \
  "$outer_missing_tree" "$tmp/EVIDENCE_SHA256SUMS" >"$tmp/outer-missing.out" 2>"$tmp/outer-missing.err"; then
  printf '%s\n' 'not ok - the outer index must reject a missing hidden member' >&2
  exit 1
fi
grep -q 'missing=.*macos-live-evidence-darwin-arm64/Fresh Home with spaces 用户/.cc_master/runtime/transactions/tx.json' \
  "$tmp/outer-missing.err"

outer_corrupt_tree="$tmp/outer-corrupt-hidden"
cp -R "$outer_tree" "$outer_corrupt_tree"
printf '%s\n' 'outer mutation' \
  >>"$outer_corrupt_tree/macos-live-evidence-darwin-x64/plugin-extract-claude-code/cc-master/.claude-plugin/plugin.json"
if node scripts/macos-evidence-manifest.mjs verify \
  "$outer_corrupt_tree" "$tmp/EVIDENCE_SHA256SUMS" >"$tmp/outer-corrupt.out" 2>"$tmp/outer-corrupt.err"; then
  printf '%s\n' 'not ok - the outer index must reject a corrupt hidden member' >&2
  exit 1
fi
grep -q 'corrupt=.*macos-live-evidence-darwin-x64/plugin-extract-claude-code/cc-master/.claude-plugin/plugin.json' \
  "$tmp/outer-corrupt.err"

outer_extra_tree="$tmp/outer-extra-member"
cp -R "$outer_tree" "$outer_extra_tree"
printf '%s\n' 'undeclared outer evidence' \
  >"$outer_extra_tree/macos-live-evidence-darwin-arm64/unexpected-outer.log"
if node scripts/macos-evidence-manifest.mjs verify \
  "$outer_extra_tree" "$tmp/EVIDENCE_SHA256SUMS" >"$tmp/outer-extra.out" 2>"$tmp/outer-extra.err"; then
  printf '%s\n' 'not ok - the outer index must reject an undeclared member' >&2
  exit 1
fi
grep -q 'extra=.*macos-live-evidence-darwin-arm64/unexpected-outer.log' \
  "$tmp/outer-extra.err"

missing_tree="$tmp/missing-hidden"
cp -R "$download_tree" "$missing_tree"
rm "$missing_tree/Fresh Home with spaces 用户/.cc_master/runtime/transactions/tx.json"
if node scripts/macos-evidence-manifest.mjs verify \
  "$missing_tree" "$missing_tree/SHA256SUMS" >"$tmp/missing.out" 2>"$tmp/missing.err"; then
  printf '%s\n' 'not ok - removing a hidden manifest member must fail closed' >&2
  exit 1
fi
grep -q 'missing=.*Fresh Home with spaces 用户/.cc_master/runtime/transactions/tx.json' \
  "$tmp/missing.err"

corrupt_tree="$tmp/corrupt-hidden"
cp -R "$download_tree" "$corrupt_tree"
printf '%s\n' 'mutation' \
  >>"$corrupt_tree/plugin-extract-claude-code/cc-master/.claude-plugin/plugin.json"
if node scripts/macos-evidence-manifest.mjs verify \
  "$corrupt_tree" "$corrupt_tree/SHA256SUMS" >"$tmp/corrupt.out" 2>"$tmp/corrupt.err"; then
  printf '%s\n' 'not ok - corrupting a hidden manifest member must fail closed' >&2
  exit 1
fi
grep -q 'corrupt=.*plugin-extract-claude-code/cc-master/.claude-plugin/plugin.json' \
  "$tmp/corrupt.err"

extra_tree="$tmp/extra-member"
cp -R "$download_tree" "$extra_tree"
printf '%s\n' 'undeclared inner evidence' >"$extra_tree/unexpected-inner.log"
if node scripts/macos-evidence-manifest.mjs verify \
  "$extra_tree" "$extra_tree/SHA256SUMS" >"$tmp/extra.out" 2>"$tmp/extra.err"; then
  printf '%s\n' 'not ok - the inner manifest must reject an undeclared member' >&2
  exit 1
fi
grep -q 'extra=.*unexpected-inner.log' "$tmp/extra.err"

duplicate_tree="$tmp/duplicate-member"
cp -R "$download_tree" "$duplicate_tree"
first_manifest_line="$(sed -n '1p' "$duplicate_tree/SHA256SUMS")"
printf '%s\n' "$first_manifest_line" >>"$duplicate_tree/SHA256SUMS"
if node scripts/macos-evidence-manifest.mjs verify \
  "$duplicate_tree" "$duplicate_tree/SHA256SUMS" \
  >"$tmp/duplicate.out" 2>"$tmp/duplicate.err"; then
  printf '%s\n' 'not ok - duplicate manifest members must fail closed' >&2
  exit 1
fi
grep -q 'duplicate member:' "$tmp/duplicate.err"

zero_hash="$(printf '%064d' 0)"

traversal_tree="$tmp/traversal-member"
mkdir -p "$traversal_tree"
printf '%s\n' 'payload' >"$traversal_tree/evidence.log"
printf '%s  %s\n' "$zero_hash" '../escape.log' >"$traversal_tree/SHA256SUMS"
if node scripts/macos-evidence-manifest.mjs verify \
  "$traversal_tree" "$traversal_tree/SHA256SUMS" \
  >"$tmp/traversal.out" 2>"$tmp/traversal.err"; then
  printf '%s\n' 'not ok - traversal manifest members must fail closed' >&2
  exit 1
fi
grep -q 'path traversal or non-canonical segment: ../escape.log' "$tmp/traversal.err"

absolute_tree="$tmp/absolute-member"
mkdir -p "$absolute_tree"
printf '%s\n' 'payload' >"$absolute_tree/evidence.log"
printf '%s  %s\n' "$zero_hash" '/absolute/evidence.log' >"$absolute_tree/SHA256SUMS"
if node scripts/macos-evidence-manifest.mjs verify \
  "$absolute_tree" "$absolute_tree/SHA256SUMS" \
  >"$tmp/absolute.out" 2>"$tmp/absolute.err"; then
  printf '%s\n' 'not ok - absolute manifest members must fail closed' >&2
  exit 1
fi
grep -q 'path must be a POSIX relative path: /absolute/evidence.log' "$tmp/absolute.err"

symlink_tree="$tmp/tree-symlink"
cp -R "$download_tree" "$symlink_tree"
ln -s environment.log "$symlink_tree/evidence-link"
if node scripts/macos-evidence-manifest.mjs verify \
  "$symlink_tree" "$symlink_tree/SHA256SUMS" \
  >"$tmp/tree-symlink.out" 2>"$tmp/tree-symlink.err"; then
  printf '%s\n' 'not ok - a symbolic link in the evidence tree must fail closed' >&2
  exit 1
fi
grep -q 'unsupported symbolic link in evidence tree: evidence-link' "$tmp/tree-symlink.err"

manifest_symlink_tree="$tmp/manifest-symlink"
cp -R "$download_tree" "$manifest_symlink_tree"
cp "$manifest_symlink_tree/SHA256SUMS" "$tmp/manifest-target"
rm "$manifest_symlink_tree/SHA256SUMS"
ln -s "$tmp/manifest-target" "$manifest_symlink_tree/SHA256SUMS"
if node scripts/macos-evidence-manifest.mjs verify \
  "$manifest_symlink_tree" "$manifest_symlink_tree/SHA256SUMS" \
  >"$tmp/manifest-symlink.out" 2>"$tmp/manifest-symlink.err"; then
  printf '%s\n' 'not ok - a symbolic-link manifest must fail closed' >&2
  exit 1
fi
grep -q 'manifest must be a real regular file:' "$tmp/manifest-symlink.err"

fifo_tree="$tmp/fifo-member"
cp -R "$download_tree" "$fifo_tree"
mkfifo "$fifo_tree/evidence.pipe"
if node scripts/macos-evidence-manifest.mjs verify \
  "$fifo_tree" "$fifo_tree/SHA256SUMS" >"$tmp/fifo.out" 2>"$tmp/fifo.err"; then
  printf '%s\n' 'not ok - a FIFO in the evidence tree must fail closed' >&2
  exit 1
fi
grep -q 'unsupported special file in evidence tree: evidence.pipe' "$tmp/fifo.err"

nested_manifest_tree="$tmp/nested-manifest"
mkdir -p "$nested_manifest_tree/control"
printf '%s\n' 'payload' >"$nested_manifest_tree/evidence.log"
if node scripts/macos-evidence-manifest.mjs write \
  "$nested_manifest_tree" "$nested_manifest_tree/control/SHA256SUMS" \
  >"$tmp/nested-manifest.out" 2>"$tmp/nested-manifest.err"; then
  printf '%s\n' 'not ok - only the root self-manifest may be exempt from closure' >&2
  exit 1
fi
grep -q 'root SHA256SUMS' "$tmp/nested-manifest.err"

printf '%s\n' 'ok - raw qualification artifact replays every visible and hidden manifest member'
printf '%s\n' 'ok - inner and outer manifests are exact closed sets'
printf '%s\n' 'ok - inner and outer hidden member removal and corruption fail closed'
printf '%s\n' 'ok - extra, unsafe-path, duplicate, symlink, and FIFO evidence fails closed'
