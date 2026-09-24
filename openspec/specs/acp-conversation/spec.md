# acp-conversation Specification

## Purpose

使 CodeZ 能作为 ACP v1 客户端运行外部 Agent CLI，并把会话事实可靠地呈现在现有桌面和远控界面。

## Requirements

### Requirement: ACP session lifecycle

CodeZ SHALL 通过标准输入输出与 ACP Agent 完成版本和能力协商，再创建或按能力恢复会话，发送 prompt，接收有序 update，并允许取消。原生 sessionId SHALL 与工作台 taskId 区分保存。Agent 返回失败结果时，CodeZ SHALL 记录失败终态并在会话中展示可读错误，不得以成功空白结束。

#### Scenario: Create and prompt

- **WHEN** 一个可用 ACP Agent 被选中并发送首条消息
- **THEN** CodeZ 完成 initialize、session/new、session/prompt，展示用户输入、增量回复和终态

#### Scenario: Resume after restart

- **WHEN** CodeZ 重启后打开一条 ACP 会话且 Agent 声明 loadSession
- **THEN** CodeZ 使用原生 sessionId 调用 session/load 并重建会话视图

#### Scenario: Resume unavailable

- **WHEN** Agent 未声明 loadSession 或 load 失败
- **THEN** CodeZ 保留既有会话身份并显示恢复失败，不暗中创建新原生会话

#### Scenario: ACP model request fails without assistant text

- **WHEN** Agent 以失败元数据或拒绝终态结束且未产生回复
- **THEN** 会话以失败状态收口并展示经过安全处理的错误，不标为成功或自动重发

### Requirement: ACP workbench title and live activity

CodeZ SHALL 在首条 ACP 输入被接纳时为仍使用默认标题的会话生成可见标题；Agent 随后的有效标题更新和用户手动标题 SHALL 保持权威。侧栏 SHALL 根据当前 Host 中 ACP 会话的实时执行状态显示运行标识，并在回合结束、进程退出或 Host 重启后收口，不把上次持久化的 `running` 当作当前仍在运行。

#### Scenario: Agent does not publish a title

- **WHEN** ACP Agent 接纳首条输入但始终没有发送 `session_info_update`
- **THEN** 会话标题由首条输入派生，侧栏和会话页显示相同标题

#### Scenario: ACP work continues in the background

- **WHEN** ACP 会话的 prompt 正在运行，用户离开该会话
- **THEN** 侧栏仍显示该会话的运行标识；终态到达后标识消失

#### Scenario: Restored task has stale running status

- **WHEN** Host 重启后任务索引仍记录上次 ACP 回合的 `running`
- **THEN** 侧栏不把该持久状态解释为实时运行

### Requirement: ACP plan progress attribution

CodeZ SHALL 按 ACP Agent 最后一次 `plan` 更新展示步骤和完成数。若回合已结束而最后一次计划仍有进行中步骤，工作台 SHALL 明确标出进度未由 Agent 更新，不得自行推断或宣称这些步骤已完成。新计划更新到来时 SHALL 清除旧提示并采用新状态。

#### Scenario: Final answer without final plan update

- **WHEN** ACP Agent 发出最终回复并结束回合，但最后一次计划仍有 `in_progress` 步骤
- **THEN** 进度保持 Agent 报告的完成数，并提示该计划未更新

### Requirement: Compact ACP tool summaries

CodeZ SHALL 将收起的 ACP 工具摘要限制为单行高度。长命令文本 SHALL 在该行内截断，展开后的工具详情仍 SHALL 保留完整内容。

#### Scenario: Long command in a collapsed tool row

- **WHEN** ACP Agent 报告一条长于会话列宽的命令，工具详情处于收起状态
- **THEN** 摘要仅占一行，后续思考和工具行按常规间距排列

### Requirement: Host callbacks and authorization

CodeZ SHALL 按已协商能力提供文件、终端和权限回调。文件路径 SHALL 按会话 cwd 和工作区身份校验；权限请求 SHALL 呈现给用户并把其实际选择返回 Agent。

权限 SHALL 以 Agent 本次 `session/request_permission` 给出的 `optionId` 为准，区分一次允许、持续允许、一次拒绝和持续拒绝；工作台自己的执行模式不得被解释为 ACP 授权。等待中的请求在取消、断线或进程退出时 SHALL 以 `cancelled` 收口，不自动允许。

#### Scenario: Permission denied

- **WHEN** 用户拒绝 ACP 工具权限
- **THEN** Agent 收到拒绝结果，CodeZ 不替用户执行该工具

#### Scenario: Untrusted file target

- **WHEN** ACP Agent 请求访问不属于其工作区的路径
- **THEN** Host 拒绝该请求并返回协议错误

#### Scenario: Permission request interrupted

