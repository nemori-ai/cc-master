import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DurableWriteError,
  type DurableWriteFilesystem,
  durableWriteFileSync,
} from '../dist/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OLD_JSON = `${JSON.stringify({ revision: 'old', payload: 'o'.repeat(4096) })}\n`;
const NEW_JSON = `${JSON.stringify({ revision: 'new', payload: 'n'.repeat(8192) })}\n`;

interface ObservedFs {
  filesystem: DurableWriteFilesystem;
  events: string[];
  tempDirs: string[];
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`injected ${code}`), { code });
}

function observedFilesystem(
  target: string,
  faults: { fileSync?: string; directorySync?: string; rename?: string } = {},
): ObservedFs {
  const events: string[] = [];
  const tempDirs: string[] = [];
  const fdPaths = new Map<number, string>();
  const parent = dirname(target);
  const filesystem: DurableWriteFilesystem = {
    mkdtempSync(prefix) {
      const made = fs.mkdtempSync(prefix);
      events.push(`mkdtemp:${prefix}->${made}`);
      tempDirs.push(made);
      return made;
    },
    chmodSync(filePath, mode) {
      events.push(`chmod:${filePath}:${mode.toString(8)}`);
      fs.chmodSync(filePath, mode);
    },
    openSync(filePath, flags, mode) {
      events.push(`open:${filePath}:${flags}:${mode === undefined ? '' : mode.toString(8)}`);
      const fd = fs.openSync(filePath, flags, mode);
      fdPaths.set(fd, filePath);
      return fd;
    },
    fchmodSync(fd, mode) {
      events.push(`fchmod:${fdPaths.get(fd)}:${mode.toString(8)}`);
      fs.fchmodSync(fd, mode);
    },
    writeFileSync(fd, data) {
      events.push(`write:${fdPaths.get(fd)}:${Buffer.byteLength(data)}`);
      fs.writeFileSync(fd, data);
    },
    fsyncSync(fd) {
      const filePath = fdPaths.get(fd) || '';
      events.push(`fsync:${filePath}`);
      const code = filePath === parent ? faults.directorySync : faults.fileSync;
      if (code) throw errno(code);
      fs.fsyncSync(fd);
    },
    closeSync(fd) {
      events.push(`close:${fdPaths.get(fd)}`);
      fs.closeSync(fd);
      fdPaths.delete(fd);
    },
    renameSync(from, to) {
      events.push(`rename:${from}->${to}`);
      if (faults.rename) throw errno(faults.rename);
      fs.renameSync(from, to);
    },
    unlinkSync(filePath) {
      events.push(`unlink:${filePath}`);
      fs.unlinkSync(filePath);
    },
    rmdirSync(filePath) {
      events.push(`rmdir:${filePath}`);
      fs.rmdirSync(filePath);
    },
  };
  return { filesystem, events, tempDirs };
}

function fixture(): { root: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), 'ccm-durable-write-'));
  const target = join(root, 'state.json');
  writeFileSync(target, OLD_JSON, { mode: 0o600 });
  return { root, target };
}

function indexOf(events: string[], prefix: string): number {
  return events.findIndex((entry) => entry.startsWith(prefix));
}

