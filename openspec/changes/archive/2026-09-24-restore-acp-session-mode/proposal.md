## Why

ACP 会话只在创建前应用所选模式，任务索引没有保存 Agent 已确认的模式。重新打开历史会话时，输入框可能显示 Agent 的默认模式，且已有会话无法在输入框重新选择模式。

## What Changes

- 保存每个 ACP task 的已确认模式 ID，恢复原生会话时先重放，再允许输入。
- 允许在空闲的历史 ACP 会话中切换 Agent 宣告的模式；确认后更新任务索引和界面。
- 保存或恢复失败时阻止继续以不确定的模式执行；旧记录没有保存值时采用 Agent 当前报告值，不猜测过去的选择。

## Capabilities

### Modified Capabilities

- `acp-conversation`: 历史会话模式恢复与切换。

## Impact

影响 ACP task 元数据、会话恢复、模式命令、输入框和相关测试；不改变 ACP 原生权限请求的 `optionId` 处理。
