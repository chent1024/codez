## Why

ACP 供应商目前只能创建，已有配置缺少修改和删除入口；添加表单的呈现也与同页 API 供应商流程不一致。

## What Changes

- 沿用现有 API / ACP 卡片选择页，以相同的标题、返回入口和紧凑表单样式添加自定义 ACP 供应商。
- 已配置的自定义 ACP 供应商可修改显示名称、执行命令与参数；稳定 ID 保持不变。
- 已配置的自定义 ACP 供应商可经确认后删除；失败时保留原配置并显示错误。
- 内置 ACP 入口继续由代码管理，不提供修改或删除操作。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-runtime-selection`: 补充自定义 ACP 供应商的添加呈现、修改、删除与会话安全语义。

## Impact

影响 `packages/ui` 模型设置、`packages/services` Host 侧 ACP 注册表与服务接口，以及相关测试。不改变 ACP 会话路由或内置 Agent 清单。
