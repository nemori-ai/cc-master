// runtime-env.ts — RuntimeEnvironment / PathResolver 纯契约 SSOT（Linux/macOS 可移植性 slice 2）。
//
// 目的：把散落在 engine / CLI 各处的 home、session pointer、host config、plugin install root、可执行发现
//   收口成**一处显式优先级表**。契约是**纯输入**的：所有解析只读传入的 RuntimeEnvironment 快照，
//   **绝不从注入 env 暗地回落 process.env / os.* / process.***。真实进程快照只在 composition root
//   （captureRuntimeEnvironment）一处捕获——业务代码与测试都消费同一份纯函数。
//
// 平台口径：只支持 'linux' | 'darwin'；其余归一为 'other' 并显式降级（win32 的 PATHEXT / ACL 不在本契约承诺内）。
//
// 不变式（矩阵测试逐项钉）：
//   · 所有对外路径绝对（path.resolve / path.join 自绝对根）；
//   · lexical 路径与 realpath **分离**（目标可能尚不存在 → lexical 恒有值、realPath 允许 null）；
//   · 空格 / Unicode 是数据、绝非分隔符；
//   · 相对 PATH 条目按捕获的 cwd 解析（非 process.cwd()）；
//   · 空 PATH 条目按显式安全策略**拒绝并记 reason**（绝不静默搜 cwd）；
//   · 注入 env 用 **presence 而非 truthiness** 选择（`'PATH' in env`）——空字符串 PATH 意为「空 PATH」，
//     不回落进程 PATH；
//   · 默认位置（无覆写 env）与历史行为逐字节一致——首轮绝不迁移用户数据。
//
// 红线1 / ADR-006：node/JS only，纯 node stdlib（fs/os/path），零第三方依赖。
// 红线5：hook（bash/node）**不 import 本模块**——它们经进程边界 shell 调 `ccm` 或消费生成的最小 conformance
//   fixture，绝不把完整 resolver 复制进每个 hook。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type RuntimePlatform = 'linux' | 'darwin' | 'other';
export type RuntimeArch = 'x64' | 'arm64' | 'other';
export type RuntimeHost = 'claude-code' | 'codex' | 'cursor';

// 契约对外暴露的根集合（每个都是绝对路径；runtimeEphemeral 缺省为 null）。
export interface RuntimeRoots {
  ccMasterHome: string; // cc-master 自身状态伞根（boards / accounts / rate-cache / runtimes）
  state: string; // XDG state（session→board 指针注册表落点）
  config: string; // XDG config（Linux host 配置基座 / systemd user 单元）
  data: string; // XDG data（本地插件安装基座默认前身）
  cache: string; // XDG cache（预留·当前无消费者）
  runtimePersistent: string; // 持久 SEA runtime 镜像根（必须跨重启存活·绝不落 XDG_RUNTIME_DIR）
  runtimeEphemeral: string | null; // XDG_RUNTIME_DIR（仅暴露·契约不把持久镜像路由到此）
}

export interface RuntimeEnvironment {
  platform: RuntimePlatform;
  arch: RuntimeArch;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  homeDir: string;
  tempDir: string;
  roots: RuntimeRoots;
}

// 可执行发现结果：lexical 与 realpath 分离，附文件身份与拒绝 reason。
export interface ResolvedExecutable {
  requested: string;
  source: 'explicit' | 'path';
  lexicalPath: string; // 词法解析（绝对·目标可能不存在）；未命中为 ''
  realPath: string | null; // realpath（跟随 symlink·解不出为 null）
  executable: boolean;
  regularFile: boolean;
  symlink: boolean;
  reason: string | null; // 命中为 null；否则为人读拒绝原因
}

// 构造 RuntimeEnvironment 的纯输入（全部显式·无隐藏进程读）。
export interface RuntimeEnvironmentInput {
  platform: string; // 原始 process.platform
  arch: string; // 原始 process.arch
  env: Record<string, string | undefined>;
  cwd: string;
  homeDir: string;
  tempDir: string;
}

function normalizePlatform(raw: string): RuntimePlatform {
  return raw === 'linux' || raw === 'darwin' ? raw : 'other';
}

function normalizeArch(raw: string): RuntimeArch {
  return raw === 'x64' || raw === 'arm64' ? raw : 'other';
}

// homeBase(env, homeDir) → 用户 home 基座 = env.HOME（非空）否则显式 homeDir。
//   HOME 用 truthiness（空 HOME 不是可用 home），但**回落对象是显式输入 homeDir**、非隐藏 os.homedir()。
export function homeBase(env: Record<string, string | undefined>, homeDir: string): string {
  return env.HOME ? env.HOME : homeDir;
}

// 覆写根：env.<KEY>（presence·非空）→ 绝对化；否则 join(base...)。
function xdgRoot(
  env: Record<string, string | undefined>,
  key: string,
  base: string,
  ...segments: string[]
): string {
  const raw = env[key];
  if (raw) return path.resolve(raw);
  return path.join(base, ...segments);
}

