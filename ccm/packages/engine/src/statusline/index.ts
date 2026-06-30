// statusline/ — self-contained status line（0.10.0）：渲染单行 ANSI 状态行 + 捕获账户用量 sidecar +
//   幂等安装 / 卸载 / 无感知自动安装（取代退役的带外脚本 statusline-capture.js）。

export { type CaptureResult, captureRateLimits } from './capture.js';
export {
  autoInstallStatuslineOnce,
  installStatusline,
  type StatuslineActionResult,
  settingsPath,
  uninstallStatusline,
} from './install.js';
export { type RenderOptions, renderStatusline } from './render.js';
