# 经验库（lessons-learned.md）

> 修正循环时由 developer 智能体自动追加。
> 三条原则：
> 1. 原则性 > 数值性：写"为什么错"而非"改了什么值"
> 2. 模式级 > 页面级：写"哪种模式容易犯这个错"
> 3. 可迁移 > 可复制：去掉具体数值和文件名后还能指导决策吗？

---

<!-- 经验条目示例 -->
<!-- - {YYYY-MM-DD HH.MM} [{role}] {原则性经验} -->
- 2026-09-17 22.26 [developer] DEV_PLAN.md 中第三方库的 API 描述必须以本地 node_modules 实测为准，不要照搬文档章节
- 2026-09-17 23.18 [developer] Node HTTP server 解析 URL 后必须 decodeURIComponent 含中文 path，否则浏览器/客户端自动 URL-encode 后服务端找不到文件
