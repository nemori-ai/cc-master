// handlers/upgrade.ts — upgrade noun handler（自升级 ccm 二进制 + cc-master 插件·三 verb：all / ccm / plugin）。
//
// 让本机装了 ccm 的用户用 CLI 直接升级两件解耦的发布物：
//   · ccm 二进制（per-OS Node SEA·ADR-014·随 GitHub `ccm-v*` 线发布·资产名 `ccm-<os>-<arch>`）；
//   · cc-master 插件（「解压即装」zip·随 GitHub 裸 `v*` 线发布·由 claude CLI 经 marketplace 托管）。
//   三 verb：`ccm upgrade`（默认 verb=all·两者各升各自线最新）/ `ccm upgrade ccm [--to <ccm-v*>]` /
//            `ccm upgrade plugin [--to <v*>]`（默认升本机已安装且支持分发的全部 harness；`--harness` 单目标）。
//            `--dry-run`（全局 flag）只查「当前 vs 最新」并打印计划、不真升。
//
// **不是 board 操作**——不走 discover/runWrite/runRead；纯进程级动作（GitHub releases 列举 + 下载 + 自替换 +
//   shell out claude CLI）。async（同 account switch·router 透传 Promise·bin/sea await 落码）。
//
// 版本解析（与 install.sh 同款·关键坑）：GitHub `/releases/latest` **不分前缀**——故用 `/releases` 列表 + tag
//   前缀过滤 + semver 排序取最新（ccm 线滤 `ccm-v*`、plugin 线滤裸 `v*` 且排除 `ccm-v*`）。某线暂无 release →
//   优雅报错（不崩）。本线版本号比较仅作参考：ccm 二进制内部版本号（随 monorepo）与 ccm-v* 发布线**已解耦**。
//
// ccm 二进制自替换：探当前 SEA 自身路径（process.execPath）→ 下载新 `ccm-<plat>` 到**同目录**临时文件 →
//   chmod +x → 验新二进制 `--version` 能跑 → 原子 renameSync 覆盖自身路径（macOS/Linux：运行中进程持旧 inode·
//   覆盖目录项安全）。非 SEA（node 脚本形态：dev / 全局 npm install）→ 拒绝自替换 + 清晰报错。
//
// 插件升级：按 HarnessAdapter 的 plugin distribution strategy 执行。Claude Code 策略走 claude plugin
//   marketplace/update；Codex 策略走本地 marketplace/plugin registry 注册 plugin+skills（不再同步 prompts）；未来 harness 只需在
//   adapter 内实现同一命令接口。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（https/child_process/fs/os/path）。注：这是 CLI（非
//   hook）——可自由用 node:https / child_process（同 account.ts spawnSync / engine refresh https 先例）。
// 武装闸豁免：纯 handler（无 hook 入口·只被 router import）——见 AGENTS.md §3 红线6 / §12 grep 门豁免。

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import {
  inspectKnownHarnesses,
  knownHarnessAdapters,
  resolveHarnessAdapter,
} from '../harnesses/registry.js';
import type { HarnessAdapter, PluginUpgradeResult } from '../harnesses/types.js';
import { readVersion } from '../help.js';
import * as io from '../io.js';
import type { Ctx } from './_common.js';

const EXIT = io.EXIT;

// ── 常量（与 install.sh 钉死同一仓库 / marketplace / 资产命名）─────────────────────────────────────────
const REPO = 'nemori-ai/cc-master';
const API_BASE = 'https://api.github.com';
const DL_BASE = 'https://github.com';
const UA = 'ccm-upgrade'; // GitHub API 要求带 User-Agent，否则 403。
// ════════════════════ 纯函数（无 IO·导出供单测）════════════════════════════════════════════════════
// 平台探测：node process.platform/arch → `ccm-<os>-<arch>` 资产名；不支持组合 → null（与 install.sh detect_platform 同覆盖）。
const OS_MAP: Record<string, string> = { darwin: 'darwin', linux: 'linux' };
const ARCH_MAP: Record<string, string> = { arm64: 'arm64', x64: 'x64' };
export function detectAssetName(platform: string, arch: string): string | null {
  const o = OS_MAP[platform];
  const a = ARCH_MAP[arch];
  if (!o || !a) return null;
  return `ccm-${o}-${a}`;
}

