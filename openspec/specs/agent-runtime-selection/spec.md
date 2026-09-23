# agent-runtime-selection Specification

## Purpose

让用户通过现有模型供应商和模型选择流程使用 API 或 ACP，同时保证每条会话在创建、恢复和跨设备访问时由原执行适配器拥有。

## Requirements

### Requirement: ACP as a model provider form

CodeZ SHALL 在现有模型供应商列表提供已配置的 ACP 供应商，列出其安装、认证及可用状态。用户 SHALL 在现有输入框模型选择器中选择 ACP 供应商公布的模型与思考等级；输入框和设置页 SHALL NOT 增加独立的 Runtime 选择器或配置区域。

ACP 供应商的创建、恢复和执行 SHALL 不以 ZCode 订阅状态、ZCode CLI 进程或 API 供应商配置为前提。用户可以只配置并使用 ACP 供应商；各 Agent 使用自身支持的 API 凭据或登录方式。CodeZ 不把一份通用 API 凭据自动注入不支持它的 ACP Agent。

#### Scenario: Multiple provider forms coexist

- **WHEN** 一个 API 供应商与一个 ACP 供应商均可用，用户通过同一个模型选择器依次创建两条会话
- **THEN** 两条会话可分别由不同执行适配器运行，列表和会话页显示所选供应商与模型

#### Scenario: Runtime unavailable

- **WHEN** 用户选择的 ACP 供应商对应 CLI 未安装、未认证或握手失败
- **THEN** 创建操作显示具体状态，既不发送给 ZCode CLI，也不生成假成功会话

### Requirement: Immutable session ownership

CodeZ SHALL 在新会话接纳首条输入之前持久化所选 providerId/modelId、执行适配器身份、工作区身份和原生会话 ID 映射；后续命令、事件、恢复和删除 SHALL 使用同一归属。旧任务缺失执行适配器身份时 SHALL 视为现有 ZCode CLI 任务。

#### Scenario: ACP task remains in the shared task list after restart

- **WHEN** CodeZ 重启并读取包含 ZCode CLI 与 ACP 会话的同一工作区任务索引
- **THEN** 两类会话都出现在现有侧栏、分组、置顶和归档视图中，ACP 会话仍由保存的 Runtime ID 恢复
- **AND** 历史第三方 CLI 导入行不会因这个读取规则重新混入当前任务列表

#### Scenario: Local Host log pipe closes

- **WHEN** 桌面 Local Host 的 stdout 或 stderr 日志管道断开，但窗口与 Host 的 IPC 仍可用
- **THEN** 日志写入的 EPIPE 不终止 Host，ACP 会话与配置请求继续由原 Host 处理

#### Scenario: Local Host exits unexpectedly

- **WHEN** 桌面 Local Host 意外退出且窗口仍然存在
- **THEN** 窗口有界重建 Host 与 renderer 服务连接，并从持久化任务与 ACP transcript 恢复会话视图；旧 Host 的未完成请求不得被当作成功结果；连续崩溃时停止自动重载并记录失败

#### Scenario: Selection changes after session creation

- **WHEN** 用户改变草稿模型选择后打开既有会话
- **THEN** 会话仍由创建时的执行适配器接收输入

#### Scenario: Workspace isolation

- **WHEN** 两个远程工作区路径相同但 workspaceIdentity 不同
- **THEN** Runtime 绑定、会话和任务列表不得串读

### Requirement: Explicit capability differences

CodeZ SHALL 依据 Runtime 已协商能力控制功能入口；缺少能力时显示不可用原因，不得把不支持的操作作为成功处理。

#### Scenario: Unsupported operation

- **WHEN** ACP Agent 不支持某个 ZCode 专属会话操作
- **THEN** 操作不可用或返回明确错误，原会话保持可继续使用

#### Scenario: ACP auxiliary conversation

- **WHEN** 用户在已有 ACP 会话中打开辅助对话，或带首条文本创建辅助对话
- **THEN** Host 使用同一 ACP Runtime 创建独立子会话，继承父会话的模型与思考等级，将父子任务绑定持久保存；首条文本仅发送给子会话，父会话可继续使用
- **AND** 重复创建命令返回同一子会话，重启后子会话仍按原 Agent 身份恢复；配置失效时历史仍可见且不改投其他 Runtime

#### Scenario: Desktop local attachments in ACP prompts

- **WHEN** 桌面用户向 ACP 会话发送本地图片或文件
- **THEN** Host 在发送前校验本地文件并限制大小，图片仅在 Agent 公布 image prompt 能力时作为图片块发送，普通文件作为 ACP 嵌入式 resource 发送；用户转录保留附件元信息但不保存附件正文或 base64 内容
- **AND** Agent 不支持图片、文件不可读取或附件引用不是 Host 本地绝对路径时保留输入草稿并显示具体错误，不向 Agent 发送部分输入

#### Scenario: Runtime-specific thinking control

- **WHEN** 当前 ACP Agent 公布了可设置的思考等级
- **THEN** 会话页仅显示该 Agent 当前提供的等级，并在设置成功后更新当前值

#### Scenario: Agent default thinking level

- **WHEN** 用户选择 ACP 模型但未显式选择思考等级
- **THEN** 输入框允许发送，Agent 保留自身默认等级；用户显式选择时才发送所选等级

#### Scenario: Permission choice from Agent

- **WHEN** ACP Agent 请求工具权限并提供多个选项
- **THEN** 会话页显示本次原生选项，用户选择后只返回对应 optionId，取消则返回 cancelled

