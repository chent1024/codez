# session-worktree-selection Specification

## Purpose

定义新会话输入框的本地工作位置选择，以及从选中 Git 分支创建独立工作树、在该目录中接纳首条输入和打开会话的行为。失败时保留源项目与草稿，防止重复执行首次输入。

## Requirements

### Requirement: Choose a local worktree for a new session

CodeZ SHALL 在现有新会话输入框上方、项目与分支控件之间显示简洁的工作位置菜单，提供“本地”和“新建本地工作树”。默认“本地”保持现有行为。只有可用的本地 Git 项目可以选择创建工作树。选择工作树时，分支控件 SHALL 只选择创建起点，不得切换源目录的分支。

#### Scenario: Default local conversation

- **WHEN** 用户未改变工作位置并提交首条输入
- **THEN** CodeZ 沿用原工作区会话创建路径，不创建 Git worktree

#### Scenario: Select a worktree starting branch

- **WHEN** 用户在本地 Git 项目草稿中选择新建本地工作树及起点分支
- **THEN** 项目和输入内容保持不变，源目录 HEAD 与工作文件保持不变；提交前不创建目录或会话

#### Scenario: Unsupported workspace

- **WHEN** 当前工作区为远程、非 Git 或 Git 不可用
- **THEN** 新建本地工作树不可选，原因可见，本地会话仍可提交

### Requirement: Start the first turn in the created worktree

CodeZ SHALL 在用户提交首条输入时，从选中分支的已提交 HEAD 创建 detached worktree，核验其路径、仓库和提交，再以该路径作为新会话工作区。首条输入 SHALL 最多接纳一次。源目录未提交内容 SHALL 保留在源目录，不自动复制到新工作树。

#### Scenario: Successful creation and first input

- **WHEN** 用户在工作树模式提交有效首条输入且 Git 创建成功
- **THEN** 新会话及其首轮命令使用工作树路径，CodeZ 导航到该会话，源目录分支和文件保持不变

#### Scenario: Creation fails before session admission

- **WHEN** Git 创建或核验失败
- **THEN** 不提交首条输入，不切换工作区，保留用户草稿并显示失败原因；重复点击不会并发创建多个工作树

#### Scenario: Source session references cannot move to a worktree

- **WHEN** 工作树模式首条输入含非本地文件的上传引用或会话上下文引用
- **THEN** CodeZ 在创建工作树前阻止提交并保留草稿；本地绝对路径文件附件可以随首条输入提交

#### Scenario: Session admission outcome is unknown

- **WHEN** 工作树已创建而会话命令的接纳结果未知
- **THEN** CodeZ 保留同一命令的恢复线索，不自动生成新命令重发首条输入或删除工作树