function computeRoots(env: Record<string, string | undefined>, home: string): RuntimeRoots {
  const ccMasterHome = env.CC_MASTER_HOME
    ? path.resolve(env.CC_MASTER_HOME)
    : path.join(home, '.cc_master');
  return {
    ccMasterHome,
    state: xdgRoot(env, 'XDG_STATE_HOME', home, '.local', 'state'),
    config: xdgRoot(env, 'XDG_CONFIG_HOME', home, '.config'),
    data: xdgRoot(env, 'XDG_DATA_HOME', home, '.local', 'share'),
    cache: xdgRoot(env, 'XDG_CACHE_HOME', home, '.cache'),
    runtimePersistent: path.join(ccMasterHome, 'runtimes'),
    runtimeEphemeral: env.XDG_RUNTIME_DIR ? path.resolve(env.XDG_RUNTIME_DIR) : null,
  };
}

// createRuntimeEnvironment(input) → 纯快照（零进程读）。测试直接构造，业务经 capture 构造。
export function createRuntimeEnvironment(input: RuntimeEnvironmentInput): RuntimeEnvironment {
  // 防御性浅拷贝 + freeze：契约消费方拿到的是只读快照，改不动源 env。
  const env = Object.freeze({ ...input.env });
  const home = homeBase(env, input.homeDir);
  return Object.freeze({
    platform: normalizePlatform(input.platform),
    arch: normalizeArch(input.arch),
    env,
    cwd: input.cwd,
    homeDir: input.homeDir,
    tempDir: input.tempDir,
    roots: Object.freeze(computeRoots(env, home)),
  });
}

// captureRuntimeEnvironment(overrides?) → 唯一的进程快照点（composition root / 适配器边界）。
//   overrides 可注入 env（保 cwd/platform 等仍来自真实进程），供 harness 适配器复用真实 cwd 而注入 env。
export function captureRuntimeEnvironment(
  overrides?: Partial<RuntimeEnvironmentInput>,
): RuntimeEnvironment {
  return createRuntimeEnvironment({
    platform: overrides?.platform ?? process.platform,
    arch: overrides?.arch ?? process.arch,
    env: overrides?.env ?? process.env,
    cwd: overrides?.cwd ?? process.cwd(),
    homeDir: overrides?.homeDir ?? os.homedir(),
    tempDir: overrides?.tempDir ?? os.tmpdir(),
  });
}

// ── PathResolver（纯函数·取 RuntimeEnvironment）──────────────────────────────────────────────────

// cc-master home 伞根。
export function ccMasterHome(rt: RuntimeEnvironment): string {
  return rt.roots.ccMasterHome;
}

// session→board 指针注册表落点 = <state>/cc-master/boards/<sid>.path。
export function boardSessionPointer(rt: RuntimeEnvironment, sessionId: string): string {
  return path.join(rt.roots.state, 'cc-master', 'boards', `${sessionId}.path`);
}

// host 配置目录（有序·首项为该 host 的主配置根；win32 分支不在本契约·other 降级为 Linux 口径）。
export function hostConfig(rt: RuntimeEnvironment, host: RuntimeHost): string[] {
  const home = homeBase(rt.env, rt.homeDir);
  switch (host) {
    case 'claude-code':
      return [
        rt.env.CLAUDE_CONFIG_DIR
          ? path.resolve(rt.env.CLAUDE_CONFIG_DIR)
          : path.join(home, '.claude'),
      ];
    case 'codex':
      return [rt.env.CODEX_HOME ? path.resolve(rt.env.CODEX_HOME) : path.join(home, '.codex')];
    case 'cursor':
      return [
        rt.platform === 'darwin'
          ? path.join(home, 'Library', 'Application Support', 'Cursor')
          : path.join(rt.roots.config, 'Cursor'),
      ];
  }
}

// 插件安装根（默认·不含 per-host existsSync 精化——那是适配器 I/O）。
//   注：默认前身固定 <home>/.local/share/cc-master（**不**跟 XDG_DATA_HOME 迁移·保历史落点·首轮不搬数据）。
//   **每 host 的覆写 env 各自独立**（不可混用，否则会把一个 host 的插件根误当另一个 host 的·致误判 installed）：
//     · cursor → host-native ~/.cursor/plugins/local/cc-master，只认 CC_MASTER_CURSOR_PLUGIN_ROOT；
//     · codex/claude-code → 本地安装根 <base>/cc-master，认通用 CC_MASTER_PLUGIN_ROOT（否则 CC_MASTER_PLUGIN_DIR 定 base）。
export function pluginInstallRoot(rt: RuntimeEnvironment, host: RuntimeHost): string {
  const home = homeBase(rt.env, rt.homeDir);
  if (host === 'cursor') {
    if (rt.env.CC_MASTER_CURSOR_PLUGIN_ROOT)
      return path.resolve(rt.env.CC_MASTER_CURSOR_PLUGIN_ROOT);
    return path.join(home, '.cursor', 'plugins', 'local', 'cc-master');
  }
  if (rt.env.CC_MASTER_PLUGIN_ROOT) return path.resolve(rt.env.CC_MASTER_PLUGIN_ROOT);
  const base = rt.env.CC_MASTER_PLUGIN_DIR
    ? path.resolve(rt.env.CC_MASTER_PLUGIN_DIR)
    : path.join(home, '.local', 'share', 'cc-master');
  return path.join(base, 'cc-master');
}

