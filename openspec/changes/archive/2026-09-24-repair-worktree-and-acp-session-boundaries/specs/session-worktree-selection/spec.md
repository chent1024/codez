## MODIFIED Requirements

### Requirement: Start the first turn in the created worktree

CodeZ SHALL 在用户提交首条输入时，从选中分支的已提交 HEAD 创建 detached worktree，核验其路径、仓库和提交，再以该路径作为新会话运行目录。首条输入 SHALL 最多接纳一次。源目录未提交内容 SHALL 保留在源目录，不自动复制到新工作树。新会话的项目归属 SHALL 固定为提交时所选的源项目；任务运行路径、命令 cwd、Git 状态与文件操作 SHALL 使用工作树路径。项目列表 SHALL 将该会话显示在源项目下，并可识别其工作树运行目录。归档和删除工作树后仍 SHALL 保留会话的项目归属。既有可核验的 CodeZ 托管工作树会话 SHALL 归回对应源项目；归属无法核验时不得仅凭同名目录合并。

#### Scenario: Successful creation and first input

- **WHEN** 用户在工作树模式提交有效首条输入且 Git 创建成功
- **THEN** 新会话及其首轮命令使用工作树路径，CodeZ 导航到该会话并在源项目下展示，源目录分支和文件保持不变

#### Scenario: Creation fails before session admission

- **WHEN** Git 创建或核验失败
- **THEN** 不提交首条输入，不切换工作区，保留用户草稿并显示失败原因；重复点击不会并发创建多个工作树

#### Scenario: Source session references cannot move to a worktree

- **WHEN** 工作树模式首条输入含非本地文件的上传引用或会话上下文引用
- **THEN** CodeZ 在创建工作树前阻止提交并保留草稿；本地绝对路径文件附件可以随首条输入提交

#### Scenario: Session admission outcome is unknown

- **WHEN** 工作树已创建而会话命令的接纳结果未知
- **THEN** CodeZ 保留同一命令的恢复线索，不自动生成新命令重发首条输入或删除工作树

#### Scenario: Existing managed worktree session

- **WHEN** 用户打开创建于旧版本、且可核验源仓库的 CodeZ 托管工作树会话
- **THEN** 项目列表在源项目下显示该会话，继续以原工作树路径执行；归属不明的会话保留独立展示并显示真实路径

## ADDED Requirements

### Requirement: Refresh upstream before creating a worktree

CodeZ SHALL 提供“创建工作树前获取上游更新”设置。开启时，创建前获取所选本地分支的上游提交，在本地与上游可以快进时从包含两侧提交的较新提交创建 detached 工作树，不移动源分支。获取失败或双方分叉 SHALL 中止创建、保留草稿并说明原因。未配置上游时 SHALL 使用本地提交并明确展示。工作树仍存在时，会话 SHALL 显示实际创建提交和路径。

#### Scenario: Upstream advances

- **WHEN** 设置已开启，所选分支有上游且上游比本地领先
- **THEN** 新工作树从获取后的上游提交创建，源分支不移动；会话显示获取结果、提交和路径

#### Scenario: Upstream refresh fails

- **WHEN** 设置已开启，但获取失败或本地与上游分叉
- **THEN** 不创建工作树或会话，保留草稿并显示失败原因