test('durable writer uses target-adjacent owner-only temp, file fsync, rename, then directory fsync', () => {
  const f = fixture();
  try {
    const observed = observedFilesystem(f.target);
    const result = durableWriteFileSync(f.target, NEW_JSON, { filesystem: observed.filesystem });

    assert.deepEqual(result, {
      path: f.target,
      committed: true,
      file_sync: 'supported',
      directory_sync: 'supported',
    });
    assert.equal(readFileSync(f.target, 'utf8'), NEW_JSON);
    assert.deepEqual(JSON.parse(readFileSync(f.target, 'utf8')).revision, 'new');
    assert.equal(statSync(f.target).mode & 0o777, 0o600);

    assert.equal(observed.tempDirs.length, 1);
    const tempDir = observed.tempDirs[0] as string;
    assert.equal(dirname(tempDir), dirname(f.target), 'temp directory is target-adjacent');
    assert.ok(basename(tempDir).startsWith('.state.json.ccm-tmp-'));
    assert.ok(observed.events.includes(`chmod:${tempDir}:700`));
    const tempOpen = observed.events.find((entry) => entry.startsWith(`open:${tempDir}/`));
    assert.match(tempOpen || '', /:wx:600$/);

    const write = indexOf(observed.events, 'write:');
    const fileSync = observed.events.findIndex(
      (entry, index) =>
        index > write && entry.startsWith('fsync:') && !entry.endsWith(dirname(f.target)),
    );
    const rename = indexOf(observed.events, 'rename:');
    const directorySync = observed.events.findIndex(
      (entry, index) => index > rename && entry === `fsync:${dirname(f.target)}`,
    );
    assert.ok(write >= 0 && fileSync > write && rename > fileSync && directorySync > rename);
    assert.deepEqual(
      readdirSync(dirname(f.target)).filter((name) => name.includes('.ccm-tmp-')),
      [],
      'successful publish leaves no temp residue',
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('directory fsync errno matrix: EINVAL/ENOTSUP are observable unsupported, never false durable', () => {
  for (const code of ['EINVAL', 'ENOTSUP']) {
    const f = fixture();
    try {
      const observed = observedFilesystem(f.target, { directorySync: code });
      const result = durableWriteFileSync(f.target, NEW_JSON, { filesystem: observed.filesystem });
      assert.equal(result.file_sync, 'supported', code);
      assert.equal(result.directory_sync, 'unsupported', code);
      assert.equal(result.committed, true, code);
      assert.equal(readFileSync(f.target, 'utf8'), NEW_JSON, code);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('directory fsync errno matrix: permission/I-O errors hard-fail after a complete rename', () => {
  for (const code of ['EACCES', 'EPERM', 'EIO']) {
    const f = fixture();
    try {
      const observed = observedFilesystem(f.target, { directorySync: code });
      assert.throws(
        () => durableWriteFileSync(f.target, NEW_JSON, { filesystem: observed.filesystem }),
        (error) => {
          assert.ok(error instanceof DurableWriteError, code);
          assert.equal(error.code, code);
          assert.equal(error.stage, 'directory-sync');
          assert.deepEqual(error.outcome, {
            path: f.target,
            committed: true,
            file_sync: 'supported',
            directory_sync: 'hard-fail',
          });
          return true;
        },
      );
      assert.equal(readFileSync(f.target, 'utf8'), NEW_JSON, 'reader sees complete new revision');
      assert.doesNotThrow(() => JSON.parse(readFileSync(f.target, 'utf8')));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('file fsync unsupported-looking and I-O errors are always hard failures before rename', () => {
  for (const code of ['EINVAL', 'ENOTSUP', 'EIO']) {
    const f = fixture();
    try {
      const observed = observedFilesystem(f.target, { fileSync: code });
      assert.throws(
        () => durableWriteFileSync(f.target, NEW_JSON, { filesystem: observed.filesystem }),
        (error) => {
          assert.ok(error instanceof DurableWriteError, code);
          assert.equal(error.code, code);
          assert.equal(error.stage, 'file-sync');
          assert.equal(error.outcome.committed, false);
          assert.equal(error.outcome.file_sync, 'hard-fail');
          assert.equal(error.outcome.directory_sync, 'not-attempted');
          return true;
        },
      );
      assert.equal(readFileSync(f.target, 'utf8'), OLD_JSON, 'old authority survives');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('rename permission failure fails closed with the complete old revision still authoritative', () => {
  const f = fixture();
  try {
    const observed = observedFilesystem(f.target, { rename: 'EACCES' });
    assert.throws(
      () => durableWriteFileSync(f.target, NEW_JSON, { filesystem: observed.filesystem }),
      (error) => {
        assert.ok(error instanceof DurableWriteError);
        assert.equal(error.code, 'EACCES');
        assert.equal(error.stage, 'rename');
        assert.equal(error.outcome.committed, false);
        return true;
      },
    );
    assert.equal(readFileSync(f.target, 'utf8'), OLD_JSON);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

async function killAtCheckpoint(target: string, checkpoint: string): Promise<void> {
  const worker = join(HERE, 'fixtures', 'durable-write-worker.ts');
  const child = spawn(
    process.execPath,
    [worker, target, Buffer.from(NEW_JSON).toString('base64'), checkpoint],
    { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const reached = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`checkpoint timeout: ${checkpoint}\n${stderr}`)),
      5000,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.once('data', (chunk) => {
      clearTimeout(timeout);
      assert.equal(String(chunk).trim(), checkpoint);
      resolve();
    });
    child.once('exit', (code, signal) => {
      if (code !== null) {
        clearTimeout(timeout);
        reject(new Error(`worker exited early code=${code} signal=${signal}\n${stderr}`));
      }
    });
  });
  await reached;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
}

test('SIGKILL/power-loss checkpoints expose only complete old or complete new JSON; residue has no authority', async () => {
  const cases = [
    ['temp-opened', 'old'],
    ['data-written', 'old'],
    ['file-synced', 'old'],
    ['renamed', 'new'],
    ['directory-synced', 'new'],
  ] as const;

  for (const [checkpoint, expectedRevision] of cases) {
    const f = fixture();
    try {
      await killAtCheckpoint(f.target, checkpoint);
      const authoritativeBeforeCleanup = readFileSync(f.target, 'utf8');
      const parsed = JSON.parse(authoritativeBeforeCleanup);
      assert.equal(parsed.revision, expectedRevision, checkpoint);
      assert.ok(authoritativeBeforeCleanup === OLD_JSON || authoritativeBeforeCleanup === NEW_JSON);

      const residues = readdirSync(f.root).filter((name) => name.includes('.ccm-tmp-'));
      assert.equal(residues.length, 1, `${checkpoint}: crash leaves one recoverable residue`);
      const residueDir = join(f.root, residues[0] as string);
      assert.equal(statSync(residueDir).mode & 0o777, 0o700);
      const residueFiles = readdirSync(residueDir);
      if (residueFiles.length === 1) {
        assert.equal(statSync(join(residueDir, residueFiles[0] as string)).mode & 0o777, 0o600);
      }
      rmSync(residueDir, { recursive: true, force: true });
      assert.equal(
        readFileSync(f.target, 'utf8'),
        authoritativeBeforeCleanup,
        `${checkpoint}: removing residue cannot change authority`,
      );
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});
