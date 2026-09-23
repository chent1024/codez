## Why

CodeZ 需要在现有模型供应商流程中接入 ACP Agent，同时与官方 ZCode 应用并排安装和运行。当前供应商选择只通向 ZCode CLI 的模型执行，无法将 ACP 供应商的选择路由到对应 Agent，也无法保证它们取得正确的项目记忆。

## What Changes

- 模型设置中可配置 API 与 ACP 两类供应商；输入框继续使用现有模型与思考等级选择器，不新增 Runtime 选择器。选中的供应商决定后端执行适配器；多个供应商可并存。
- 接入 ACP v1 的能力协商、会话创建/恢复、消息流、权限、取消、文件及终端回调，并映射到工作台的会话展示与错误状态。
- 在现有模型供应商列表中呈现 ACP 供应商，展示安装、认证/可用状态与能力。
- “添加供应商”先选择 API 或 ACP。ACP 由实际执行 Host 的 `~/.codez/v2/agent-servers.json` 注册；现阶段四个内置 ACP 入口与自定义条目并存。只有在陌生 Agent 与存量会话验收后，后续变更才移除内置入口。
- 将 CodeZ 的项目记忆按工作区身份和启用状态有界传给 ACP 会话，不跨工作区泄露，不重复作为用户输入入账。
- 桌面应用显示为 CodeZ，图标采用反向 Z；应用身份和默认数据/非项目工作区迁到 `~/.codez`，与 ZCode 分离。不自动读取或迁移旧 `~/.zcode` 数据。

## Capabilities

### New Capabilities

- `agent-runtime-selection`: 供应商接入形式、模型选择、会话归属、恢复和并存。
- `acp-conversation`: ACP 协议、能力协商、消息/工具/权限事件与失败语义。
- `acp-project-memory`: ACP 会话读取 CodeZ 项目记忆的规则。
- `codez-app-identity`: 安装身份、图标、显示名及默认数据路径隔离。

### Modified Capabilities

无。当前仓库没有已归档 OpenSpec 能力。

## Impact

影响 `packages/shared` 模型选择与会话协议、`packages/services` 供应商视图/Host/任务索引/记忆、`packages/ui` 现有供应商设置与模型选择、`packages/desktop` 应用身份和图标、以及桌面/远程 Host 的恢复链路。ACP 是供应商的另一种接入形式；执行仍由 ACP Agent 负责，不以 ZCode CLI 的内部模型协议代理。ACP CLI 的可执行命令和认证仍由各 CLI 自身负责。