### Requirement: Host-side ACP agent_servers registry

CodeZ SHALL 在实际执行 Host 读取 `~/.codez/v2/agent-servers.json` 的 `agent_servers`。自定义配置键是稳定 ACP ID，`name` 仅用于显示，`command` 是绝对可执行路径，`args` 是字符串数组。Host SHALL 分条严格校验并用 argv 启动；不得通过 shell 执行，不得因一项无效阻断其他有效项或 ZCode CLI。远程客户端不得用自身路径替代 Host 路径。

#### Scenario: Unknown configured Agent

- **WHEN** 用户为代码中未列出的 ACP CLI 增加合法配置，且 Host 握手成功
- **THEN** 该供应商出现在模型设置与现有模型选择器中，创建和恢复使用配置键绑定的同一 Agent

#### Scenario: Invalid entry

- **WHEN** 一项配置路径非绝对、文件不可执行或 args 不是字符串数组
- **THEN** 该项显示具体错误，其他有效供应商仍可使用

#### Scenario: Configuration removed or replaced

- **WHEN** 既有 ACP 会话的配置项被删除、不可执行，或同一 ID 指向不同 Agent
- **THEN** 历史仍可见，但会话不可继续；CodeZ 不改投 ZCode CLI 或另一 ACP Agent

配置注册表是新建 ACP 会话的唯一供应商入口。原内置 ACP ID 不再出现在添加页、模型选择器或新建入口；既有会话仍可按原绑定恢复，不得自动改投同名的新配置项。迁移到配置项时必须先验证 Agent 命令与原生 session 可恢复，再持久改写绑定和指纹。

### Requirement: Explicit ACP model sync and cached selection

CodeZ SHALL 在模型设置中通过用户手动同步请求 ACP Agent 公布的模型和各模型思考等级。用户切换模型启用状态时 SHALL 立即持久保存，失败时恢复原状态并显示错误，不要求再次点击保存。保存后的模型列表 SHALL 持久缓存并在输入框既有模型选择器中显示；打开设置、进入会话或重启 CodeZ 不得隐式重新请求 Agent 模型信息。只有下一次用户手动同步才刷新候选。配置命令或参数改变后，旧缓存不得用于新进程身份。

配置式 WorkBuddy 的安装状态 SHALL 根据用户配置命令的可执行权限判断；打开设置页和启动该 Agent 不执行应用签名、开发团队或 Bundle ID 验证。

CodeZ SHALL 在设置页与模型选择器中展示 Agent 模型说明中明确提供的免费、折扣或积分倍率，不推测实际价格、不补写或手工标记。不同 ID 的同名模型 SHALL 保持独立可选，并展示足以区分它们的 Agent 说明或 ID。模型设置 SHALL 沿用现有设置页的紧凑列表、排版和语义色。

#### Scenario: Sync, select and save

- **WHEN** 用户手动同步某 ACP 供应商并切换部分模型启用状态
- **THEN** 现有模型选择器只显示保存的模型；重启和重新打开设置仍使用缓存，直至再次手动同步

#### Scenario: Immediate save fails

- **WHEN** 用户切换模型启用状态但 Host 保存失败
- **THEN** 设置页恢复原选择并展示错误，不将未保存的状态呈现为已保存

#### Scenario: Agent advertises different models with the same name

- **WHEN** Agent 返回两个 ID 不同、显示名称相同的模型
- **THEN** 两项均可独立启用，并显示 Agent 提供的倍率或必要的 ID 供用户区分

#### Scenario: Agent omits pricing information

- **WHEN** Agent 的模型说明不含明确免费或折扣信息
- **THEN** 设置页与模型选择器不显示相应价格标识

### Requirement: Manage configured ACP providers in model settings

CodeZ SHALL 在现有供应商添加流程中选择 ACP 后直接展示自定义 ACP 配置表单，无需再次选择自定义卡片；表单的标题、返回和布局与 API 供应商添加页一致。已配置的 ACP 供应商 SHALL 可修改显示名称、绝对命令路径和字符串参数数组，稳定 ID SHALL 不可修改。保存失败 SHALL 保留编辑草稿并显示错误。

#### Scenario: Add a custom ACP provider

- **WHEN** 用户在添加供应商页选择 ACP 并提交合法配置
- **THEN** 直接进入配置表单，新供应商出现在现有供应商列表，表单与返回入口沿用同页 API 添加流程的样式

#### Scenario: Edit a configured ACP provider

- **WHEN** 用户修改已有自定义 ACP 供应商的名称、命令或参数并保存
- **THEN** Host 只更新该稳定 ID 对应的配置；命令或参数改变时旧模型缓存不用于新进程身份，旧会话仍按原身份校验

#### Scenario: Invalid edit

- **WHEN** 新命令不可执行、参数无效或配置文件无法安全更新
- **THEN** 原配置保持不变，设置页保留草稿并展示失败原因

### Requirement: Delete a configured ACP provider

CodeZ SHALL 在用户确认后从 Host 注册表移除指定的自定义 ACP 供应商，不删除其历史会话；删除后模型选择器不再提供该供应商。删除失败 SHALL 保留配置并显示错误。

#### Scenario: Confirmed deletion

- **WHEN** 用户确认删除一个自定义 ACP 供应商
- **THEN** 该配置从注册表和供应商列表消失，既有会话仍可见但不得改投其他 Agent

#### Scenario: Cancel or fail deletion

- **WHEN** 用户取消确认，或 Host 删除配置失败
- **THEN** 该供应商保持可用；失败时展示原因
