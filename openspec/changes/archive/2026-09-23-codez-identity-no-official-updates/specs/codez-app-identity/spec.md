## MODIFIED Requirements

### Requirement: Distinct desktop identity

桌面应用 SHALL 显示名称 CodeZ，使用与现有 ZCode 标识反向的应用图标，并使用独立的安装身份、`codez://` 协议身份及系统显示身份。CodeZ SHALL NOT 注册 `zcode://` 协议。

#### Scenario: Side-by-side installation

- **WHEN** 用户已安装官方 ZCode 再安装 CodeZ
- **THEN** 两个应用各自出现在系统应用列表和 Dock/任务栏，互不覆盖；CodeZ 的链接由 CodeZ 接收，官方 `zcode://` 链接不被 CodeZ 接管

#### Scenario: Startup icon matches desktop identity

- **WHEN** CodeZ 展示 HTML 启动壳或 React 加载态
- **THEN** 启动画面使用与桌面应用图标同向的反向 Z 标识

#### Scenario: Local desktop bundle

- **WHEN** 开发者未指定后端环境运行标准桌面打包命令
- **THEN** 产物采用正式 CodeZ 身份和正式后端配置；显式选择测试环境时产物采用 Preview 身份

#### Scenario: Generated desktop links

- **WHEN** CodeZ 生成 OAuth 回调、会话分享导入或文件夹打开链接
- **THEN** 链接使用 `codez://` 并由 CodeZ 协议处理器接收

### Requirement: Distinct default data and workspace

CodeZ SHALL 默认使用 `~/.codez` 作为自身数据根目录，非项目会话默认工作目录 SHALL 位于 `~/.codez/workspace/default`。不得自动读取、移动或删除 `~/.zcode` 内容。

#### Scenario: First launch

- **WHEN** CodeZ 在尚无自身数据目录的用户设备上首次启动
- **THEN** 它使用 `~/.codez`，官方 ZCode 的 `~/.zcode` 保持不变

#### Scenario: Explicit custom base directory

- **WHEN** 用户显式设置 CodeZ 数据基目录
- **THEN** CodeZ 将自身数据根目录置于该基目录下的 `.codez`

#### Scenario: Settings persistence

- **WHEN** CodeZ 启动并读取或保存应用设置
- **THEN** 设置服务使用当前 CodeZ 数据基目录下的 `.codez/v2/setting.json`，不读取或写入官方 ZCode 的 `.zcode/v2/setting.json`

## ADDED Requirements

### Requirement: No official desktop app updates

CodeZ SHALL NOT 自动检查、下载或安装官方 ZCode 桌面应用更新，也 SHALL NOT 因官方远端最低版本阻止启动。CodeZ SHALL NOT 提供桌面应用在线更新的按钮、菜单或设置项；插件市场的目录刷新及插件更新不属于桌面应用更新。

#### Scenario: Startup with stale version and previous update preferences

- **WHEN** 已安装 CodeZ 启动，且本地保留此前启用的更新偏好或官方远端版本更高
- **THEN** 应用不请求官方桌面更新 feed，不下载更新，不出现升级门禁，并正常进入主界面

#### Scenario: Update controls

- **WHEN** 用户打开桌面主界面、帮助菜单和常规设置
- **THEN** 不显示桌面应用在线更新提示、手动检查项或自动下载安装选项