interface ParsedTag {
  tag: string;
  parts: [number, number, number];
  pre: string; // prerelease 段（如 'rc.1'）·空串=稳定版
}

// parseTag(tag, line) — 把 release tag 解析成结构化版本（仅当匹配该线前缀）；否则 null。
//   line='ccm'    → 须 `ccm-v<major>.<minor>.<patch>[-pre]`。
//   line='plugin' → 须裸 `v<major>.<minor>.<patch>[-pre]` 且**排除** `ccm-v*`（两线共用 tag namespace 的去歧）。
export function parseTag(tag: string, line: 'ccm' | 'plugin'): ParsedTag | null {
  if (typeof tag !== 'string') return null;
  if (line === 'ccm') {
    const m = /^ccm-v(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(tag);
    if (!m) return null;
    return { tag, parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' };
  }
  if (tag.startsWith('ccm-')) return null; // plugin 线绝不含 ccm-v* tag。
  const m = /^v(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(tag);
  if (!m) return null;
  return { tag, parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' };
}

// compareSemver(a,b) — -1/0/1。先比 core（maj.min.patch）；core 相等时稳定版（pre==='')> 任意 prerelease；
//   都 prerelease → 字典序（够用·不实现完整 SemVer §11 prerelease 规则·release 线极少撞同 core 多 pre）。
export function compareSemver(a: ParsedTag, b: ParsedTag): number {
  for (let i = 0; i < 3; i++) {
    const d = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === '') return 1;
  if (b.pre === '') return -1;
  return a.pre < b.pre ? -1 : 1;
}

// pickLatestTag(tags, line) — 过滤匹配该线的 tag + 选 semver 最大；无匹配 → null（该线暂无 release）。
export function pickLatestTag(tags: string[], line: 'ccm' | 'plugin'): string | null {
  let best: ParsedTag | null = null;
  for (const t of tags) {
    const p = parseTag(t, line);
    if (!p) continue;
    if (!best || compareSemver(p, best) > 0) best = p;
  }
  return best ? best.tag : null;
}

// coreParts(v) — 从任意版本串里抠出 [maj,min,patch]（容忍前缀/后缀·读不出 → [0,0,0]）。
function coreParts(v: string): [number, number, number] {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function compareCore(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

// ════════════════════ 网络（async·node:https·跟随重定向）═══════════════════════════════════════════
function ghHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': UA, Accept: 'application/vnd.github+json' };
  const tok = env.GITHUB_TOKEN || env.GH_TOKEN; // 可选 auth：避匿名限流（403）。
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

// httpsGetBuffer — GET 收全 body 进内存（仅用于 GitHub API 小 JSON）；跟随 ≤5 次重定向；30s 超时。
function httpsGetBuffer(
  url: string,
  headers: Record<string, string>,
  redirectsLeft = 5,
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      reject(new Error(`非法 URL：${url}`));
      return;
    }
    const req = https.get(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + (u.search || ''), headers },
      (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && loc && redirectsLeft > 0) {
          res.resume();
          httpsGetBuffer(new URL(loc, url).toString(), headers, redirectsLeft - 1).then(
            resolve,
            reject,
          );
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('GitHub API 请求超时（30s）')));
  });
}

// downloadToFile — 流式下载到 dest（二进制大·不进内存）；跟随重定向（GitHub release 下载会 302 到签名 URL）；120s 超时。
function downloadToFile(
  url: string,
  dest: string,
  headers: Record<string, string>,
  redirectsLeft = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      reject(new Error(`非法 URL：${url}`));
      return;
    }
    const req = https.get(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + (u.search || ''), headers },
      (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && loc && redirectsLeft > 0) {
          res.resume();
          downloadToFile(new URL(loc, url).toString(), dest, headers, redirectsLeft - 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`下载返回 HTTP ${status}`));
          return;
        }
        const ws = fs.createWriteStream(dest);
        res.pipe(ws);
        ws.on('finish', () => ws.close(() => resolve()));
        ws.on('error', reject);
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('下载超时（120s）')));
  });
}

