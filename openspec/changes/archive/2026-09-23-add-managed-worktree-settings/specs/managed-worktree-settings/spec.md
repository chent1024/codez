## ADDED Requirements

### Requirement: Inspect CodeZ managed worktrees

CodeZ SHALL 在设置页提供 Worktrees 管理入口，展示托管目录并按源仓库列出当前可核验的托管工作树。列表 SHALL 只包含 CodeZ 自有目录中的 Git worktree，不把其他 Git worktree 当成托管对象。

托管目录默认为 CodeZ 数据根目录下的 `worktrees`；用户可在当前目录无托管工作树时设定新的绝对路径，留空恢复默认值。CodeZ SHALL NOT 自动清理旧工作树或在创建前自动拉取上游。

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

CodeZ SHALL 提供在现有工作树中新建会话的入口，以及经确认的手动移除入口。移除 SHALL 重新核验目标、拒绝未提交、未跟踪或忽略文件、锁定、托管容器内的其他文件及当前窗口打开的工作树，并使用 Git 的普通 worktree remove，不强制丢弃用户数据。

#### Scenario: New conversation in a worktree

- **WHEN** 用户点击工作树的“新建会话”
- **THEN** 新草稿使用该工作树的本地路径，原仓库不被切换

#### Scenario: Remove a clean worktree

- **WHEN** 用户确认移除可核验且干净的托管工作树
- **THEN** Git 移除该工作树，页面刷新，其他工作树和源仓库保持不变

#### Scenario: Refuse unsafe removal

- **WHEN** 目标不属于托管目录、存在未提交更改、被锁定或 Git 归属无法核验
- **THEN** 移除失败且原因可见，目标文件与 Git 注册保持不变
