import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(cliDir, 'native', `runtime-invoke-helper-${process.platform}.c`);
const outputDir = join(cliDir, '.native-build');
const output = join(outputDir, 'runtime-invoke-helper');
const metadata = join(outputDir, 'runtime-invoke-helper.json');
const temporary = join(outputDir, `.runtime-invoke-helper-${process.pid}.tmp`);
const compiler = process.env.CC || 'cc';
const contract =
  process.platform === 'linux'
    ? 'linux-exact-fd-v1'
    : process.platform === 'darwin'
      ? 'darwin-path-attested-v1'
      : null;

if (contract === null || !['x64', 'arm64'].includes(process.arch)) {
  throw new Error(
    `runtime invoke helper can only be built for linux/darwin x64/arm64; observed ${process.platform}/${process.arch}`,
  );
}

mkdirSync(outputDir, { recursive: true, mode: 0o700 });
rmSync(temporary, { force: true });
const compiled = spawnSync(
  compiler,
  ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', source, '-o', temporary],
  { encoding: 'utf8' },
);
if (compiled.error || compiled.status !== 0) {
  rmSync(temporary, { force: true });
  throw new Error(
    `failed to build ${contract} with ${compiler}: ${compiled.error?.message || compiled.stderr || compiled.stdout}`,
  );
}

chmodSync(temporary, 0o500);
renameSync(temporary, output);
const bytes = readFileSync(output);
const sha256 = createHash('sha256').update(bytes).digest('hex');
writeFileSync(
  metadata,
  `${JSON.stringify(
    {
      contract,
      platform: process.platform,
      arch: process.arch,
      sha256,
      size: bytes.length,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
process.stdout.write(
  `[runtime-invoke-helper] ${contract} ${process.platform}/${process.arch} ${sha256} (${bytes.length} bytes)\n`,
);