// fetchReleaseTags — GET /repos/<repo>/releases?per_page=100 → tag_name[]（匿名不含 draft）。
async function fetchReleaseTags(env: Record<string, string | undefined>): Promise<string[]> {
  const { status, body } = await httpsGetBuffer(
    `${API_BASE}/repos/${REPO}/releases?per_page=100`,
    ghHeaders(env),
  );
  if (status !== 200) {
    const hint = status === 403 ? '（可能触发匿名限流——可设 GITHUB_TOKEN 环境变量后重试）' : '';
    throw new Error(`GitHub API 返回 HTTP ${status}${hint}`);
  }
  let arr: unknown;
  try {
    arr = JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error('GitHub API releases 响应非 JSON');
  }
  if (!Array.isArray(arr)) throw new Error('GitHub API releases 响应非数组');
  const tags: string[] = [];
  for (const r of arr) {
    if (r && typeof r === 'object' && typeof (r as { tag_name?: unknown }).tag_name === 'string') {
      tags.push((r as { tag_name: string }).tag_name);
    }
  }
  return tags;
}

// ════════════════════ verb: ccm（二进制自替换）═══════════════════════════════════════════════════════
export async function ccm(ctx: Ctx): Promise<number> {
  const env = ctx.env;
  const asset = detectAssetName(process.platform, process.arch);
  if (!asset) {
    ctx.err(
      `upgrade(ccm): 不支持的平台 ${process.platform}/${process.arch}——ccm 发布覆盖 darwin|linux × arm64|x64。`,
    );
    return EXIT.ERROR;
  }

  // SEA 自感知：process.execPath 即 ccm 自身（生产 SEA）；若是 node（dev / 全局 npm install）→ 不能自替换。
  const execPath = process.execPath;
  const isNode = ['node', 'node.exe'].includes(path.basename(execPath).toLowerCase());
  if (isNode) {
    ctx.err(
      'upgrade(ccm): 当前 ccm 以 Node 脚本形态运行（开发 / 全局 npm 安装），不是自包含 SEA 二进制——`ccm upgrade ccm` 只支持原子替换 SEA 二进制。请用你的安装方式升级（重跑 install.sh，或在 ccm/ 里 pnpm build:sea）。',
    );
    return EXIT.ERROR;
  }

  // ── 解析目标 tag（--to 显式 > 线上最新）。───────────────────────────────────────────────────────────
  const to = (ctx.values.to as string) || '';
  let tag = to;
  if (!tag) {
    let tags: string[];
    try {
      tags = await fetchReleaseTags(env);
    } catch (e) {
      ctx.err(`upgrade(ccm): 无法从 GitHub 取 release 列表——${(e as Error).message}。`);
      return EXIT.ERROR;
    }
    const latest = pickLatestTag(tags, 'ccm');
    if (!latest) {
      ctx.err(
        'upgrade(ccm): ccm 线（ccm-v*）暂无任何已发布 release——无法自动升级。可用 `--to <ccm-vX.Y.Z>` 指定具体 tag，或等首个 ccm release 发出后重试。',
      );
      return EXIT.ERROR;
    }
    tag = latest;
  }

  const currentVer = readVersion();
  const parsed = parseTag(tag, 'ccm');
  const latestCore = parsed ? parsed.parts : coreParts(tag.replace(/^ccm-v/, ''));
  const curCore = coreParts(currentVer);

  // 未显式 --to 且本地核版本 ≥ 线上最新 tag 核版本 → 默认不动（避免意外降级·版本线已解耦故仅作参考门）。
  if (!to && compareCore(curCore, latestCore) >= 0) {
    ctx.out(
      `upgrade(ccm): 本地 ccm ${currentVer} ≥ 线上最新 tag ${tag}（核版本比较·版本线已解耦仅作参考）——视为已最新、跳过。如需强制重装该 tag：\`ccm upgrade ccm --to ${tag}\`。`,
    );
    if (ctx.flags.json) {
      ctx.out(io.jsonOk({ component: 'ccm', action: 'noop', current: currentVer, latest: tag }));
    }
    return EXIT.OK;
  }

  const url = `${DL_BASE}/${REPO}/releases/download/${tag}/${asset}`;

  if (ctx.flags.dryRun) {
    ctx.out('── ccm upgrade ccm DRY-RUN（不下载 / 不替换）──');
    ctx.out(`current      : ${currentVer}`);
    ctx.out(`target tag   : ${tag}${to ? ' (--to)' : ' (线上最新)'}`);
    ctx.out(`asset        : ${asset}`);
    ctx.out(`download     : ${url}`);
    ctx.out(`replace path : ${execPath}（原子 mv 覆盖运行中二进制·旧 inode 安全）`);
    if (ctx.flags.json) {
      ctx.out(
        io.jsonOk({
          component: 'ccm',
          dry_run: true,
          current: currentVer,
          target: tag,
          asset,
          url,
          path: execPath,
        }),
      );
    }
    return EXIT.OK;
  }

  // ── 下载到 execPath 同目录临时文件（同 fs·rename 原子·避免跨设备 EXDEV）→ chmod → 验 --version → 原子覆盖。──
  const dir = path.dirname(execPath);
  let tmpDir: string | null = null;
  let tmp = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(dir, '.ccm-upgrade-'));
    tmp = path.join(tmpDir, asset);
    ctx.err(`upgrade(ccm): 下载 ${url} …`);
    await downloadToFile(url, tmp, ghHeaders(env));
    fs.chmodSync(tmp, 0o755);
    let ver = '';
    try {
      ver = execFileSync(tmp, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
    } catch (e) {
      throw new Error(
        `新二进制无法执行（${asset} 平台不匹配 / 下载损坏）：${(e as Error).message}`,
      );
    }
    if (!ver) throw new Error('新二进制 `--version` 输出为空（疑似损坏）。');
    fs.renameSync(tmp, execPath); // 原子替换运行中二进制（旧 inode 由本进程持有·安全）。
    tmp = '';
    ctx.out(`✓ ccm 已升级 → ${tag}（${ver}·已替换 ${execPath}）。`);
    try {
      // Capture (not discard) reconcile output so a real failure can be surfaced. reconcile is now
      //   fail-loud: a wanted service that did not land on the new binary exits nonzero, which makes
      //   execFileSync throw here. The generous timeout covers the sequential monitor + web-viewer
      //   cold-start health waits.
      execFileSync(execPath, ['services', 'reconcile', '--after-binary-replace', '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 30000,
      });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
      ctx.err(
        `upgrade(ccm): 注意——ccm 二进制已替换，但 services reconcile 未成功（可稍后手动跑 \`ccm services reconcile --after-binary-replace\`）：${detail}`,
      );
    }
    if (ctx.flags.json) {
      ctx.out(
        io.jsonOk({
          component: 'ccm',
          action: 'upgraded',
          from: currentVer,
          to: tag,
          version: ver,
          path: execPath,
        }),
      );
    }
    return EXIT.OK;
  } catch (e) {
    ctx.err(`upgrade(ccm): 失败——${(e as Error).message}（未替换原二进制·当前 ccm 不受影响）。`);
    return EXIT.ERROR;
  } finally {
    try {
      if (tmp) fs.unlinkSync(tmp);
    } catch {
      /* best-effort 清理 */
    }
    try {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort 清理 */
    }
  }
}

