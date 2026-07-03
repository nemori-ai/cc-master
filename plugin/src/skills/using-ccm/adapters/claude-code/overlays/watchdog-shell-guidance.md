`shell` 是 universal floor——任何环境都能用，机制最简单：

```bash
# background-shell until 轮询示例
until ccm task show T7 --json | grep '"status":"done"'; do sleep 300; done
```
