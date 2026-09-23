## Decision

ACP 是模型供应商的另一种接入形式。用户仍通过现有供应商设置及模型选择器选择 `providerId/modelId/reasoningLevel`；Host 根据 providerId 选择 ZCode CLI 模型执行或 ACP 会话适配器。任务索引保存创建时的供应商、模型和执行适配器绑定；Renderer 只保留草稿和乐观态。ACP 不调用 ZCode CLI 的模型执行/SessionRecord，但复用现有 V4 展示契约。不能假装 ACP 提供 ZCode 独有的队列、Goal 或工作流。

```text
新建草稿 ──现有模型选择器──> providerId/modelId ──> Host 路由执行适配器 ──> 原生 sessionId
                             │                         │
                             └─ task index 绑定 ────────┘
ACP session/update ──> ACP 投影 ──> V4 订阅 ──> 桌面 continuous / 手机 replayable
用户命令 ──> 按 workspaceKey + taskId 找绑定 ──> 对应 Runtime 命令接纳
```

## State owners and persistence

- ZCode CLI 继续拥有自身会话、CommandInbox 和 V4 投影。ACP 适配器拥有 ACP 进程、每条 ACP 会话的命令接纳和事件投影；Host 只路由，不持有第二份已接纳输入队列。
- task index 是工作台层绑定的持久事实源。新增 providerId/modelId、内部执行适配器 ID 与 native session ID；旧数据按 ZCode CLI 解释。`taskId` 是工作台稳定 ID，不能再假定等于 ACP native session ID。
- `workspaceIdentity?.trim() || workspacePath` 是隔离键；`workspacePath` 只用于 cwd 和展示。远程连接继续传 `remoteSessionId`，不在 Main 新建远程 Host。
- 创建的顺序为：校验配置和握手 → 预留 taskId/命令身份 → ACP session/new → 原子保存绑定 → 承认 createSession → 首条 prompt。任一步失败要清理进程和未完成绑定，不留下假会话。
- 每个命令通过 commandId 幂等；重连后先查询已承认命令。ACP turn 的终态只能由 prompt 结果或明确错误/取消产生，进程退出不可归为成功。

## Protocol and capability mapping

ACP 客户端用官方 SDK 的 JSON-RPC stdio 通道。`initialize` 协商协议版本、loadSession、prompt 内容、FS/terminal 与认证方法；仅调用已声明的方法。`session/new` 与 `session/load` 使用绝对 cwd 和可用 MCP 服务。`session/update` 只映射已定义的 message/tool/plan/config 事件；不认识的事件按协议扩展安全忽略并保留诊断。`session/request_permission` 复用现有交互展示和 Host 决策。取消发送 `session/cancel`，等待轮次收口后关闭进程树。

思考等级不是统一固定枚举。每条 ACP 会话以 `session/new`/`session/load` 的 `configOptions` 和 `config_option_update` 为权威；标准 `thought_level` select 和 Agent 实际提供的 `model/reasoning_effort` 都映射到工作台思考控件。切模型后重新核对可选值，只在 `session/set_config_option` 成功后更新状态。`agent_thought_chunk` 只是输出事件，不能推断 Agent 支持等级控制。权限逐请求使用 ACP 原生 `optionId`，先显示选项，再返回实际选择；一次/持续许可不得由 CodeZ 模式名推导，取消/退出统一答 `cancelled`。

运行时可执行路径由可信 Host 配置解析；第一批内置运行时为 qoder、cline、codebuddy、workbuddy，以当前 CodeZ 的安装探测和实际 ACP 握手验证能力。配置只保存非秘密元数据；凭据仍归 CLI。安装器只下载已明确来源/版本/校验值的发行物，不执行来自界面的任意命令。Codex 暂不纳入本次 Runtime 清单。

