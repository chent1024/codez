# codez-app-identity Specification

## Purpose
让 CodeZ 与官方 ZCode 在桌面系统和本机数据上明确区分，使用户可以并排安装、分别启动两款应用，并使各自的默认工作区和设置互不覆盖。
## Requirements
### Requirement: Distinct desktop identity

桌面应用 SHALL 显示名称 CodeZ，使用与现有 ZCode 标识反向的应用图标，并使用独立的安装身份、协议身份及系统显示身份。

#### Scenario: Side-by-side installation

- **WHEN** 用户已安装官方 ZCode 再安装 CodeZ
- **THEN** 两个应用各自出现在系统应用列表和 Dock/任务栏，互不覆盖

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
