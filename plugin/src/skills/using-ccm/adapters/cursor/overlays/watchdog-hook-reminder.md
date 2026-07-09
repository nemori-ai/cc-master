Cursor hook 可以在 Stop / SessionStart 等事件里注入提醒，但它不能凭空创建一个未来唤醒。不要把 hook 提醒当成 durable timer；它只能在 Cursor 再次触发相关事件时发声。