自定义 ACP 供应商从实际执行 Host 的 `~/.codez/v2/agent-servers.json` 读取。顶层仅接受 `agent_servers` 对象；每个键是稳定、格式合法的 ID，值为 `{name, command, args}`。`command` 必须是绝对可执行文件路径，`args` 必须是字符串数组；Host 用 argv 启动，不经 shell。逐项校验并报告错误，坏条目不影响有效条目或 ZCode CLI。自定义 ID 只能在 Host 已校验注册表命中后执行。配置缺失或变更导致旧会话无法安全恢复时保留历史并拒绝继续，绝不改投其他执行适配器。内置四条只作过渡；本阶段不删除。移除前先审计已有绑定并以同 ID 显式迁移、实际验证恢复，再用陌生 Agent 完成创建/权限/记忆/桌面和手机验收。

模型元数据由模型设置的手动同步触发 ACP 握手和查询，之后用户每次切换模型启用状态即保存到 CodeZ 数据目录的 `agent-models.json`，失败回滚。输入框只读取这份持久选择，不在进入设置、启动应用或创建会话时隐式刷新模型目录。保存时校验勾选 ID 属于本次同步结果；命令/参数指纹不匹配时缓存失效。免费、折扣和积分倍率只显示 Agent 返回的 description 明文，未返回时留空；同名模型以 ID 后缀区分。未显式选择思考等级时保留 Agent 默认值。

## Memory

当前 ZCode CLI 从 `cli/memories/projects/<workspace-key>/memory/MEMORY.md` 读取索引，按 200 行/25k 字符上限格式化，并同时注入 `# agentsMd` 索引来源与 `# Memory` 目录/读写规则。ACP 适配器按相同 workspaceIdentity 算法定位 CodeZ 数据根目录，每次 prompt 前读取当前索引，向支持 `embeddedContext` 的 Agent 传 resource，其他 Agent 传带 assistant audience 的文本；索引不进入用户可见转录。目录不存在时按 ZCode 行为创建，索引缺失时仍传目录规则。本阶段 ACP 自动提取不可用，设置页明示差异；不新增 JSON 建议写入器或宣称与 ZCode CLI 完全等价。后续启用自动提取须另行验证调度、上下文、工具权限与有界文件写入。

## UI and branding

“模型设置”的现有供应商列表中显示 ACP 供应商卡片，展示安装/认证/握手/恢复能力；现有输入框模型选择器展示这些供应商的模型与思考等级，不显示第二个 Runtime 控件。创建后显示固定供应商和受能力控制的模型/模式/附件/专属功能。改变草稿选择不迁移既有会话；同会话跨执行适配器的上下文移交不属于本次自动行为。

应用使用 `CodeZ` 显示名、独立 appId/AUMID/协议身份与反向 Z 图标。默认数据根为 `~/.codez`，含非项目工作区；现有 `~/.zcode` 保持只读且不自动迁移。项目内 `.zcode` 配置语义与 CLI 兼容性要逐处核对，不能机械全局替换。

## Delivery and failures

- Desktop `desktop-continuous` 继续实时增量；手机 `web-remote-replayable` 由同一 ACP 投影提供快照/断档恢复。订阅不会再次执行 prompt。
- CodeZ 自己持久记录已发送的用户 prompt、ACP `session/update` 和每轮 `session/prompt` 终态；恢复历史不依赖各 Agent 的 `session/load` 是否完整重放。原始记录按 workspaceKey + taskId 隔离，重连时重放到同一 V4 投影。
- 恢复先验证 `loadSession`，失败保留绑定和历史展示，标记不可继续，绝不创建替代 native session。
- 权限、文件和终端回调采用已有 Host 权限/路径边界；不把这些权力交给 Renderer。MCP 参数和环境变量避免日志打印秘密。
- 安装失败、认证缺失、协议不兼容、进程崩溃、网络断线各自有显式状态；不自动降级到另一 Runtime。

## Validation

协议适配器用可控 fake ACP agent 测 initialize/new/load/prompt/update/cancel、权限、崩溃、重复 commandId 和能力缺失；用至少一个已安装的真实 ACP Agent 做 CodeZ 端 smoke。检查旧 ZCode 会话、两个 Runtime 并存、桌面和手机恢复、记忆开关/身份隔离、安装包身份和 `~/.codez` 路径。运行目标包测试、`pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`，最后做一次 rv。
