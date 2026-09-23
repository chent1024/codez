# codez-official-plugins Specification

## Purpose

确保 CodeZ 自己的发行包包含其官方内置插件所需的完整资源，让插件清单、启停状态和实际运行能力一致，且不依赖另一款应用的安装目录或用户数据。

## Requirements

### Requirement: Complete built-in plugin bundle

CodeZ 桌面发行包 SHALL 包含当前产品定义的所有内置插件的清单、技能及运行资源。打包可从本机已安装的官方应用或显式指定的插件资源目录读取缺失的构建输入；导入的插件文件 SHALL NOT 提交进源码仓库。打包时若任一必需资源缺失，构建 SHALL 失败，不得发布只显示部分插件的包。

#### Scenario: Fresh CodeZ installation

- **WHEN** 用户在未安装官方 ZCode 的机器上首次启动 CodeZ
- **THEN** CodeZ 插件页显示其发行包提供的完整内置插件列表，启用的插件可被运行时发现和使用

#### Scenario: Missing bundled resource

- **WHEN** 打包输入缺少一个声明为内置的插件的必需资源
- **THEN** 打包失败并指出缺失插件或资源，而非生成插件列表不完整的安装包

#### Scenario: Separate user data

- **WHEN** 同一机器同时安装 ZCode 与 CodeZ
- **THEN** CodeZ 从自身包与 `.codez` 插件数据加载，不读取或复制 `.zcode` 插件状态
