# Plugin 发布体系

## 分发边界

Source、dist、package 三层分开：

```text
plugin/src/         # semantic source
plugin/dist/<host>/ # generated installable adapter
release artifact    # zip/tar/package/marketplace entry
```

发布脚本必须从 `plugin/dist/<host>` 打包，而不是从 `plugin/src` 打包。`plugin/src` 里有 design、eval、strategy、manifest contract 等维护材料，不应全部进入用户安装包。

## CLI 与 plugin 的关系

CLI 负责：

- host detection
- sync / projection
- install / uninstall / validate
- compatibility report
- release packaging

Plugin 负责：

- runtime commands
- runtime skills
- runtime hooks
- host-native manifest

如果 CLI 和 plugin 有不同版本线，发布说明要明确哪个 artifact 需要 bump。不要把 CLI 的 dev-only dependency 带入 hook runtime。

## 发布前检查

最低检查：

```bash
bash scripts/sync-plugin-dist.sh
bash run-tests.sh
claude plugin validate plugin/dist/claude-code
```

多 host 后，每个 host 至少要有：

- `design_docs/harnesses/<host>.md` 的机制事实和风险记录
- projection check
- host-native manifest validation
- skill discovery check
- hook registration check
- package contents check

## Drift 防线

- `dist` generated，不手改。
- sync 脚本缺 strategy/meta 时 fail。
- content tests 读 source 和 dist 的对应位置。
- package 脚本先 sync 再打包。
- release CI 跑 sync check，确认工作树无 dist drift。
