## Implementation

- [x] 保存 ACP Agent 确认的模式并在历史会话恢复时重放。
- [x] 在已有会话输入框接入模式切换命令与失败提示。
- [x] 覆盖配置选项模式、旧记录、模式消失、持久化失败和 Agent 主动更新。

## Verification

- [x] 运行 ACP 定向测试、typecheck、lint、架构检查并执行一次 rv。
- [x] 验证持久化失败不会显示成功终态或允许后续输入。
- [ ] 真实桌面 UI 与第三方 ACP Agent 的交互验收；当前环境未取得可安全测试的目标 Agent 会话。
