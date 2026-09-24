## State owner and sequence

TaskIndex 保存最后一次 Agent 确认的 `acpModeId`。ACP Connection 负责实际模式协商；Runtime Coordinator 在 `session/load` 后重放该值，成功后才开放会话。V4 投影展示 Agent 当前确认值，输入框只发送 Agent 宣告的选项。

```text
用户选择 → V4 命令 → Agent 确认 → TaskIndex 保存 → V4 快照展示
重新打开 → session/load → 对比 TaskIndex → Agent 确认重放 → 接受新输入
```

若 Agent 拒绝、模式消失或持久化失败，保留原 TaskIndex 值并关闭或禁用本次会话。旧 task 无保存值时使用本次 Agent 当前值，用户选择后开始持久化。