- **WHEN** 用户尚未选择而会话被取消、断线或 Agent 退出
- **THEN** CodeZ 清理等待态并返回 `cancelled`，重连不会沿用旧选择

### Requirement: Thought level negotiation

CodeZ SHALL 从当前 ACP 会话返回的 `configOptions` 和后续 `config_option_update` 发现思考等级。`category=thought_level` 的 select 项为标准入口；对 Qoder 已验证的 `category=model` 且 `id=reasoning_effort` 项 SHALL 同样视为思考等级，而不列作模型。只有 Agent 实际公布了可选值，工作台才显示可操作控件；设置值 SHALL 经 `session/set_config_option` 被 Agent 接纳后更新。

ACP 模型选择也 SHALL 来自 Agent 公布的模型选项。对 Qoder，思考等级可能随所选模型变化；选择模型后 SHALL 重新读取并展示该模型实际提供的等级。用户 SHALL 能在草稿中发现并选择模型和思考等级，然后随首条任务创建正式会话；发现过程创建的临时 ACP 会话不作为工作台任务保存。会话恢复时 SHALL 重放已确认的模型和等级选择，不把默认模型的空等级集合解释为所有模型都不支持思考等级。

#### Scenario: Qoder model-scoped thought levels

- **WHEN** Qoder 默认模型未公布思考等级，用户在草稿中选择提供等级的模型
- **THEN** CodeZ 从该模型的 ACP 配置响应展示可用等级，并在首条 prompt 前应用用户选择的模型和等级

#### Scenario: Supported thought level

- **WHEN** 用户选择当前 Agent 公布的思考等级
- **THEN** CodeZ 使用该选项的原生 configId/value 设置，并按 Agent 响应刷新当前值和选项

#### Scenario: Unsupported or stale thought level

- **WHEN** Agent 没有思考等级选项，或切模型后原选择不再可用
- **THEN** CodeZ 禁用或拒绝该选择，并明确展示不支持/已变化，不假装设置成功

#### Scenario: Reasoning output without control

- **WHEN** Agent 发送 `agent_thought_chunk` 但未公布可设置的思考等级
- **THEN** CodeZ 仍展示思考内容，但不提供虚假的等级控制

### Requirement: Delivery and command safety

ACP 会话 SHALL 保持一次输入只有一个权威接纳者、命令幂等、事件有序、断线后可恢复；桌面连续流和手机可重放流 SHALL 分别符合其现有语义。

#### Scenario: Duplicate client command

- **WHEN** 同一 commandId 因重连再次送达
- **THEN** ACP Agent 不会重复执行同一 prompt

#### Scenario: Process exits during turn

- **WHEN** ACP 子进程在执行中退出
- **THEN** 当前轮以错误状态收口，用户看到错误，既不显示成功也不自动重发

### Requirement: ACP native session modes

CodeZ SHALL 在 ACP 新会话输入框提供 Agent 当前宣告的原生模式选项；只允许选择已宣告的模式 ID。首次提交 SHALL 在 prompt 前将选中模式发送给 Agent，确认生效后再接纳输入。Agent 未提供模式时 SHALL 显示不可设置的原因，不虚构内置 Agent 的权限选项。ACP 模式影响由 Agent 负责；CodeZ 的权限弹窗仍须逐次按原生 `optionId` 回传。CodeZ 不声明其模式可强制限制 Agent 自有工具的文件访问。

#### Scenario: Select a declared mode before first turn

- **WHEN** 用户选择 Agent 宣告的模式并提交首条输入
- **THEN** Agent 在首轮前确认该模式；会话展示实际模式

#### Scenario: Agent has no declared modes

- **WHEN** ACP Agent 未宣告任何会话模式
- **THEN** 输入框说明无法预先设置，首轮仍按 Agent 默认模式运行

#### Scenario: Selected mode is unavailable at creation

- **WHEN** 首轮创建的 Agent 未宣告草稿所选模式或拒绝切换
- **THEN** 不发送首条输入，保留错误和草稿，不改用其他权限模式默默执行

### Requirement: ACP reasoning segment lifecycle

CodeZ SHALL 在 ACP 思考 chunk 后的首个正文、工具或计划更新到来时完成当前思考段并固定其耗时；后续思考 chunk SHALL 创建新段。若无后续更新，当前段在整轮结束时收口。重放转录 SHALL 保持同样的段边界和计时结果。

#### Scenario: Thinking followed by tool use

- **WHEN** ACP Agent 输出思考后开始工具调用
- **THEN** 先前思考段停止显示运行计时，工具运行不延长其耗时

#### Scenario: Thinking resumes after a tool

- **WHEN** 工具调用后 Agent 再次输出思考
- **THEN** 创建新的思考段，旧段保持已完成及原耗时
