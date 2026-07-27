import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { canonicalHash } from './canonical-contract.mjs';

const require = createRequire(import.meta.url);
const { projectAndPublishHostSurface } = require(
  '../../../../scripts/skill-knowledge/sync-host-surface.cjs',
);

const input = JSON.parse(process.argv[2] ?? '{}');
const {
  repoRoot,
  host,
  stamp,
  mutation,
  failpoint,
  tracePath,
  resultPath,
} = input;

function appendTrace(checkpoint, details = {}) {
  fs.appendFileSync(
    tracePath,
    `${JSON.stringify({
      checkpoint,
      details,
    })}\n`,
  );
}

function sortedRegularFiles(root) {
  const hits = [];
  function visit(absolute, relative) {
    for (const name of fs.readdirSync(absolute).sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    )) {
      const child = path.join(absolute, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(child, childRelative);
      else if (stat.isFile() && stat.nlink === 1) hits.push(childRelative);
    }
  }
  visit(root, '');
  return hits;
}

function mutationTarget(stagingAbsolute) {
  const relative = sortedRegularFiles(stagingAbsolute)[0];
  if (!relative) throw new Error('TPT driver found no ordinary candidate artifact');
  return { relative, absolute: path.join(stagingAbsolute, relative) };
}

function sourceMutationTarget() {
  const sourceRoot = path.join(repoRoot, 'plugin/src');
  const preferred = 'hooks/_shared/deadline-risk-core.js';
  const absolute = path.join(sourceRoot, preferred);
  if (!fs.lstatSync(absolute).isFile()) {
    throw new Error('TPT driver source-drift fixture is missing');
  }
  return {
    relative: preferred,
    absolute,
  };
}

function applyLateMutation({ stagingAbsolute }) {
  appendTrace(
    'sync-host-surface:injectLateFault:after-compile-attestation-before-publish',
    { mutation },
  );
  if (mutation === 'none') return;
  if (mutation === 'add-legal-artifact-after-attestation') {
    const relative = 'tpt-extra-artifact.md';
    fs.writeFileSync(
      path.join(stagingAbsolute, relative),
      `test-owned extra artifact ${input.seed}\n`,
    );
    appendTrace('mutation:applied', {
      mutation,
      target_sha256: canonicalHash('logical-path', { path: relative }),
    });
    return;
  }
  if (mutation === 'mutate-source-after-attestation') {
    const target = sourceMutationTarget();
    fs.appendFileSync(
      target.absolute,
      `\n<!-- tpt source drift ${input.seed} -->\n`,
    );
    appendTrace('mutation:applied', {
      mutation,
      target_sha256: canonicalHash('logical-path', { path: target.relative }),
    });
    return;
  }

  const target = mutationTarget(stagingAbsolute);
  if (mutation === 'rewrite-existing-artifact-after-attestation') {
    fs.appendFileSync(target.absolute, `\ntpt rewrite ${input.seed}\n`);
  } else if (mutation === 'flip-executable-bit-after-attestation') {
    const mode = fs.statSync(target.absolute).mode & 0o7777;
    fs.chmodSync(target.absolute, (mode & 0o111) === 0 ? mode | 0o111 : mode & ~0o111);
  } else if (mutation === 'replace-with-hardlink-after-attestation') {
    const backing = path.join(repoRoot, `.tpt-hardlink-${input.seed}`);
    fs.copyFileSync(target.absolute, backing);
    fs.chmodSync(backing, fs.statSync(target.absolute).mode & 0o7777);
    fs.unlinkSync(target.absolute);
    fs.linkSync(backing, target.absolute);
  } else {
    throw new Error(`unsupported TPT production mutation: ${mutation}`);
  }
  appendTrace('mutation:applied', {
    mutation,
    target_sha256: canonicalHash('logical-path', { path: target.relative }),
  });
}

try {
  const result = projectAndPublishHostSurface({
    repoRoot,
    host,
    stamp,
    injectLateFault: applyLateMutation,
    injectPostPublishFault:
      failpoint === 'sync-host-surface:post-publish'
        ? () => {
            appendTrace('sync-host-surface:injectPostPublishFault:after-publish', {
              failpoint,
            });
          }
        : undefined,
    warn() {},
  });
  appendTrace('projectAndPublishHostSurface:return', {
    committed: result.committed === true,
  });
  fs.writeFileSync(
    resultPath,
    `${JSON.stringify({
      production_returned: true,
      production_error_code: null,
      committed: result.committed === true,
    })}\n`,
  );
} catch (error) {
  appendTrace('projectAndPublishHostSurface:throw', {
    error_code: error?.code ?? error?.name ?? 'Error',
  });
  fs.writeFileSync(
    resultPath,
    `${JSON.stringify({
      production_returned: false,
      production_error_code: error?.code ?? error?.name ?? 'Error',
      committed: error?.sync_envelope?.residual_live_dist === true,
    })}\n`,
  );
  throw error;
}
