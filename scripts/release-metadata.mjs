#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const semverCore = '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)';
const tagPattern = new RegExp(`^(?<prefix>v|ccm-v)(?<core>${semverCore})(?<rc>-rc\\.(?:0|[1-9]\\d*))?$`, 'u');
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const maxSummaryLength = 180;

const familyContracts = {
  plugin: {
    productName: 'cc-master plugin',
    changelogPath: 'CHANGELOG.md',
    section(version) {
      return new RegExp(`^## \\[${escapeRegExp(version.slice(1))}\\](?:\\s|$)`, 'u');
    },
  },
  ccm: {
    productName: 'ccm',
    changelogPath: 'ccm/apps/cli/CHANGELOG.md',
    section(version) {
      return new RegExp(`^## ${escapeRegExp(version.slice(1))}(?:\\s|$)`, 'u');
    },
  },
};

export class ReleaseMetadataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseMetadataError';
  }
}

function fail(message) {
  throw new ReleaseMetadataError(message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseTag(tag) {
  if (typeof tag !== 'string' || tag.trim() !== tag || tag === '') {
    fail('tag must be a non-empty string without surrounding whitespace');
  }
  const match = tagPattern.exec(tag);
  if (!match?.groups) {
    fail(`tag ${JSON.stringify(tag)} must match vX.Y.Z[-rc.N] or ccm-vX.Y.Z[-rc.N]`);
  }
  const family = match.groups.prefix === 'v' ? 'plugin' : 'ccm';
  return {
    family,
    tag,
    version: `v${match.groups.core}${match.groups.rc || ''}`,
    prerelease: Boolean(match.groups.rc),
    ...familyContracts[family],
  };
}

function normalizeSummary(line) {
  let summary = line.trim();
  if (summary.startsWith('>')) summary = summary.slice(1).trim();
  if (summary.startsWith('- ')) summary = summary.slice(2).trim();
  summary = summary.replace(/\*\*/gu, '');
  if (summary.length === 0) fail('changelog summary must be non-empty');
  if (/\r|\n/u.test(summary)) fail('changelog summary must fit on one line');
  if (summary.length > maxSummaryLength) {
    fail(`changelog summary must be concise (at most ${maxSummaryLength} characters)`);
  }
  return summary;
}

function extractSummary(changelogText, contract) {
  if (typeof changelogText !== 'string') fail('changelog text must be a string');
  const lines = changelogText.replaceAll('\r\n', '\n').split('\n');
  const sectionIndex = lines.findIndex((line) => contract.section(contract.version).test(line));
  if (sectionIndex < 0) {
    fail(`changelog ${contract.changelogPath} has no section for ${contract.version}`);
  }
  for (const line of lines.slice(sectionIndex + 1)) {
    if (/^## (?!#)/u.test(line)) break;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('### ')) continue;
    return normalizeSummary(trimmed);
  }
  fail(`changelog ${contract.changelogPath} needs a concise summary line for ${contract.version}`);
}

function expectedBodyPattern(metadata) {
  const tag = escapeRegExp(metadata.tag);
  const changelogPath = escapeRegExp(metadata.changelogPath);
  return new RegExp(
    `^${escapeRegExp(metadata.summary)}\\n\\nSee \\[CHANGELOG\\]\\(https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/blob/${tag}/${changelogPath}\\)\\.$`,
    'u',
  );
}

export function validateReleaseMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('metadata must be an object');
  }
  const contract = parseTag(metadata.tag);
  const expectedTitle = `${contract.productName} ${contract.version}`;
  if (metadata.family !== contract.family) {
    fail(`family must be exactly ${contract.family} for tag ${contract.tag}`);
  }
  if (metadata.productName !== contract.productName) {
    fail(`productName must be exactly ${contract.productName}`);
  }
  if (metadata.version !== contract.version) {
    fail(`version must be exactly ${contract.version}`);
  }
  if (metadata.title !== expectedTitle) {
    fail(`title must be exactly ${expectedTitle}`);
  }
  if (metadata.prerelease !== contract.prerelease) {
    fail(`prerelease must be ${contract.prerelease} for tag ${contract.tag}`);
  }
  if (metadata.changelogPath !== contract.changelogPath) {
    fail(`changelogPath must be exactly ${contract.changelogPath}`);
  }
  if (typeof metadata.summary !== 'string') fail('summary must be a string');
  normalizeSummary(metadata.summary);
  if (typeof metadata.body !== 'string' || !expectedBodyPattern(metadata).test(metadata.body)) {
    fail('body must be exactly one summary line, one blank line, and a tag-pinned See CHANGELOG link');
  }
  return metadata;
}

export function planReleaseMetadata({ tag, repository, changelogText } = {}) {
  const contract = parseTag(tag);
  if (typeof repository !== 'string' || !repositoryPattern.test(repository)) {
    fail('repository must use the owner/name form');
  }
  const source = changelogText ?? readFileSync(path.join(repoRoot, contract.changelogPath), 'utf8');
  const summary = extractSummary(source, contract);
  const title = `${contract.productName} ${contract.version}`;
  const body = `${summary}\n\nSee [CHANGELOG](https://github.com/${repository}/blob/${tag}/${contract.changelogPath}).`;
  return validateReleaseMetadata({
    tag,
    family: contract.family,
    productName: contract.productName,
    version: contract.version,
    title,
    prerelease: contract.prerelease,
    summary,
    changelogPath: contract.changelogPath,
    body,
  });
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (command !== 'plan' && command !== 'validate') {
    fail('usage: release-metadata.mjs plan --tag TAG --repository OWNER/REPO [--github-output FILE] | validate --metadata-json JSON');
  }
  const values = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith('--')) fail(`unexpected argument ${key}`);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${key} requires a value`);
    const name = key.slice(2).replaceAll('-', '_');
    if (Object.hasOwn(values, name)) fail(`${key} may only be supplied once`);
    values[name] = value;
    index += 1;
  }
  return values;
}

function writeGitHubOutput(outputPath, metadata) {
  const delimiter = `CC_MASTER_RELEASE_BODY_${createHash('sha256').update(metadata.body).digest('hex').slice(0, 16)}`;
  if (metadata.body.includes(delimiter)) fail('body collides with the GitHub output delimiter');
  appendFileSync(
    outputPath,
    [
      `title=${metadata.title}`,
      `prerelease=${String(metadata.prerelease)}`,
      `body<<${delimiter}`,
      metadata.body,
      delimiter,
      `tag=${metadata.tag}`,
      `family=${metadata.family}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

function main(argv) {
  const args = parseArguments(argv);
  if (args.command === 'plan') {
    if (!args.tag || !args.repository) fail('plan requires --tag and --repository');
    const metadata = planReleaseMetadata({ tag: args.tag, repository: args.repository });
    if (args.github_output) writeGitHubOutput(args.github_output, metadata);
    else process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
    return;
  }
  if (!args.metadata_json) fail('validate requires --metadata-json');
  let metadata;
  try {
    metadata = JSON.parse(args.metadata_json);
  } catch (error) {
    fail(`--metadata-json is not valid JSON: ${error.message}`);
  }
  validateReleaseMetadata(metadata);
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`release-metadata: ERROR: ${message}\n`);
    process.exitCode = 1;
  }
}
