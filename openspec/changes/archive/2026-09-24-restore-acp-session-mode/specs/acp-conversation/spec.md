## ADDED Requirements

### Requirement: Restore confirmed ACP session mode

CodeZ SHALL 将 ACP Agent 已确认的会话模式 ID 保存在该 task 的任务索引中，作为该会话的模式恢复意图。用户 SHALL 能在已有 ACP 会话的输入框切换 Agent 当前宣告的模式；只有 Agent 确认切换后才更新任务索引和界面。重新打开会话时，ACP Runtime SHALL 在接受新输入前，将已保存的模式重新应用到原生 session，并以 Agent 确认的模式展示界面；包括允许 Agent 自有工具跳过逐次询问的模式。恢复失败时 SHALL 保留原有模式记录并阻止本次会话继续输入，不得显示为已生效或静默使用 Agent 默认模式。没有已保存模式的旧会话 SHALL 采用 Agent 本次报告的当前模式，不从历史文本或模式名称推断旧选择；用户手动切换一次后开始保存。Agent 后续主动报告的模式变化 SHALL 成为新的已确认模式。

#### Scenario: Reopen a task with a confirmed mode

- **WHEN** 已有 ACP 会话保存了 Agent 确认的模式，且 `session/load` 返回了不同的当前模式
- **THEN** CodeZ 在允许继续输入前重放已保存的模式，并展示重放后的实际模式

#### Scenario: Reopen a task whose saved mode is no longer available

- **WHEN** Agent 不再提供已保存的模式，或拒绝切换
- **THEN** 会话显示恢复失败，保留已保存模式，不发送新的 prompt

#### Scenario: Switch mode in a historical task

- **WHEN** 用户在空闲的历史 ACP 会话选择 Agent 宣告的另一模式
- **THEN** CodeZ 等待 Agent 确认后更新显示和任务索引；失败时保持原模式

#### Scenario: Legacy task has no saved mode

- **WHEN** 旧 ACP 任务没有保存模式 ID
- **THEN** CodeZ 展示 Agent 当前报告的模式，不猜测过去是否选择过绕过权限模式
