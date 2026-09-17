# 需求摘要（requirements.md）

> 由 super-agent 的 planner 智能体生成
> 用途：每阶段的需求摘要 + 在原需求文档里的章节定位，主智能体通过此文件告诉子智能体"读 §X.Y"

## 阶段摘要

每个阶段一段，包含：阶段目标、可量化验收标准、需求文档章节定位。

### P0 — 公共基础设施

- 阶段目标：初始化项目骨架
- 验收标准：
  - `{run_root}/plan/` 下 5 个规划文件全部生成（`dev-plan.md` / `dev-spec.md` / `requirements.md` / `lessons-learned.md` / `context7-record.md`）
  - `{run_root}/logs/main-log.md` 存在，但本任务不写，由主智能体维护
  - `{run_root}/test-reports/` 空目录存在
- 需求文档章节：N/A
- 完成时间：2026-09-17 22.14

### P1 — 依赖接入 + 终端扫码跑通

- 阶段目标：把微信 ClawBot 双依赖装上，最小可调通 SDK 的 QR 登录入口
- 子任务：
  - task2：`npm install weixin-agent-sdk @tencent-weixin/openclaw-weixin`，跑 `login()` 出 QR
- 验收标准：
  - `package.json` 出现两个新依赖
  - 临时脚本 `scripts/test-login.mjs` 调 SDK 出 QR（base64 或 URL）成功，命令行窗口打印成功日志
  - developer 告知安装位置 `node_modules/weixin-agent-sdk/` 与 `node_modules/@tencent-weixin/openclaw-weixin/`
- 涉及需求文档章节：§0（关键名词表）、§A.2（weixin-agent-sdk 接口）、§A.3（openclaw-weixin QR API）、M1

### P2 — 域名状态桥接

- 阶段目标：让 agent 在脱离 HTTP 请求时也能拿到正确的部署域名
- 子任务：
  - task3：`domain.mjs` + 中间件 + 三个优先级
- 验收标准：
  - `domain.mjs` 三导出函数对齐 §7.1 / §7.2 实现
  - `server.mjs` 顶层注入中间件，**每个请求**都喂缓存
  - 单测覆盖：env 优先 / X-Forwarded-Host 命中 / 兜底 127.0.0.1
- 涉及需求文档章节：§7（含 §7.1~§7.4）、M2

### P3 — 二维码前端化

- 阶段目标：把 §A.3 的 QR 流程从终端搬到 `/admin/qr` 网页
- 子任务：
  - task4：admin.mjs + /admin/qr 页面 + 轮询
- 验收标准：
  - 路由 `GET /admin` `GET /admin/qr` `POST /admin/qr/start` `GET /admin/qr/status?session=` 全部 200
  - 视图纸墨风：`/admin/qr` 的 `:root` 变量与首页一致
  - 前端每 2 秒轮询，UI 在 `wait/scanned/confirmed/expired` 四态切换
- 涉及需求文档章节：§8（二维码前端流程）、M3

### P4 — 存储与索引

- 阶段目标：把抓下来的文章落盘 + 写索引，并保证同一 URL 二次复用 slug
- 子任务：
  - task5：`storage.mjs` + `.gitignore` 同步 + 目录建出来
- 验收标准：
  - `data/`、`data/md/`、`public/wechat/download/` 三个目录建好（首次启动时若不存在）
  - `data/index.json` 字段结构与 §9.2 一致；`html_url` 用相对路径
  - slug 规则严格：`<yyyy-mm-dd>-<title-kebab>-<hash6>`；同一 URL 二次写入复用旧 slug
  - `.gitignore` 追加 `data/md/`、`public/wechat/download/*.html`、`public/wechat/download/*.json`
- 涉及需求文档章节：§9（含 §9.1~§9.3）、M4

### P5 — agent + commands

- 阶段目标：把 SDK 的 `Agent` 接上 + 斜杠命令实现 + **只返 URL 回执**
- 子任务：
  - task6：`agent.mjs` + `commands.mjs`
- 验收标准：
  - `commands.mjs#handleCommand(text, baseUrl)` 严格按 §6.3 实现；未知命令返回 `null`
  - `agent.mjs` 导出 `agent = { chat(req): Promise<{text?}> }`，与 §A.2 接口一致
  - URL 正则 `/https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]+/`
  - 回执：成功 / 重复 → 一行 URL；抓取失败 → 「该文章无法访问，换一条试试」；非命令非 URL → 「请发 mp.weixin.qq.com/s/... 公众号链接，或 /help 看命令」
- 涉及需求文档章节：§5（数据流）、§6（命令表与分发）、M5

### P6 — HTTP 列表页

- 阶段目标：把已收录的文章以 HTML 列表 + 单篇 HTML 暴露出来
- 子任务：
  - task7：`/wechat/download` 系列路由 + 视图
- 验收标准：
  - 路由 `GET /wechat/download`（HTML 列表） `GET /wechat/download/<slug>.html`（单篇） `GET /wechat/download/index.json`
  - 列表按 `created_at` 倒序；HTML 内链接全部相对路径
  - 列表页样式沿用纸墨风
- 涉及需求文档章节：§10（含 §10.1~§10.3）、M6

### P7 — 联调测试（端到端）

- 阶段目标：把 P1~P6 拼起来跑通：扫码 → 发链接 → 落盘 → HTML 200 → 列表展示 → 命令回执
- 子任务：
  - task8：tester 主导，不写新代码
- 验收标准：
  - `WECHAT_BOT=1 npm start` 启动成功，本机 3915 端口起来
  - 浏览器 `/admin/qr` 出 QR；用户人工扫码
  - 微信端发样例 `https://mp.weixin.qq.com/s/FtWvOWI2kVVS_1sQiKNWbw`：
    - 回执仅为一行 URL
    - `data/md/<slug>.md` 存在
    - `public/wechat/download/<slug>.html` 200
    - `data/index.json` 写入
  - `/wechat/download` 列表能看到；`/all` `/count` `/help` 回执符合 §6.2
- 涉及需求文档章节：§5.3（回执示例）、§10（API 表）、M7

### P8 — 部署文档

- 阶段目标：让用户在自己服务器上能照着文档完成部署
- 子任务：
  - task9：`DEPLOY.md`
- 验收标准：
  - 文档含环境变量、`WECHAT_BOT=1 npm start`、pm2 片段、§7.4 Nginx 模板（含 `X-Forwarded-Proto` / `X-Forwarded-Host` 关键两行）
  - 任意域名部署无需改代码（环境变量或 Nginx 头）
- 涉及需求文档章节：§7.4（Nginx 配置）、M8

## 主智能体使用方式

主智能体在调度子智能体时，从本表查"涉及需求文档章节"字段，把它和必读文件路径一起传给子智能体。子智能体按章节定位读需求文档，**避免读全文污染上下文**。

## 完整需求文档路径

`D:\github\wechat_downloads\DEV_PLAN.md`（主智能体持有完整路径，不读全文）
