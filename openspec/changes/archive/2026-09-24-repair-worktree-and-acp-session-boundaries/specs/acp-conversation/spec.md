## MODIFIED Requirements

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

## ADDED Requirements

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
