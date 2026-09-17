# Context7 / Firecrawl 确认记录

> 子智能体遇到不确定的官方协议字段、SDK 调用、API 路径时，
> 必须用 Context7 MCP（优先）或 Firecrawl MCP 抓官方原文确认，
> 然后把结论追加到本文件。

> 模板：

```
## {YYYY-MM-DD} - {module} - {field/interface}

- 来源：{Context7|Firecrawl}：{libraryId 或 URL}
- 官方原文：{一段直接引用}
- 结论：{本项目用什么字段名/算法/endpoint}
- 影响文件：
  - {路径1}
  - {路径2}
  - 代码注释引用：在 {文件路径} 的 {函数名} 处加注释 `// see context7-record.md - {YYYY-MM-DD} - {module}`
```

---

<!-- 示例 -->
<!--
## {YYYY-MM-DD} - {module} - {field/interface}

- 来源：Context7：{libraryId}
- 官方原文：
  > {一段直接引用}
- 结论：{本项目用什么字段名/算法/endpoint}
- 影响文件：
  - {路径1}
-->

## 2026-09-17 - weixin-agent-sdk - login API

- 来源：developer 实测本地 node_modules
- 官方原文（实际导出，来自 weixin-agent-sdk@0.5.0）：
  - weixin-agent-sdk 实际导出：Bot, isLoggedIn, login, logout, start
- 结论：本项目应使用 weixin-agent-sdk 的 login(opts) 函数生成 QR / start() 启动 bot 长轮询；DEV_PLAN §A.3 中关于 @tencent-weixin/openclaw-weixin 暴露 startWeixinLoginWithQr 的描述与 npm 实际发布版本不符。
- 影响文件：
  - D:\github\wechat_downloads\scripts\test-login.mjs（需改用 weixin-agent-sdk）
  - 后续 task4（P3 二维码前端化）：/admin/qr 调用应改为 login({})；@tencent-weixin/openclaw-weixin 在本项目中不再用作 QR SDK，而是 OpenClaw 插件（可保留依赖不引用，或后续评估是否需要 openclaw host 才能 register）
