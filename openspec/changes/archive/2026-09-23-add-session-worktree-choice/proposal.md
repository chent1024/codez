## Why

CodeZ 的新会话输入框目前只能在选中的项目目录工作。用户需要在同一输入框上方选择本地目录或独立 Git worktree，让新会话的改动不影响原 checkout。

## What Changes

- 在现有项目与分支控件之间加入紧凑的“本地 / 新建本地工作树”菜单，沿用输入框现有视觉样式。
- 选择工作树时，右侧分支控件改为选择创建起点，不切换原目录分支；提交首条输入时创建工作树并在其中开始会话。
- 创建失败保留草稿和原工作区；非本地 Git 项目不提供创建入口。

## Capabilities

### New Capabilities

- `session-worktree-selection`: 新会话工作位置选择、工作树创建、失败与会话归属。

### Modified Capabilities

无。

## Impact

影响输入框草稿头部、首条输入提交、Git 服务与工作区导航。新增工作树位于 CodeZ 自身数据根目录；不增加设置页、自动清理、移交或永久工作树管理。
