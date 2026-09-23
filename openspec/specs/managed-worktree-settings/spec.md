# managed-worktree-settings Specification

## Purpose

定义 CodeZ 托管工作树的根目录设置、发现、继续会话、安全手动移除及手动归档后的安全清理行为。定时或配额清理与创建前拉取上游不在本规范范围内。

## Requirements

### Requirement: Inspect CodeZ managed worktrees

CodeZ SHALL 在设置页提供 Worktrees 管理入口，展示托管目录并按源仓库列出当前可核验的托管工作树。列表 SHALL 只包含 CodeZ 自有目录中的 Git worktree，不把其他 Git worktree 当成托管对象。

托管目录默认为 CodeZ 数据根目录下的 `worktrees`；用户可在当前目录无托管工作树时设定新的绝对路径，留空恢复默认值。新工作树的容器目录 SHALL 以源仓库名加随机后缀命名，目录内保留归属标记和实际工作树。发现托管工作树 SHALL 依据归属标记与 Git 核验，不依赖目录名前缀。CodeZ SHALL NOT 定时或按配额清理旧工作树，也不在创建前自动拉取上游。

#### Scenario: Change worktree directory

- **WHEN** 当前目录无托管工作树，用户保存新的绝对路径
- **THEN** 后续创建和管理使用新目录；相对路径和当前目录仍有托管工作树的修改被拒绝

#### Scenario: List managed worktrees

- **WHEN** 用户打开 Worktrees 设置页或点击刷新
- **THEN** 页面显示可核验的托管工作树、路径和状态；目录为空时显示空状态

#### Scenario: Unknown directory

- **WHEN** 托管目录内存在非 CodeZ 工作树或 Git 信息损坏
- **THEN** CodeZ 不将其作为可删除的托管条目

### Requirement: Continue or remove a managed worktree

CodeZ SHALL 提供在现有工作树中新建会话的入口，以及经确认的手动移除入口。移除 SHALL 重新核验目标属于 CodeZ 托管目录、工作树无未提交、未跟踪或忽略文件且未锁定、容器无其他文件，并证明当前 HEAD 已推送到配置的上游远端分支。无法确定上游分支、远端不可达、远端分支不存在或远端提交与 HEAD 不一致时 SHALL 保留工作树。CodeZ SHALL 使用 Git 的普通 worktree remove，不强制丢弃用户数据。

#### Scenario: New conversation in a worktree

- **WHEN** 用户点击工作树的“新建会话”
- **THEN** 新草稿使用该工作树的本地路径，原仓库不被切换

#### Scenario: Remove a clean worktree

- **WHEN** 用户确认移除可核验、干净且当前提交与上游远端分支一致的托管工作树
- **THEN** Git 移除该工作树，页面刷新，其他工作树和源仓库保持不变

#### Scenario: Refuse unsafe removal

- **WHEN** 工作树是 detached HEAD、缺少上游、远端不可达、上游指向其他提交，或存在未提交、未跟踪、忽略文件及锁定状态
- **THEN** 移除失败且原因可见，目标文件、提交和 Git 注册保持不变

#### Scenario: Refuse a non-managed worktree

- **WHEN** 目标不属于托管目录或 Git 归属无法核验
- **THEN** 移除失败且目标文件与 Git 注册保持不变

### Requirement: Clean up a managed worktree when its conversation is manually archived

CodeZ SHALL 在手动归档会话的权威服务入口完成归档后，尝试清理该会话所在的 CodeZ 托管工作树。只有该工作树关联的全部未删除会话都已归档且处于终态，并且工作树满足同一安全移除条件时 SHALL 删除。清理不满足条件或失败时 SHALL 保留工作树和已完成的会话归档，记录原因以供诊断，不自动重试。非托管、本地普通和远程工作区 SHALL 不触发删除。后台旧任务自动归档 SHALL 不触发清理。

#### Scenario: Archive the last completed conversation in a published worktree

- **WHEN** 用户归档一个已完成会话，且其工作树中全部其他会话已归档并终止，工作树安全且当前 HEAD 已推送
- **THEN** 会话进入归档列表，工作树及其托管容器被移除，源仓库和会话记录保留

#### Scenario: Archive while cleanup is unsafe

- **WHEN** 用户归档托管工作树中的会话，但任一其他会话仍未归档或运行中，或者 Git 安全条件未满足
- **THEN** 会话归档成功，工作树保留，已有文件与提交不变

#### Scenario: Archive outside a managed worktree

- **WHEN** 用户归档普通本地或远程工作区会话
- **THEN** 只更新会话归档状态，不执行工作树删除或远端查询

#### Scenario: Background archive

- **WHEN** 旧任务自动归档功能归档会话
- **THEN** 只更新归档状态，不删除工作树
