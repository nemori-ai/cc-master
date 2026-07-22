当前 host 支持 Claude Code 的 `Workflow` runtime。你可以把 `executor=workflow` 映射到一次真实 Workflow 工具调用，并把返回的 workflow handle 记入运行时证据；脚本内部的 `agent()` / `parallel()` / `pipeline()` 语义再交给 `authoring-workflows`。
