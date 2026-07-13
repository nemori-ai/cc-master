import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveCcMasterHome } from '@ccm/engine';

const PROVENANCE_SCHEMA = 'ccm/runtime-provenance/v1';
const IMAGE_SCHEMA = 'ccm/runtime-image/v1';
const TRANSACTION_SCHEMA = 'ccm/runtime-transaction-event/v1';
const ACTIVATION_SCHEMA = 'ccm/runtime-activation/v1';
const SHA256_RE = /^[a-f0-9]{64}$/;
const TX_RE = /^tx_[a-f0-9]{32}$/;
const ACTIVATION_RE = /^(\d{20})-(tx_[a-f0-9]{32})\.json$/;

type PathEnv = Record<string, string | undefined>;

export interface RuntimeImageRef {
  sha256: string;
  image: string;
}

export interface RuntimeActivation {
  schema: typeof ACTIVATION_SCHEMA;
  sequence: number;
  transaction_id: string;
  current: RuntimeImageRef;
  previous: RuntimeImageRef | null;
  operation: 'activate' | 'rollback';
  created_at: string;
}

export interface RuntimeResolution {
  sequence: number;
  transaction_id: string;
  sha256: string;
  image_path: string;
  image_ref: string;
  activation_path: string;
}

export interface StageResult {
  transaction_id: string;
  sha256: string;
  image_path: string;
  image_ref: string;
  provenance: RuntimeProvenance;
  reused: boolean;
}

export interface ActivationResult extends RuntimeActivation {
  activation_path: string;
}

export interface RuntimeProvenance {
  schema: typeof PROVENANCE_SCHEMA;
  repository: 'nemori-ai/cc-master';
  tag: string;
  asset: string;
  sha256: string;
}

export interface RuntimePlatformBackend {
  id: string;
  platform: NodeJS.Platform | string;
  arch: string;
  activationSupported: boolean;
  unsupportedReason?: string;
  expectedAsset: string | null;
  ensurePrivateDirectory(dirPath: string): void;
  verifyOpenFile(
    filePath: string,
    fd: number,
    stat: fs.Stats,
    purpose: 'artifact' | 'provenance' | 'managed-image' | 'managed-metadata',
  ): void;
  verifyManagedDirectory(dirPath: string, stat: fs.Stats): void;
  sealFile(filePath: string, purpose: 'executable' | 'metadata'): void;
  publishUniqueFile(tempPath: string, finalPath: string): void;
  publishImage(stagingDir: string, finalDir: string): 'published' | 'exists';
  spawnVerifiedImage(
    imagePath: string,
    imageFd: number,
    args: string[],
    env: NodeJS.ProcessEnv,
  ): ReturnType<typeof spawnSync>;
  flushDirectory(dirPath: string): void;
  isProcessAlive(pid: number): boolean;
}

export interface RuntimeSupplyChainOptions {
  env?: PathEnv;
  backend?: RuntimePlatformBackend;
  now?: () => Date;
  randomId?: () => string;
  fault?: (point: 'after_prepare' | 'after_commit') => void;
}

export interface RuntimeSupplyChain {
  readonly root: string;
  readonly backend: RuntimePlatformBackend;
  stage(input: { artifactPath: string; provenancePath: string }): StageResult;
  activate(transactionId: string): ActivationResult;
  resolve(): RuntimeResolution;
  rollback(): ActivationResult;
  invoke(args: string[]): { exit_code: number; resolution: RuntimeResolution };
  doctor(input?: { installedPath?: string; repair?: boolean }): RuntimeDoctorReport;
}

export interface RuntimeDoctorReport {
  schema: 'ccm/runtime-doctor/v1';
  root: string;
  backend: {
    id: string;
    platform: string;
    arch: string;
    activation_supported: boolean;
    reason: string | null;
  };
  current: RuntimeResolution | null;
  transaction_count: number;
  activation_count: number;
  incomplete_transactions: Array<{
    transaction_id: string;
    state: string;
    repaired: string | null;
  }>;
  stale_lock: { present: boolean; pid: number | null; alive: boolean | null; repaired: boolean };
  migration: RuntimeMigrationPlan | null;
}

export interface RuntimeMigrationPlan {
  source_path: string;
  exists: boolean;
  kind: 'in-place-file' | 'missing' | 'symlink' | 'other';
  action: 'stage-with-official-provenance' | 'reject-source';
  mutates_source: false;
  preserves_home: true;
}

interface RuntimeTransactionEvent {
  schema: typeof TRANSACTION_SCHEMA;
  transaction_id: string;
  event: 'staged' | 'prepared' | 'activated' | 'rollback_prepared' | 'recovered' | 'aborted';
  created_at: string;
  image?: RuntimeImageRef;
  activation_ref?: string;
}

interface RuntimeImageManifest {
  schema: typeof IMAGE_SCHEMA;
  sha256: string;
  executable: 'ccm';
  provenance_sha256: string;
  identity: { repository: string; tag: string; asset: string };
}

interface RuntimeFailure extends Error {
  errKind?: string;
  kind?: string;
  code?: string;
}

function fail(message: string, errKind: string, code: string): never {
  const error = new Error(message) as RuntimeFailure;
  error.errKind = errKind;
  error.kind = errKind;
  error.code = code;
  throw error;
}

function validation(message: string, code: string): never {
  return fail(`runtime validation failed [${code}]: ${message}`, 'Validation', code);
}

function notFound(message: string, code: string): never {
  return fail(message, 'NotFound', code);
}

