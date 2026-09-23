## ADDED Requirements

### Requirement: Manage configured ACP providers in model settings

CodeZ SHALL 在现有供应商添加流程中选择 ACP 后直接展示自定义 ACP 配置表单，无需再次选择自定义卡片；表单的标题、返回和布局与 API 供应商添加页一致。已配置的自定义 ACP 供应商 SHALL 可修改显示名称、绝对命令路径和字符串参数数组，稳定 ID SHALL 不可修改；内置 ACP 供应商 SHALL 不提供这些操作。保存失败 SHALL 保留编辑草稿并显示错误。

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

CodeZ SHALL 在用户确认后从 Host 注册表移除指定的自定义 ACP 供应商，不删除其历史会话；删除后模型选择器不再提供该供应商。删除失败 SHALL 保留配置并显示错误。内置 ACP 供应商 SHALL 不可删除。

#### Scenario: Confirmed deletion

- **WHEN** 用户确认删除一个自定义 ACP 供应商
- **THEN** 该配置从注册表和供应商列表消失，既有会话仍可见但不得改投其他 Agent

#### Scenario: Cancel or fail deletion

- **WHEN** 用户取消确认，或 Host 删除配置失败
- **THEN** 该供应商保持可用；失败时展示原因
