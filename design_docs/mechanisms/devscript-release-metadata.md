# 机制契约：`scripts/release-metadata.mjs`（dev-only）

> 类别：dev-only 发布脚本（NOT a hook·**不随 plugin 分发**·仅 release workflow / 仓库维护者调用）。源码：`scripts/release-metadata.mjs`。它是 plugin 与 ccm 两条 GitHub release 的 title、prerelease 标记与正文生成/复验单一入口。

## 触发输入

- `plan --tag <tag> --repository <owner/repo> [--github-output <path>]`：只接受 `vX.Y.Z[-rc.N]` 或 `ccm-vX.Y.Z[-rc.N]`。
- `validate --metadata-json <json>`：复验一份已经生成的元数据。
- plugin 读取根 `CHANGELOG.md`；ccm 读取 `ccm/apps/cli/CHANGELOG.md`。对应版本 section 必须存在且非空。

## 业务流

1. 从 tag 前缀判定 plugin / ccm family、版本、预发布状态、产品名与 changelog 路径。
2. 精确定位 matching version section，统一换行并剔除行尾空白；读取范围在下一个二级版本标题前停止。
3. 从 section 的第一条正文推导不超过 180 字符的摘要。
4. RC 正文只使用摘要；正式版正文使用完整 matching section。两者末尾都追加指向同一 tag 的 CHANGELOG 链接。
5. 用同一份 changelog 源重新推导期望值，逐项复验 title、family、version、prerelease、summary、path 与完整 body；任一漂移即 fail closed。

## 输出副作用

- 默认把结构化 metadata JSON 写到 stdout。
- 提供 `--github-output` 时，以随机碰撞防护 delimiter 写入 GitHub Actions output 文件。
- 不创建 tag、不创建 release、不修改 changelog，也不访问网络。

## 关键不变式

- changelog 是 release notes 的内容 SSOT；workflow 不手写第二份正文。
- 正式版不得退化为一行摘要或截断 section；RC 不复制整段稳定版说明。
- release 链接必须 pin 到正在发布的 tag，不能指向会继续变化的分支。
- plugin 与 ccm 保持独立 tag / 版本线 / changelog，但共享同一个生成与复验机制。

## 失败模式

- tag / repository 形状非法、版本 section 缺失或为空、摘要超长 → exit 1。
- title、prerelease、summary、body 或 changelog path 被人工改写 → exit 1。
- GitHub output delimiter 与正文碰撞 → exit 1，不输出不完整 metadata。