function locked(message: string): never {
  return fail(`LOCK_TIMEOUT: ${message}`, 'Locked', 'RUNTIME_LOCKED');
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// home 解析收口进 @ccm/engine 的 SSOT（paths.resolveCcMasterHome）——此前本文件重实现同口径逻辑，
//   属 P2-1「home 策略碎片化」的重复源之一，现删重实现、单一真相由引擎 RuntimeEnvironment/PathResolver 提供。
function resolveHome(env: PathEnv): string {
  return resolveCcMasterHome(env);
}

function expectedAsset(platform: string, arch: string): string | null {
  const osName = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  if (!osName || !['x64', 'arm64'].includes(arch)) return null;
  return `ccm-${osName}-${arch}`;
}

function checkRegularNoSymlink(filePath: string, purpose: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    notFound(
      `${purpose} not found: ${filePath} (${(error as Error).message})`,
      'RUNTIME_FILE_MISSING',
    );
  }
  if (stat.isSymbolicLink())
    validation(`${purpose} must not be a symlink: ${filePath}`, 'RUNTIME_SYMLINK');
  if (!stat.isFile())
    validation(`${purpose} must be a regular file: ${filePath}`, 'RUNTIME_NOT_REGULAR');
  return stat;
}

function flushFile(filePath: string): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function flushDirectoryBestEffort(dirPath: string): void {
  try {
    const fd = fs.openSync(dirPath, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // The Windows backend must provide its own durable publish proof. Some platforms reject dir fsync.
  }
}

export function createDefaultRuntimeBackend(
  platform: NodeJS.Platform | string = process.platform,
  arch = process.arch,
  expectedUid = typeof process.geteuid === 'function' ? process.geteuid() : null,
): RuntimePlatformBackend {
  const asset = expectedAsset(platform, arch);
  const supported = (platform === 'linux' || platform === 'darwin') && asset !== null;
  const requireSupported = (): void => {
    if (!supported) {
      validation(
        'platform security backend requires ACL/Authenticode and locked-SEA endpoint evidence',
        'RUNTIME_BACKEND',
      );
    }
  };
  const verifyPosixStat = (stat: fs.Stats, purpose: string, requireExecutable: boolean): void => {
    requireSupported();
    if (expectedUid !== null && stat.uid !== expectedUid) {
      validation(
        `${purpose} owner uid ${stat.uid} does not match effective uid ${expectedUid}`,
        'RUNTIME_OWNER',
      );
    }
    if ((stat.mode & 0o022) !== 0) {
      validation(
        `${purpose} is group/other writable (mode ${(stat.mode & 0o777).toString(8)})`,
        'RUNTIME_PERMISSION',
      );
    }
    if (requireExecutable && (stat.mode & 0o100) === 0) {
      validation(`${purpose} is not owner-executable`, 'RUNTIME_PERMISSION');
    }
  };
  const publishUniqueFile = (tempPath: string, finalPath: string): void => {
    requireSupported();
    try {
      // link(2) is the no-replace linearization point: EEXIST cannot overwrite finalPath.
      fs.linkSync(tempPath, finalPath);
      fs.unlinkSync(tempPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST')
        validation(`refusing to replace existing path ${finalPath}`, 'RUNTIME_REPLACE');
      if (code === 'EXDEV')
        validation('atomic publish crossed filesystem boundary', 'RUNTIME_CROSS_VOLUME');
      throw error;
    }
  };
  return {
    id: supported ? 'posix-v1' : 'windows-contract-v1',
    platform,
    arch,
    activationSupported: supported,
    unsupportedReason: supported
      ? undefined
      : 'platform security backend requires ACL/Authenticode and locked-SEA endpoint evidence',
    expectedAsset: asset,
    ensurePrivateDirectory(dirPath) {
      try {
        fs.mkdirSync(dirPath, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const pathStat = fs.lstatSync(dirPath);
      if (pathStat.isSymbolicLink()) {
        validation(`managed directory must not be a symlink: ${dirPath}`, 'RUNTIME_SYMLINK');
      }
      if (!pathStat.isDirectory()) {
        validation(`managed path is not a directory: ${dirPath}`, 'RUNTIME_PATH_ESCAPE');
      }
      if (supported) {
        const fd = fs.openSync(
          dirPath,
          fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0),
        );
        try {
          const opened = fs.fstatSync(fd);
          if (opened.dev !== pathStat.dev || opened.ino !== pathStat.ino) {
            validation(`managed directory changed while opening: ${dirPath}`, 'RUNTIME_TOCTOU');
          }
          fs.fchmodSync(fd, 0o700);
        } finally {
          fs.closeSync(fd);
        }
      }
    },
    verifyOpenFile(_filePath, _fd, stat, purpose) {
      verifyPosixStat(stat, purpose, purpose === 'artifact' || purpose === 'managed-image');
    },
    verifyManagedDirectory(_dirPath, stat) {
      verifyPosixStat(stat, 'managed directory', false);
    },
    sealFile(filePath, purpose) {
      requireSupported();
      fs.chmodSync(filePath, purpose === 'executable' ? 0o500 : 0o400);
    },
    publishUniqueFile,
    publishImage(stagingDir, finalDir) {
      requireSupported();
      let claimed: fs.Stats;
      try {
        fs.mkdirSync(finalDir, { mode: 0o700 });
        claimed = fs.lstatSync(finalDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const existing = fs.lstatSync(finalDir);
          if (existing.isSymbolicLink()) {
            validation(`image target must not be a symlink: ${finalDir}`, 'RUNTIME_SYMLINK');
          }
          if (!existing.isDirectory()) {
            validation(`image target is not a directory: ${finalDir}`, 'RUNTIME_PATH_ESCAPE');
          }
          return 'exists';
        }
        throw error;
      }
      try {
        for (const name of ['ccm', 'provenance.json', 'manifest.json']) {
          fs.linkSync(path.join(stagingDir, name), path.join(finalDir, name));
        }
        // READY is linked last. Readers reject claimed/partial directories without it.
        fs.linkSync(path.join(stagingDir, 'READY'), path.join(finalDir, 'READY'));
        flushDirectoryBestEffort(finalDir);
        fs.chmodSync(finalDir, 0o500);
        flushDirectoryBestEffort(path.dirname(finalDir));
        return 'published';
      } catch (error) {
        try {
          const current = fs.lstatSync(finalDir);
          if (
            !current.isSymbolicLink() &&
            current.isDirectory() &&
            current.dev === claimed.dev &&
            current.ino === claimed.ino
          ) {
            fs.chmodSync(finalDir, 0o700);
            fs.rmSync(finalDir, { recursive: true, force: true });
          }
        } catch {
          // Preserve the primary publish failure.
        }
        if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
          validation('atomic image publish crossed filesystem boundary', 'RUNTIME_CROSS_VOLUME');
        }
        throw error;
      }
    },
    spawnVerifiedImage(imagePath, imageFd, args, childEnv) {
      requireSupported();
      const inheritedFd = 3;
      const pinnedPath =
        platform === 'linux' ? `/proc/self/fd/${inheritedFd}` : `/dev/fd/${inheritedFd}`;
      if (!fs.existsSync(path.dirname(pinnedPath))) {
        validation(
          `fd-backed executable path is unavailable for ${imagePath}`,
          'RUNTIME_INVOKE_BACKEND',
        );
      }
      return spawnSync(pinnedPath, args, {
        stdio: ['inherit', 'inherit', 'inherit', imageFd],
        env: childEnv,
      });
    },
    flushDirectory: flushDirectoryBestEffort,
    isProcessAlive(pid) {
      if (!Number.isSafeInteger(pid) || pid <= 0) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
      }
    },
  };
}

export function createRuntimeSupplyChain(
  options: RuntimeSupplyChainOptions = {},
): RuntimeSupplyChain {
  const env = options.env || process.env;
  const backend = options.backend || createDefaultRuntimeBackend();
  const now = options.now || (() => new Date());
  const randomId = options.randomId || (() => randomUUID().replaceAll('-', ''));
  const home = resolveHome(env);
  const managedParents = [path.join(home, 'runtimes'), path.join(home, 'runtimes', 'ccm')];
  const root = path.join(managedParents[1] as string, 'v1');

  const dirs = {
    images: path.join(root, 'images'),
    transactions: path.join(root, 'transactions'),
    activations: path.join(root, 'activations'),
    launcher: path.join(root, 'launcher'),
    quarantine: path.join(root, 'quarantine'),
    locks: path.join(root, 'locks'),
  };

  function ensureSupported(): void {
    if (!backend.activationSupported) {
      validation(
        backend.unsupportedReason || `backend ${backend.id} cannot activate`,
        'RUNTIME_BACKEND',
      );
    }
  }

  function inspectDirectoryNoFollow(
    dirPath: string,
    purpose: string,
    verifyManaged: boolean,
  ): boolean {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(dirPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (stat.isSymbolicLink())
      validation(`${purpose} must not be a symlink: ${dirPath}`, 'RUNTIME_SYMLINK');
    if (!stat.isDirectory())
      validation(`${purpose} must be a directory: ${dirPath}`, 'RUNTIME_PATH_ESCAPE');
    if (verifyManaged) backend.verifyManagedDirectory(dirPath, stat);
    return true;
  }

  function managedPathComponents(candidate: string): string[] {
    const relative = path.relative(root, candidate);
    if (
      relative === '' ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative)
    ) {
      if (candidate === root) return [root];
      validation(`managed path escapes runtime root: ${candidate}`, 'RUNTIME_PATH_ESCAPE');
    }
    const components = [root];
    let cursor = root;
    for (const part of relative.split(path.sep)) {
      cursor = path.join(cursor, part);
      components.push(cursor);
    }
    return components;
  }

  function preflightManagedPaths(candidates: string[]): void {
    inspectDirectoryNoFollow(home, 'runtime home', false);
    for (const dirPath of managedParents) {
      inspectDirectoryNoFollow(dirPath, 'managed directory', true);
    }
    const paths = new Set<string>([root]);
    for (const candidate of candidates) {
      for (const component of managedPathComponents(candidate)) paths.add(component);
    }
    for (const dirPath of paths) {
      inspectDirectoryNoFollow(dirPath, 'managed directory', true);
    }
  }

  function ensureManagedDirectory(dirPath: string): void {
    preflightManagedPaths([dirPath]);
    backend.ensurePrivateDirectory(dirPath);
  }

  function ensureLayout(additionalTargets: string[] = []): void {
    const layoutPaths = [...managedParents, root, ...Object.values(dirs)];
    preflightManagedPaths([root, ...Object.values(dirs), ...additionalTargets]);
    if (!inspectDirectoryNoFollow(home, 'runtime home', false)) {
      backend.ensurePrivateDirectory(home);
    }
    for (const dir of layoutPaths) backend.ensurePrivateDirectory(dir);
    const marker = path.join(dirs.launcher, 'README.json');
    if (backend.activationSupported && !fs.existsSync(marker)) {
      try {
        writeUniqueJson(marker, {
          schema: 'ccm/runtime-stable-selector/v1',
          selector: 'highest-valid-activation-commit',
          symlink_required: false,
        });
      } catch (error) {
        if ((error as RuntimeFailure).code !== 'RUNTIME_REPLACE') throw error;
      }
    }
  }

  function inspectExistingLayout(): boolean {
    preflightManagedPaths([root]);
    return inspectDirectoryNoFollow(root, 'runtime root', true);
  }

  function assertTrustedManagedPath(candidate: string, purpose: string): void {
    const relative = path.relative(root, candidate);
    if (
      relative === '' ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative)
    ) {
      validation(`${purpose} escapes runtime root: ${candidate}`, 'RUNTIME_PATH_ESCAPE');
    }
    let cursor = root;
    for (const part of relative.split(path.sep)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink())
        validation(`${purpose} has symlink path component: ${cursor}`, 'RUNTIME_SYMLINK');
      if (!stat.isDirectory())
        validation(
          `${purpose} path component is not a directory: ${cursor}`,
          'RUNTIME_PATH_ESCAPE',
        );
      backend.verifyManagedDirectory(cursor, stat);
      cursor = path.join(cursor, part);
    }
  }

  function tempPath(dir: string, prefix: string): string {
    return path.join(dir, `.${prefix}-${process.pid}-${randomId()}.tmp`);
  }

  function writeUniqueJson(finalPath: string, value: unknown): void {
    ensureManagedDirectory(path.dirname(finalPath));
    const tmp = tempPath(path.dirname(finalPath), path.basename(finalPath));
    try {
      fs.writeFileSync(tmp, jsonText(value), { flag: 'wx', mode: 0o600 });
      flushFile(tmp);
      backend.sealFile(tmp, 'metadata');
      backend.publishUniqueFile(tmp, finalPath);
      backend.flushDirectory(path.dirname(finalPath));
    } finally {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // Preserve the primary failure.
      }
    }
  }

  function openPinned(
    filePath: string,
    purpose: 'artifact' | 'provenance' | 'managed-image' | 'managed-metadata',
  ): { fd: number; before: fs.Stats } {
    const pathStat = checkRegularNoSymlink(filePath, purpose);
    let fd: number;
    try {
      fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        validation(`${purpose} must not be a symlink: ${filePath}`, 'RUNTIME_SYMLINK');
      }
      throw error;
    }
    const before = fs.fstatSync(fd);
    if (!before.isFile()) {
      fs.closeSync(fd);
      validation(`${purpose} opened object is not a regular file`, 'RUNTIME_NOT_REGULAR');
    }
    if (pathStat.dev !== before.dev || pathStat.ino !== before.ino) {
      fs.closeSync(fd);
      validation(`${purpose} changed between lstat and open`, 'RUNTIME_TOCTOU');
    }
    backend.verifyOpenFile(filePath, fd, before, purpose);
    return { fd, before };
  }

  function assertPinnedStable(fd: number, before: fs.Stats, purpose: string): void {
    const after = fs.fstatSync(fd);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      validation(`${purpose} changed while it was being read`, 'RUNTIME_TOCTOU');
    }
  }

  function readPinnedText(filePath: string, purpose: 'provenance' | 'managed-metadata'): string {
    if (purpose === 'managed-metadata') assertTrustedManagedPath(filePath, purpose);
    const opened = openPinned(filePath, purpose);
    try {
      const text = fs.readFileSync(opened.fd, 'utf8');
      assertPinnedStable(opened.fd, opened.before, purpose);
      return text;
    } finally {
      fs.closeSync(opened.fd);
    }
  }

  function readJson(filePath: string, purpose: string): Record<string, unknown> {
    try {
      const value = JSON.parse(readPinnedText(filePath, 'managed-metadata'));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('expected object');
      return value as Record<string, unknown>;
    } catch (error) {
      validation(`${purpose} is not valid JSON: ${(error as Error).message}`, 'RUNTIME_JSON');
    }
  }

  function parseProvenance(filePath: string): RuntimeProvenance {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readPinnedText(filePath, 'provenance')) as Record<string, unknown>;
    } catch (error) {
      if ((error as RuntimeFailure).code) throw error;
      validation(`provenance is not valid JSON: ${(error as Error).message}`, 'RUNTIME_JSON');
    }
    if (raw.schema !== PROVENANCE_SCHEMA)
      validation('unsupported provenance schema', 'RUNTIME_PROVENANCE');
    if (raw.repository !== 'nemori-ai/cc-master')
      validation('untrusted provenance repository', 'RUNTIME_PROVENANCE');
    if (typeof raw.tag !== 'string' || !/^ccm-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(raw.tag)) {
      validation('invalid ccm release tag', 'RUNTIME_PROVENANCE');
    }
    if (typeof raw.asset !== 'string' || raw.asset !== backend.expectedAsset) {
      validation(
        `provenance asset ${String(raw.asset)} != expected ${String(backend.expectedAsset)}`,
        'RUNTIME_PROVENANCE',
      );
    }
    if (typeof raw.sha256 !== 'string' || !SHA256_RE.test(raw.sha256)) {
      validation('provenance sha256 must be 64 lower-case hex characters', 'RUNTIME_PROVENANCE');
    }
    return raw as unknown as RuntimeProvenance;
  }

  function imageRef(hash: string): RuntimeImageRef {
    return { sha256: hash, image: path.posix.join('images', hash, 'ccm') };
  }

  function openVerifiedManagedImage(imagePath: string, expectedHash: string): number {
    assertTrustedManagedPath(imagePath, 'managed image');
    const opened = openPinned(imagePath, 'managed-image');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      let offset = 0;
      while (true) {
        const bytes = fs.readSync(opened.fd, buffer, 0, buffer.length, offset);
        if (bytes === 0) break;
        hash.update(buffer.subarray(0, bytes));
        offset += bytes;
      }
      assertPinnedStable(opened.fd, opened.before, 'managed image');
    } catch (error) {
      fs.closeSync(opened.fd);
      throw error;
    }
    const actual = hash.digest('hex');
    if (actual !== expectedHash) {
      fs.closeSync(opened.fd);
      validation(`managed image hash ${actual} != expected ${expectedHash}`, 'RUNTIME_HASH');
    }
    return opened.fd;
  }

  function hashPinnedManagedImage(imagePath: string, expectedHash: string): void {
    const fd = openVerifiedManagedImage(imagePath, expectedHash);
    fs.closeSync(fd);
  }

  function resolveRef(ref: RuntimeImageRef): {
    imagePath: string;
    manifest: RuntimeImageManifest;
    provenance: RuntimeProvenance;
  } {
    if (!ref || !SHA256_RE.test(ref.sha256))
      validation('invalid image ref hash', 'RUNTIME_IMAGE_REF');
    const expected = path.posix.join('images', ref.sha256, 'ccm');
    if (ref.image !== expected)
      validation(`image ref path ${ref.image} != ${expected}`, 'RUNTIME_IMAGE_REF');
    const imagePath = path.join(root, ...ref.image.split('/'));
    const imageDir = path.dirname(imagePath);
    const readyPath = path.join(imageDir, 'READY');
    let ready: { schema?: unknown; sha256?: unknown };
    try {
      ready = JSON.parse(readPinnedText(readyPath, 'managed-metadata')) as {
        schema?: unknown;
        sha256?: unknown;
      };
    } catch (error) {
      if ((error as RuntimeFailure).code) throw error;
      validation(
        `image READY marker is not valid JSON: ${(error as Error).message}`,
        'RUNTIME_IMAGE_READY',
      );
    }
    if (ready.schema !== 'ccm/runtime-image-ready/v1' || ready.sha256 !== ref.sha256) {
      validation('image READY marker does not match image ref', 'RUNTIME_IMAGE_READY');
    }
    hashPinnedManagedImage(imagePath, ref.sha256);
    const manifestPath = path.join(imageDir, 'manifest.json');
    const manifest = readJson(manifestPath, 'image manifest') as unknown as RuntimeImageManifest;
    if (
      manifest.schema !== IMAGE_SCHEMA ||
      manifest.sha256 !== ref.sha256 ||
      manifest.executable !== 'ccm'
    ) {
      validation('image manifest does not match image ref', 'RUNTIME_MANIFEST');
    }
    const provenancePath = path.join(imageDir, 'provenance.json');
    const provenanceText = readPinnedText(provenancePath, 'managed-metadata');
    let provenance: RuntimeProvenance;
    try {
      provenance = JSON.parse(provenanceText) as RuntimeProvenance;
    } catch (error) {
      validation(
        `managed provenance is not valid JSON: ${(error as Error).message}`,
        'RUNTIME_JSON',
      );
    }
    if (
      provenance.schema !== PROVENANCE_SCHEMA ||
      provenance.repository !== 'nemori-ai/cc-master' ||
      provenance.sha256 !== ref.sha256 ||
      provenance.asset !== backend.expectedAsset ||
      !/^ccm-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(provenance.tag)
    ) {
      validation('managed provenance identity is invalid', 'RUNTIME_PROVENANCE');
    }
    if (sha256Text(provenanceText) !== manifest.provenance_sha256) {
      validation('managed provenance digest does not match manifest', 'RUNTIME_PROVENANCE_DIGEST');
    }
    if (
      manifest.identity.repository !== provenance.repository ||
      manifest.identity.tag !== provenance.tag ||
      manifest.identity.asset !== provenance.asset
    ) {
      validation('manifest identity does not match managed provenance', 'RUNTIME_IDENTITY');
    }
    return { imagePath, manifest, provenance };
  }

  function transactionDir(transactionId: string): string {
    if (!TX_RE.test(transactionId))
      validation(`invalid transaction id ${transactionId}`, 'RUNTIME_TRANSACTION');
    const dir = path.join(dirs.transactions, transactionId);
    const relative = path.relative(dirs.transactions, dir);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      validation('transaction path escaped root', 'RUNTIME_PATH_ESCAPE');
    return dir;
  }

  function transactionEvents(
    transactionId: string,
  ): Array<{ path: string; event: RuntimeTransactionEvent }> {
    const dir = transactionDir(transactionId);
    if (!fs.existsSync(dir))
      notFound(`runtime transaction not found: ${transactionId}`, 'RUNTIME_TRANSACTION_MISSING');
    return fs
      .readdirSync(dir)
      .filter((name) => /^\d{4}-[a-z_]+\.json$/.test(name))
      .sort()
      .map((name) => {
        const eventPath = path.join(dir, name);
        const event = readJson(
          eventPath,
          'transaction event',
        ) as unknown as RuntimeTransactionEvent;
        if (event.schema !== TRANSACTION_SCHEMA || event.transaction_id !== transactionId) {
          validation(`transaction event identity mismatch: ${eventPath}`, 'RUNTIME_TRANSACTION');
        }
        return { path: eventPath, event };
      });
  }

  function appendEvent(
    transactionId: string,
    event: RuntimeTransactionEvent['event'],
    extra: Partial<RuntimeTransactionEvent> = {},
  ): string {
    const dir = transactionDir(transactionId);
    ensureManagedDirectory(dir);
    const seq =
      fs
        .readdirSync(dir)
        .map((name) => Number(/^(\d{4})-/.exec(name)?.[1] || 0))
        .reduce((max, value) => Math.max(max, value), 0) + 1;
    const filePath = path.join(dir, `${String(seq).padStart(4, '0')}-${event}.json`);
    writeUniqueJson(filePath, {
      schema: TRANSACTION_SCHEMA,
      transaction_id: transactionId,
      event,
      created_at: now().toISOString(),
      ...extra,
    });
    return filePath;
  }

  function activationFiles(): string[] {
    if (!fs.existsSync(dirs.activations)) return [];
    return fs
      .readdirSync(dirs.activations)
      .filter((name) => ACTIVATION_RE.test(name))
      .sort();
  }

  function parseActivation(filePath: string): RuntimeActivation {
    const raw = readJson(filePath, 'activation commit') as unknown as RuntimeActivation;
    const nameMatch = ACTIVATION_RE.exec(path.basename(filePath));
    if (!nameMatch || raw.schema !== ACTIVATION_SCHEMA)
      validation('invalid activation commit schema/name', 'RUNTIME_ACTIVATION');
    if (raw.sequence !== Number(nameMatch[1]) || raw.transaction_id !== nameMatch[2]) {
      validation('activation commit sequence/transaction mismatch', 'RUNTIME_ACTIVATION');
    }
    if (!['activate', 'rollback'].includes(raw.operation))
      validation('invalid activation operation', 'RUNTIME_ACTIVATION');
    resolveRef(raw.current);
    if (raw.previous) resolveRef(raw.previous);
    return raw;
  }

  function latestActivation(): { path: string; activation: RuntimeActivation } | null {
    const files = activationFiles();
    const latest = files.at(-1);
    if (!latest) return null;
    const activationPath = path.join(dirs.activations, latest);
    return { path: activationPath, activation: parseActivation(activationPath) };
  }

  function existingActivation(
    transactionId: string,
  ): { path: string; activation: RuntimeActivation } | null {
    for (const name of activationFiles()) {
      const match = ACTIVATION_RE.exec(name);
      if (match?.[2] === transactionId) {
        const activationPath = path.join(dirs.activations, name);
        return { path: activationPath, activation: parseActivation(activationPath) };
      }
    }
    return null;
  }

  function acquireLock(): () => void {
    ensureLayout();
    const lockPath = path.join(dirs.locks, 'activation.lock');
    let fd: number;
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        locked(`runtime activation lock is held: ${lockPath}`);
      throw error;
    }
    fs.writeFileSync(
      fd,
      jsonText({
        schema: 'ccm/runtime-lock/v1',
        pid: process.pid,
        created_at: now().toISOString(),
      }),
    );
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    backend.sealFile(lockPath, 'metadata');
    return () => fs.rmSync(lockPath, { force: true });
  }

  function publishActivation(
    transactionId: string,
    current: RuntimeImageRef,
    previous: RuntimeImageRef | null,
    operation: RuntimeActivation['operation'],
  ): ActivationResult {
    const sequence =
      activationFiles().reduce(
        (max, name) => Math.max(max, Number(ACTIVATION_RE.exec(name)?.[1] || 0)),
        0,
      ) + 1;
    const activation: RuntimeActivation = {
      schema: ACTIVATION_SCHEMA,
      sequence,
      transaction_id: transactionId,
      current,
      previous,
      operation,
      created_at: now().toISOString(),
    };
    const fileName = `${String(sequence).padStart(20, '0')}-${transactionId}.json`;
    const activationPath = path.join(dirs.activations, fileName);
    writeUniqueJson(activationPath, activation);
    return { ...activation, activation_path: activationPath };
  }

  function copyPinnedArtifact(sourcePath: string, destinationPath: string): string {
    const source = openPinned(sourcePath, 'artifact');
    const destinationFd = fs.openSync(destinationPath, 'wx', 0o600);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    try {
      while (true) {
        const bytes = fs.readSync(source.fd, buffer, 0, buffer.length, offset);
        if (bytes === 0) break;
        fs.writeSync(destinationFd, buffer, 0, bytes);
        hash.update(buffer.subarray(0, bytes));
        offset += bytes;
      }
      fs.fsyncSync(destinationFd);
      assertPinnedStable(source.fd, source.before, 'artifact');
    } finally {
      fs.closeSync(destinationFd);
      fs.closeSync(source.fd);
    }
    backend.sealFile(destinationPath, 'executable');
    return hash.digest('hex');
  }

  function stage({
    artifactPath,
    provenancePath,
  }: {
    artifactPath: string;
    provenancePath: string;
  }): StageResult {
    ensureSupported();
    const provenance = parseProvenance(provenancePath);
    const expectedHash = provenance.sha256;
    const finalDir = path.join(dirs.images, expectedHash);
    const finalImage = path.join(finalDir, 'ccm');
    ensureLayout([finalDir]);
    let reused = false;
    const stagingDir = fs.mkdtempSync(path.join(dirs.images, '.stage-'));
    backend.ensurePrivateDirectory(stagingDir);
    try {
      const stagedImage = path.join(stagingDir, 'ccm');
      const actualHash = copyPinnedArtifact(artifactPath, stagedImage);
      if (actualHash !== expectedHash) {
        validation(`artifact hash ${actualHash} != provenance ${expectedHash}`, 'RUNTIME_HASH');
      }
      const normalizedProvenance = jsonText(provenance);
      const stagedProvenance = path.join(stagingDir, 'provenance.json');
      fs.writeFileSync(stagedProvenance, normalizedProvenance, { flag: 'wx', mode: 0o600 });
      flushFile(stagedProvenance);
      backend.sealFile(stagedProvenance, 'metadata');
      const manifest: RuntimeImageManifest = {
        schema: IMAGE_SCHEMA,
        sha256: actualHash,
        executable: 'ccm',
        provenance_sha256: sha256Text(normalizedProvenance),
        identity: {
          repository: provenance.repository,
          tag: provenance.tag,
          asset: provenance.asset,
        },
      };
      const stagedManifest = path.join(stagingDir, 'manifest.json');
      fs.writeFileSync(stagedManifest, jsonText(manifest), { flag: 'wx', mode: 0o600 });
      flushFile(stagedManifest);
      backend.sealFile(stagedManifest, 'metadata');
      const ready = path.join(stagingDir, 'READY');
      fs.writeFileSync(
        ready,
        jsonText({ schema: 'ccm/runtime-image-ready/v1', sha256: actualHash }),
        {
          flag: 'wx',
          mode: 0o600,
        },
      );
      flushFile(ready);
      backend.sealFile(ready, 'metadata');
      backend.flushDirectory(stagingDir);
      const published = backend.publishImage(stagingDir, finalDir);
      reused = published === 'exists';
      const verified = resolveRef(imageRef(actualHash));
      if (
        verified.provenance.tag !== provenance.tag ||
        verified.provenance.asset !== provenance.asset ||
        verified.provenance.repository !== provenance.repository
      ) {
        validation(
          'same artifact hash already exists under different release identity',
          'RUNTIME_IDENTITY',
        );
      }
    } finally {
      if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    }

    const transactionId = `tx_${randomId()}`;
    if (!TX_RE.test(transactionId))
      validation('random transaction id is invalid', 'RUNTIME_TRANSACTION');
    appendEvent(transactionId, 'staged', { image: imageRef(expectedHash) });
    return {
      transaction_id: transactionId,
      sha256: expectedHash,
      image_path: finalImage,
      image_ref: imageRef(expectedHash).image,
      provenance,
      reused,
    };
  }

  function activate(transactionId: string): ActivationResult {
    ensureSupported();
    if (env.CCM_RUNTIME_ACTIVATION_DISABLE === '1') {
      validation(
        'runtime activation disabled by CCM_RUNTIME_ACTIVATION_DISABLE=1',
        'RUNTIME_DISABLED',
      );
    }
    const release = acquireLock();
    try {
      const events = transactionEvents(transactionId);
      const eventNames = events.map((entry) => entry.event.event);
      if (eventNames.includes('aborted')) {
        validation(
          `transaction ${transactionId} is aborted and cannot activate`,
          'RUNTIME_TRANSACTION_ABORTED',
        );
      }
      const already = existingActivation(transactionId);
      if (already) {
        if (!eventNames.includes('activated') && !eventNames.includes('recovered')) {
          appendEvent(transactionId, 'recovered', {
            image: already.activation.current,
            activation_ref: path.basename(already.path),
          });
        }
        return { ...already.activation, activation_path: already.path };
      }
      if (eventNames.includes('activated') || eventNames.includes('recovered')) {
        validation(
          `terminal transaction ${transactionId} has no activation commit`,
          'RUNTIME_TRANSACTION',
        );
      }
      const staged = events.find((entry) => entry.event.event === 'staged')?.event;
      if (!staged?.image)
        validation(`transaction ${transactionId} has no staged image`, 'RUNTIME_TRANSACTION');
      resolveRef(staged.image);
      const before = latestActivation();
      if (!eventNames.includes('prepared'))
        appendEvent(transactionId, 'prepared', { image: staged.image });
      options.fault?.('after_prepare');
      const result = publishActivation(
        transactionId,
        staged.image,
        before?.activation.current || null,
        'activate',
      );
      options.fault?.('after_commit');
      appendEvent(transactionId, 'activated', {
        image: staged.image,
        activation_ref: path.basename(result.activation_path),
      });
      return result;
    } finally {
      release();
    }
  }

  function resolve(): RuntimeResolution {
    ensureSupported();
    if (!inspectExistingLayout()) {
      notFound('no active runtime image', 'RUNTIME_CURRENT_MISSING');
    }
    const latest = latestActivation();
    if (!latest) notFound('no active runtime image', 'RUNTIME_CURRENT_MISSING');
    const imagePath = resolveRef(latest.activation.current).imagePath;
    return {
      sequence: latest.activation.sequence,
      transaction_id: latest.activation.transaction_id,
      sha256: latest.activation.current.sha256,
      image_path: imagePath,
      image_ref: latest.activation.current.image,
      activation_path: latest.path,
    };
  }

  function rollback(): ActivationResult {
    ensureSupported();
    if (env.CCM_RUNTIME_ACTIVATION_DISABLE === '1') {
      validation(
        'runtime activation disabled by CCM_RUNTIME_ACTIVATION_DISABLE=1',
        'RUNTIME_DISABLED',
      );
    }
    const release = acquireLock();
    try {
      const before = latestActivation();
      if (!before) notFound('no active runtime image to roll back', 'RUNTIME_CURRENT_MISSING');
      if (!before.activation.previous)
        notFound('active runtime has no previous image', 'RUNTIME_PREVIOUS_MISSING');
      resolveRef(before.activation.previous);
      const transactionId = `tx_${randomId()}`;
      appendEvent(transactionId, 'rollback_prepared', { image: before.activation.previous });
      const result = publishActivation(
        transactionId,
        before.activation.previous,
        before.activation.current,
        'rollback',
      );
      appendEvent(transactionId, 'activated', {
        image: before.activation.previous,
        activation_ref: path.basename(result.activation_path),
      });
      return result;
    } finally {
      release();
    }
  }

  function invoke(args: string[]): { exit_code: number; resolution: RuntimeResolution } {
    const resolution = resolve();
    const imageFd = openVerifiedManagedImage(resolution.image_path, resolution.sha256);
    try {
      const child = backend.spawnVerifiedImage(resolution.image_path, imageFd, args, {
        ...process.env,
        ...env,
      });
      if (child.error) throw child.error;
      return { exit_code: child.status ?? 1, resolution };
    } finally {
      fs.closeSync(imageFd);
    }
  }

  function migrationPlan(installedPath: string): RuntimeMigrationPlan {
    const source = path.resolve(installedPath);
    let kind: RuntimeMigrationPlan['kind'] = 'missing';
    try {
      const stat = fs.lstatSync(source);
      kind = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'in-place-file' : 'other';
    } catch {
      kind = 'missing';
    }
    return {
      source_path: source,
      exists: kind !== 'missing',
      kind,
      action: kind === 'in-place-file' ? 'stage-with-official-provenance' : 'reject-source',
      mutates_source: false,
      preserves_home: true,
    };
  }

  function inspectActivationLock(): {
    present: boolean;
    pid: number | null;
    alive: boolean | null;
  } {
    const lockPath = path.join(dirs.locks, 'activation.lock');
    if (!fs.existsSync(lockPath)) return { present: false, pid: null, alive: null };
    try {
      const lock = readJson(lockPath, 'runtime activation lock');
      const pid = typeof lock.pid === 'number' ? lock.pid : null;
      return { present: true, pid, alive: pid === null ? null : backend.isProcessAlive(pid) };
    } catch {
      return { present: true, pid: null, alive: null };
    }
  }

  function scanIncompleteTransactions(
    repair: boolean,
  ): RuntimeDoctorReport['incomplete_transactions'] {
    const incomplete: RuntimeDoctorReport['incomplete_transactions'] = [];
    if (!fs.existsSync(dirs.transactions)) return incomplete;
    for (const transactionId of fs
      .readdirSync(dirs.transactions)
      .filter((name) => TX_RE.test(name))
      .sort()) {
      const events = transactionEvents(transactionId);
      const names = events.map((entry) => entry.event.event);
      if (names.includes('activated') || names.includes('recovered') || names.includes('aborted'))
        continue;
      const committed = existingActivation(transactionId);
      const prepared = names.includes('prepared') || names.includes('rollback_prepared');
      // A staged transaction is intentionally non-terminal and remains eligible for later activation.
      if (!committed && !prepared) continue;
      const state = committed ? 'commit-published-event-missing' : 'prepared-no-commit';
      let repaired: RuntimeTransactionEvent['event'] | null = null;
      if (repair) {
        repaired = committed ? 'recovered' : 'aborted';
        appendEvent(transactionId, repaired, {
          image: committed?.activation.current,
          activation_ref: committed ? path.basename(committed.path) : undefined,
        });
      }
      incomplete.push({ transaction_id: transactionId, state, repaired });
    }
    return incomplete;
  }

  function doctor(input: { installedPath?: string; repair?: boolean } = {}): RuntimeDoctorReport {
    let layoutPresent: boolean;
    if (input.repair) {
      ensureLayout();
      layoutPresent = true;
    } else {
      layoutPresent = inspectExistingLayout();
    }
    const lockPath = path.join(dirs.locks, 'activation.lock');
    const initialLock = inspectActivationLock();
    let lockRepaired = false;
    let incomplete: RuntimeDoctorReport['incomplete_transactions'];
    if (input.repair) {
      ensureSupported();
      if (env.CCM_RUNTIME_ACTIVATION_DISABLE === '1') {
        validation(
          'runtime recovery disabled by CCM_RUNTIME_ACTIVATION_DISABLE=1',
          'RUNTIME_DISABLED',
        );
      }
      if (initialLock.present) {
        if (initialLock.alive !== false) {
          locked('runtime doctor cannot repair while activation lock ownership is live or unknown');
        }
        fs.rmSync(lockPath, { force: true });
        lockRepaired = true;
      }
      const release = acquireLock();
      try {
        incomplete = scanIncompleteTransactions(true);
      } finally {
        release();
      }
    } else {
      incomplete = scanIncompleteTransactions(false);
    }

    let current: RuntimeResolution | null = null;
    try {
      current = latestActivation() ? resolve() : null;
    } catch (error) {
      if (!backend.activationSupported) current = null;
      else throw error;
    }
    return {
      schema: 'ccm/runtime-doctor/v1',
      root,
      backend: {
        id: backend.id,
        platform: String(backend.platform),
        arch: backend.arch,
        activation_supported: backend.activationSupported,
        reason: backend.unsupportedReason || null,
      },
      current,
      transaction_count:
        layoutPresent && fs.existsSync(dirs.transactions)
          ? fs.readdirSync(dirs.transactions).filter((name) => TX_RE.test(name)).length
          : 0,
      activation_count: activationFiles().length,
      incomplete_transactions: incomplete,
      stale_lock: {
        present: input.repair ? false : initialLock.present,
        pid: initialLock.pid,
        alive: initialLock.alive,
        repaired: lockRepaired,
      },
      migration: input.installedPath ? migrationPlan(input.installedPath) : null,
    };
  }

  return { root, backend, stage, activate, resolve, rollback, invoke, doctor };
}