// ════════════════════ verb: plugin（按 harness adapter 分发）═══════════════════════════════════════════
// 默认：枚举本机已安装且支持 plugin 分发的 harness，逐个升级。
// 单目标：显式 `--harness <id>`（与 `--all-harnesses` 互斥；后者现为默认的兼容别名）。
export async function plugin(ctx: Ctx): Promise<number> {
  const harnessFlag =
    typeof ctx.values.harness === 'string' && ctx.values.harness.trim()
      ? String(ctx.values.harness).trim()
      : '';
  const wantAll = ctx.values['all-harnesses'] === true;

  if (harnessFlag && wantAll) {
    ctx.err('upgrade(plugin): `--harness` 与 `--all-harnesses` 不能同时使用。');
    return EXIT.USAGE;
  }

  if (harnessFlag) {
    const harness = resolveHarnessAdapter({
      env: ctx.env,
      harnessFlag,
    });
    const result = await pluginForHarness(ctx, harness, { emitJson: ctx.flags.json });
    return result.exitCode;
  }

  // Default (and explicit --all-harnesses): upgrade every installed, supported harness.
  return pluginAllHarnesses(ctx);
}

async function pluginForHarness(
  ctx: Ctx,
  harness: HarnessAdapter,
  opts: { emitJson: boolean },
): Promise<PluginUpgradeResult> {
  const env = ctx.env;
  const to = (ctx.values.to as string) || '';
  return harness.upgradePlugin({
    env,
    to,
    dryRun: ctx.flags.dryRun,
    json: opts.emitJson,
    verbose: ctx.flags.verbose,
    out: ctx.out,
    err: ctx.err,
    jsonOk: io.jsonOk,
    resolveLatestPluginTag: async () => pickLatestTag(await fetchReleaseTags(env), 'plugin'),
  });
}

