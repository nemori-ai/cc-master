#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function usage() {
  process.stderr.write(
    'usage: macos-evidence-manifest.mjs <write|verify> <root> <manifest>\n',
  );
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function memberFor(root, file) {
  return relative(root, file).split(sep).join('/');
}

function validateMember(member, lineNumber) {
  const prefix = lineNumber === undefined ? 'member' : `manifest line ${lineNumber}`;
  if (!member || member.includes('\0') || member.includes('\n') || member.includes('\r')) {
    throw new Error(`${prefix}: empty or control-character path`);
  }
  if (member.includes('\\') || member.startsWith('/') || isAbsolute(member)) {
    throw new Error(`${prefix}: path must be a POSIX relative path: ${member}`);
  }
  const parts = member.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${prefix}: path traversal or non-canonical segment: ${member}`);
  }
}

function assertDirectory(root) {
  if (!existsSync(root)) throw new Error(`root does not exist: ${root}`);
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`root must be a real directory: ${root}`);
  }
}

function assertManifestLocation(root, manifest) {
  if (isWithin(root, manifest) && memberFor(root, manifest) !== 'SHA256SUMS') {
    throw new Error(`a manifest inside the evidence root must be the root SHA256SUMS: ${manifest}`);
  }
}

function collectFiles(root, manifest) {
  const manifestIsInside = isWithin(root, manifest);
  const files = [];

  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const entry = resolve(dir, name);
      if (manifestIsInside && entry === manifest) continue;
      const stat = lstatSync(entry);
      if (stat.isSymbolicLink()) {
        throw new Error(`unsupported symbolic link in evidence tree: ${memberFor(root, entry)}`);
      }
      if (stat.isDirectory()) walk(entry);
      else if (stat.isFile()) files.push(entry);
      else throw new Error(`unsupported special file in evidence tree: ${memberFor(root, entry)}`);
    }
  }

  walk(root);
  return files;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function writeManifest(root, manifest) {
  assertDirectory(root);
  assertManifestLocation(root, manifest);
  if (existsSync(manifest)) {
    const stat = lstatSync(manifest);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`manifest must be a real regular file: ${manifest}`);
    }
  }

  const entries = collectFiles(root, manifest).map((file) => {
    const member = memberFor(root, file);
    validateMember(member);
    return `${sha256(file)}  ${member}`;
  });
  const content = entries.length === 0 ? '' : `${entries.join('\n')}\n`;
  mkdirSync(dirname(manifest), { recursive: true });
  const temporary = `${manifest}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, manifest);
  } finally {
    rmSync(temporary, { force: true });
  }
  process.stdout.write(`manifest written: entries=${entries.length} manifest=${manifest}\n`);
}

function parseManifest(manifest) {
  if (!existsSync(manifest)) throw new Error(`manifest is missing: ${manifest}`);
  const stat = lstatSync(manifest);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`manifest must be a real regular file: ${manifest}`);
  }
  const text = readFileSync(manifest, 'utf8');
  if (text !== '' && !text.endsWith('\n')) {
    throw new Error('manifest must end with a newline');
  }
  const lines = text === '' ? [] : text.slice(0, -1).split('\n');
  const seen = new Set();
  return lines.map((line, index) => {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`manifest line ${index + 1}: expected 64hex, two spaces, path`);
    const [, hash, member] = match;
    validateMember(member, index + 1);
    if (seen.has(member)) throw new Error(`manifest line ${index + 1}: duplicate member: ${member}`);
    seen.add(member);
    return { hash, member };
  });
}

function verifyManifest(root, manifest) {
  assertDirectory(root);
  assertManifestLocation(root, manifest);
  const entries = parseManifest(manifest);
  const actualFiles = collectFiles(root, manifest);
  const actual = new Map(actualFiles.map((file) => [memberFor(root, file), file]));
  const declared = new Set(entries.map((entry) => entry.member));
  const missing = entries.filter((entry) => !actual.has(entry.member)).map((entry) => entry.member);
  const corrupt = entries
    .filter((entry) => actual.has(entry.member) && sha256(actual.get(entry.member)) !== entry.hash)
    .map((entry) => entry.member);
  const extra = [...actual.keys()].filter((member) => !declared.has(member));

  if (missing.length || corrupt.length || extra.length || actual.size !== entries.length) {
    throw new Error(
      `manifest closure mismatch: declared=${entries.length} actual=${actual.size}` +
        ` missing=${missing.join(',') || '-'} corrupt=${corrupt.join(',') || '-'}` +
        ` extra=${extra.join(',') || '-'}`,
    );
  }
  process.stdout.write(`manifest verified: entries=${entries.length} manifest=${manifest}\n`);
}

const [command, rootArgument, manifestArgument] = process.argv.slice(2);
if (!['write', 'verify'].includes(command) || !rootArgument || !manifestArgument) {
  usage();
  process.exit(2);
}

const root = resolve(rootArgument);
const manifest = resolve(manifestArgument);
try {
  if (command === 'write') writeManifest(root, manifest);
  else verifyManifest(root, manifest);
} catch (error) {
  process.stderr.write(`macOS evidence manifest ${command} failed: ${error.message}\n`);
  process.exit(1);
}
