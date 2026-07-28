# Plugin 发布体系

## 分发边界

Source、dist、package 三层分开：

```text
plugin/src/         # semantic source
plugin/dist/<host>/ # generated installable adapter
release artifact    # zip/tar/package/marketplace entry
```

发布输入必须是 Trusted Projection Transaction 已提交的 host artifact，以及绑定它的
publish receipt、verified snapshot attestation 与冻结 bundle plan。package 不从
`plugin/src` 或未验证 live dist 自行发现文件；`plugin/src` 里的 knowledge、design、eval、
strategy、manifest contract 等维护材料不进入用户安装包。

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

Cursor 当前没有与 `claude plugin validate` 对等的官方 validator。其可执行门至少包括：

```bash
bash scripts/sync-plugin-dist.sh --host cursor
bash scripts/check-plugin-dist-sync.sh
node --test tests/content/capability-host-coverage.test.mjs tests/content/structure.test.mjs
```

package 必须保留 `.cursor-plugin/plugin.json`、`commands/`、`skills/`、`rules/`、`hooks/` 与 launcher；
能力等价仍由 Cursor hook / capability fixture 和真实 IDE probe 验收，不能用 package shape 替代。
projection/validation 完成并发布 sealed host snapshot 后，另以
`bash scripts/package-plugin.sh --manifest <trusted-release-input.json>` 消费四 host 的
receipt/attestation/frozen bundle plan。

## Drift 防线

- `dist` generated，不手改。
- sync 脚本缺 strategy/meta 时 fail。
- content tests 读 source 和 dist 的对应位置。
- source 与 trusted host plan 在 compiler 前冻结；sealed verified snapshot 是 publish 唯一权威。
- package 脚本只消费 receipt/attestation/frozen bundle plan，绝不 sync 或重新 compile。
- release CI 先在独立 projection 阶段完成 sync/verify/publish，再把已提交证据交给 package。
