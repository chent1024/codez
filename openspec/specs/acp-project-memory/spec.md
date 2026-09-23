# acp-project-memory Specification

## Purpose
让 ACP Agent 在用户启用记忆时取得所属 CodeZ 工作区的项目记忆，同时保持现有记忆开关、隔离和内容边界。
## Requirements
### Requirement: Scoped memory delivery

CodeZ SHALL 使用与 ZCode CLI 相同的工作区身份键定位项目记忆；仅在记忆启用时读取该工作区的索引。传入 ACP 的记忆 SHALL 有长度限制、来源标识，并且不得出现在用户可见的真实输入行或日志中。

#### Scenario: Memory enabled

- **WHEN** 用户启用记忆且当前工作区存在 MEMORY.md
- **THEN** ACP Agent 在执行 prompt 时取得该工作区的有效索引、记忆目录路径和与当前 ZCode 一致的读写规则，并能按需访问相关文件

#### Scenario: Memory disabled

- **WHEN** 用户关闭记忆
- **THEN** ACP Agent 不取得 CodeZ 项目记忆内容或读取入口

#### Scenario: Memory enabled with no index

- **WHEN** 用户启用记忆但该工作区尚无 MEMORY.md
- **THEN** CodeZ 按现有模式准备记忆目录并传入目录与读写规则，不虚构索引内容

#### Scenario: Two remote workspaces share a path

- **WHEN** 两个远程工作区路径相同但身份不同
- **THEN** ACP Agent 只能取得当前身份对应的记忆

### Requirement: Memory does not alter conversation identity

记忆注入 SHALL 与真实用户消息分离；恢复会话时不得把同一份记忆重复写入用户转录，也不得通过记忆内容建立替代会话。本阶段 ACP 仅按当前 ZCode 工作区身份和开关注入项目记忆，不运行自动记忆提取。设置页 SHALL 明确展示这一差异，不能把只读索引注入称为完整记忆支持。

#### Scenario: Resume with memory

- **WHEN** 带记忆的 ACP 会话恢复并收到下一条用户输入
- **THEN** 转录中的用户输入只包含用户实际提交的内容，记忆仍按当前开关和工作区读取

### Requirement: Native memory isolation during the transition

对提供已验证关闭入口的 Agent，CodeZ SHALL 仅在启动该 ACP 进程时关闭其原生自动记忆，不修改 Agent 的全局配置；项目指令文件仍遵循 Agent 自身的正常加载规则。没有已验证关闭入口的 Agent SHALL 显示原生记忆状态未知，不得宣称完全关闭或单一记忆来源。

本阶段 ACP 自动提取暂不可用；CodeZ SHALL 不安排提取回合，也不以另写的 JSON 建议器宣称等价。设置页 SHALL 明确提示用户。未来启用时须单独验证与当前 ZCode 相同的调度条件、上下文截取、记忆 Agent 提示及有界文件工具写入规则，且提取失败不得改变主会话结果。

#### Scenario: Automatic extraction is unavailable

- **WHEN** 用户查看 ACP 供应商设置或完成 ACP 回合
- **THEN** 设置页说明项目记忆按开关注入、自动提取暂不可用，回合完成不触发后台提取

#### Scenario: Agent supports disabling native auto-memory

- **WHEN** CodeZ 启动该 Agent 的 ACP 进程
- **THEN** CodeZ 以进程局部配置关闭原生自动记忆，并继续按 CodeZ 记忆开关注入项目记忆

#### Scenario: Agent native memory switch is unknown

- **WHEN** Agent 没有经当前版本验证的关闭入口
- **THEN** CodeZ 不改写用户全局配置，且界面不把该 Agent 的记忆状态标为完全统一
