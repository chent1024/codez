## Why

新会话现在可以创建 CodeZ 托管的 Git worktree，但用户缺少查看、继续使用和安全移除这些目录的入口。

## What Changes

- 设置页增加 Worktrees 分区，按原仓库列出 CodeZ 托管的工作树及其路径、Git 状态。
- 每个工作树可在同一路径新建会话；手动移除前确认，并拒绝存在未提交更改、Git 锁或不属于 CodeZ 托管目录的目标。
- 提供可设置的托管目录与刷新入口；目录留空使用 CodeZ 默认位置。本次不启用自动清理和创建前拉取上游。

## Capabilities

### New Capabilities

- `managed-worktree-settings`: 托管工作树的发现、继续使用与安全移除。

### Modified Capabilities

无。

## Impact

影响 Git 服务接口、设置页导航和新会话入口；不改变已有会话运行态与远程工作区。