async function pluginAllHarnesses(ctx: Ctx): Promise<number> {
  const installed = inspectKnownHarnesses(ctx.env).filter((h) => h.installed);
  const adapters = knownHarnessAdapters();
  if (installed.length === 0) {
    ctx.err(
      'upgrade(plugin): 未发现本机已安装的 ccm-supported harness。可用 `ccm harness list` 查看探测结果。',
    );
    if (ctx.flags.json) ctx.out(io.jsonOk({ component: 'plugin', action: 'skipped', results: [] }));
    return EXIT.USAGE;
  }

  const results: PluginUpgradeResult[] = [];
  let supportedCount = 0;
  let firstFailure: number = EXIT.OK;
  for (const h of installed) {
    const adapter = adapters.find((a) => a.id === h.id);
    if (!adapter) continue;
    if (adapter.pluginDistribution.supported) supportedCount++;
    const result = await pluginForHarness(ctx, adapter, { emitJson: false });
    results.push(result);
    if (
      adapter.pluginDistribution.supported &&
      result.exitCode !== EXIT.OK &&
      firstFailure === EXIT.OK
    ) {
      firstFailure = result.exitCode;
    }
  }

  if (ctx.flags.json) {
    ctx.out(io.jsonOk({ component: 'plugin', action: 'all-harnesses', results }));
  }
  if (supportedCount === 0) {
    ctx.err(
      'upgrade(plugin): 已发现 harness，但没有任何已安装 harness 当前支持 plugin 分发/升级。',
    );
    return EXIT.USAGE;
  }
  return firstFailure;
}

// ════════════════════ verb: all（默认 verb·两者各升各自线最新）═══════════════════════════════════════
//   先 ccm 再 plugin（互不依赖·一个失败不挡另一个）；退出码取「先失败者」（都成才 0）。dry-run 经 ctx.flags 流过。
export async function all(ctx: Ctx): Promise<number> {
  ctx.err('upgrade: 升级 ccm 二进制 + cc-master 插件（各自线最新）…');
  const ccmCode = await ccm(ctx);
  const plgCode = await plugin(ctx);
  return ccmCode !== EXIT.OK ? ccmCode : plgCode;
}