// localPluginBase(rt) → codex/cursor 本地安装的**基座**（per-host 子目录之上一层）；供适配器叠 <host>/cc-master。
//   与 pluginInstallRoot 同前身（.local/share/cc-master·非 XDG），显式抽出供适配器复用而不各自内联 env.HOME。
export function localPluginBase(rt: RuntimeEnvironment): string {
  if (rt.env.CC_MASTER_PLUGIN_DIR) return path.resolve(rt.env.CC_MASTER_PLUGIN_DIR);
  return path.join(homeBase(rt.env, rt.homeDir), '.local', 'share', 'cc-master');
}

// ── 可执行发现（resolveExecutable·纯·取 rt.env / rt.cwd / rt.platform）────────────────────────────

function statifyExecutable(
  requested: string,
  source: 'explicit' | 'path',
  lexicalPath: string,
): ResolvedExecutable {
  let symlink = false;
  let regularFile = false;
  let executable = false;
  let realPath: string | null = null;
  let reason: string | null = null;

  try {
    symlink = fs.lstatSync(lexicalPath).isSymbolicLink();
  } catch {
    // lexical 目标不存在——lstat 失败留 symlink=false，下方 statSync 会给出 not-found reason。
  }

  try {
    const st = fs.statSync(lexicalPath); // 跟随 symlink
    regularFile = st.isFile();
    if (!regularFile) {
      reason = `not a regular file: ${lexicalPath}`;
    } else {
      try {
        fs.accessSync(lexicalPath, fs.constants.X_OK);
        executable = true;
      } catch {
        reason = `not executable: ${lexicalPath}`;
      }
    }
    try {
      realPath = fs.realpathSync(lexicalPath);
    } catch {
      realPath = null;
    }
  } catch {
    reason = `not found: ${lexicalPath}`;
  }

  return {
    requested,
    source,
    lexicalPath,
    realPath,
    executable,
    regularFile,
    symlink,
    reason: executable ? null : reason,
  };
}

function notFoundExecutable(requested: string, reason: string): ResolvedExecutable {
  return {
    requested,
    source: 'path',
    lexicalPath: '',
    realPath: null,
    executable: false,
    regularFile: false,
    symlink: false,
    reason,
  };
}

// resolveExecutable(rt, requested) → 词法/真实/身份分离的发现结果。
//   · requested 空 → 拒；
//   · 含路径分隔符（'/' 或 '\\'）→ 显式路径，按 rt.cwd 解析（相对）；
//   · 否则搜 rt.env.PATH（presence·空/缺 → 无目录）：相对条目按 rt.cwd 绝对化，空条目显式拒绝。
export function resolveExecutable(rt: RuntimeEnvironment, requested: string): ResolvedExecutable {
  if (!requested) return notFoundExecutable(requested, 'empty executable request');

  if (requested.includes('/') || requested.includes('\\')) {
    return statifyExecutable(requested, 'explicit', path.resolve(rt.cwd, requested));
  }

  // presence 而非 truthiness：只在 rt.env 显式带 PATH 键时取值，绝不回落 process.env。
  const hasPath = Object.hasOwn(rt.env, 'PATH');
  const pathValue = hasPath ? (rt.env.PATH ?? '') : '';
  const entries = pathValue.length > 0 ? pathValue.split(path.delimiter) : [];
  // 只支持 linux/darwin（other 降级同 POSIX）：无扩展名。win32 PATHEXT 不在本契约承诺内。
  const exts = [''];

  let sawEmptyEntry = false;
  for (const raw of entries) {
    if (raw === '') {
      // 空 POSIX PATH 条目传统意为 cwd——显式安全策略：拒绝、绝不静默搜 cwd。
      sawEmptyEntry = true;
      continue;
    }
    const dir = path.isAbsolute(raw) ? raw : path.resolve(rt.cwd, raw);
    for (const ext of exts) {
      const candidate = path.join(dir, `${requested}${ext}`);
      const hit = statifyExecutable(requested, 'path', candidate);
      if (hit.executable) return hit;
    }
  }

  const reason =
    entries.length === 0
      ? hasPath
        ? 'PATH is empty (no directories to search)'
        : 'PATH not present in environment'
      : sawEmptyEntry
        ? `not found in PATH (empty PATH entries rejected: cwd search disabled): ${requested}`
        : `not found in PATH: ${requested}`;
  return notFoundExecutable(requested, reason);
}
