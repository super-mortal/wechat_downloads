# WechatDownloads 开发计划

> 项目：wechat-downloads
> 创建时间：2026-09-17T22:14:58+08:00
> 由 super-agent 的 planner 智能体生成

## 项目信息

- 项目根目录：`D:\github\wechat_downloads`
- 运行批次：`wechat-downloads-2026-09-17--01`
- 批次目录：`D:\github\wechat_downloads\.super-agent\runs\wechat-downloads-2026-09-17--01`
- 错误码前缀：`WXD`
- 日志前缀：`wechat-downloads-`
- 命名风格：`wechat_downloads_` (snake) / `WechatDownloads` (pascal)
- 需求文档：`D:\github\wechat_downloads\DEV_PLAN.md`
- 端口：`3915`（沿用既有 server.mjs）

## 阶段任务表

| 任务 | 阶段 | 任务内容 | 状态 | 依赖 | 涉及需求文档章节 | 备注 |
|---|---|---|---|---|---|---|
| task1 | P0 | 公共基础设施（planner 完成） | ✅ | — | N/A | 本次完成；产出 plan 下 5 个文件 + 不写 main-log.md |
| task2 | P1 | 依赖接入 + 终端扫码跑通（weixin-agent-sdk + openclaw-weixin） | ✅ | — | §0、§A.2、§A.3、M1 | 主责：developer；安装 `weixin-agent-sdk@^0.5.0` 与 `@tencent-weixin/openclaw-weixin@^2.4.9`；终端调 `login()` 出 QR 即可 |
| task3 | P2 | domain.mjs 域名状态桥接（computePublicBaseUrl + record/getCached） | ✅ | task2 | §7、M2 | 主责：developer；domainMiddleware 已注入 |
| task4 | P3 | 二维码前端化（/admin/qr + admin.mjs + login()） | ✅ | task2 | §8、M3 | 主责：developer；前端纸墨风复用 server.mjs 的 CSS 变量 |
| task5 | P4 | storage.mjs 存储与索引（slug 规则、index.json 读写、Markdown/HTML 落盘） | ✅ | task2 | §9、M4 | 主责：developer；21 个测试全过；.gitignore 已追加 |
| task6 | P5 | agent.mjs + commands.mjs（斜杠命令 /help /all /count + URL 检测 + 只返 URL 回执） | ✅ | task3、task5 | §5、§6、M5 | 主责：developer；9 个测试全过；依赖 task3+task5 |
| task7 | P6 | HTTP 扩展（/wechat/download 列表页 + 单篇 *.html + index.json 静态） | ✅ | task5、task6 | §10、M6 | 主责：developer；中文 slug 解码修复；WXD-HTTP-0003 |
| task8 | P7 | 联调测试（扫码 → 发链接 → 落盘 → HTML 200 → /all → /count → /help 端到端） | ✅ | task4、task6、task7 | §5.3、§10、M7 | 主责：tester；16 项 e2e 全过（含 HTTP 5 + agent 7 + URL 3 + 错误码 1） |
| task9 | P8 | 部署文档（Nginx 反代模板 + 进程守护 + 任意域名部署说明） | ✅ | task7 | §7.4、M8 | 主责：developer；DEPLOY.md 248 行；8 项验收全过 |

**状态说明**：⏳ 待办 | 🔄 进行中 | ✅ 完成 | ⚠️ 低质量通过 | ❌ 阻塞

## 阶段详情

### P0 — 公共基础设施

- task1：初始化项目骨架
- 主责：planner
- 完成标准：
  - `plan/` 下 `dev-plan.md` / `dev-spec.md` / `requirements.md` / `lessons-learned.md` / `context7-record.md` 五份文件全部生成
  - `logs/main-log.md` 存在但由主智能体维护，本任务不写
  - `test-reports/` 目录已建（空）
- 完成时间：2026-09-17 22.14

### P1 — 依赖接入 + 终端扫码跑通

- 任务：
  - task2：依赖接入 + 终端扫码跑通
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - `package.json` 增加 `weixin-agent-sdk` 与 `@tencent-weixin/openclaw-weixin`
  - `npm install` 成功（依赖落 `node_modules/`，告知主智能体安装位置）
  - 临时脚本 `scripts/test-login.mjs`（不入仓，仅验证）能调出 SDK QR 图片（base64 或 URL），不需要真扫码
- 涉及需求文档章节：§0（关键名词）、§A.2（SDK 接口）、§A.3（QR API）、M1

### P2 — 域名状态桥接

- 任务：
  - task3：domain.mjs 域名状态桥接
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - 新增 `domain.mjs`，导出 `computePublicBaseUrl(req)` / `recordPublicBaseUrl(req)` / `getCachedPublicBaseUrl()`
  - `server.mjs` 注入中间件：每个请求先 `recordPublicBaseUrl(req)`
  - 三个优先级严格生效：`PUBLIC_BASE_URL` env > 缓存 > `127.0.0.1:3915` 兜底
  - 至少 3 个单测：env 优先、X-Forwarded-Host 命中、缓存兜底
- 涉及需求文档章节：§7、M2

### P3 — 二维码前端化

- 任务：
  - task4：二维码前端化
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - 新增 `admin.mjs`，导出 `startQrSession()` / `pollQrStatus(key)` 两个函数
  - 新增路由 `GET /admin` `GET /admin/qr` `POST /admin/qr/start` `GET /admin/qr/status`
  - 视图 `views/admin-qr.html`（纸墨风，沿用 server.mjs 的 `:root` 变量；不做多页面，只此一个）
  - 前端 JS 每 2 秒轮询 `status?session=`，状态文字按 `wait/scanned/confirmed/expired` 更新
- 涉及需求文档章节：§8、M3

### P4 — 存储与索引

- 任务：
  - task5：storage.mjs 存储与索引
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - 新增 `storage.mjs`，导出 `buildSlug(url, title)` / `findByUrl(url)` / `addEntry(entry)` / `readIndex()` / `writeMarkdown(slug, md)` / `writeHtml(slug, html)` / `mirrorIndexToPublic()`
  - slug 规则：`yyyy-mm-dd-title-kebab-hash6`；hash = `md5(originalUrl).slice(0,6)`
  - `data/index.json` 字段对齐 §9.2；`html_url` 用相对路径 `/wechat/download/<slug>.html`
  - `.gitignore` 追加：`data/md/`、`public/wechat/download/*.html`、`public/wechat/download/*.json`
  - 同一 URL 二次写入必须复用 slug（去重）
- 涉及需求文档章节：§9、M4

### P5 — agent + commands

- 任务：
  - task6：agent.mjs + commands.mjs
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - `commands.mjs` 严格按 §6.3 实现 `handleCommand(text, baseUrl)`；未知命令返回 `null`
  - `agent.mjs` 导出 `agent` 对象，符合 §A.2 `Agent` 接口 `{ chat(req): Promise<{text?}> }`
  - URL 正则：`/https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]+/`
  - 回执严格只返 URL 一行（成功 / 重复）；失败返「该文章无法访问，换一条试试」；非命令非 URL 返 §5.2 文案
  - 调用既有 `article.mjs#downloadArticle` 复用抓取能力，不重写
- 涉及需求文档章节：§5、§6、M5

### P6 — HTTP 列表页

- 任务：
  - task7：HTTP 扩展
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - 路由 `GET /wechat/download`（HTML 列表页） `GET /wechat/download/<slug>.html`（单篇） `GET /wechat/download/index.json`（数据）
  - 列表数据来源 `data/index.json`，按 `created_at` 倒序
  - 链接用相对路径，不出现绝对域名（任何部署域名都生效）
  - 视图 `views/list.html` 沿用纸墨风；不影响既有首页
- 涉及需求文档章节：§10、M6

### P7 — 联调测试

- 任务：
  - task8：端到端联调
- 主责：tester（不写代码）
- 完成标准：
  - 启动 `WECHAT_BOT=1 npm start`，本地 3915 端口起来
  - 浏览器打开 `/admin/qr` 拿到 QR（人工扫码，账号由用户提供即可，不强求测试 Agent 真扫）
  - 微信端发送样例链接 `https://mp.weixin.qq.com/s/FtWvOWI2kVVS_1sQiKNWbw`：
    - 回执仅为一行 URL `http(s)://<本机域名>/wechat/download/<slug>.html`
    - `data/md/<slug>.md` 文件存在
    - `public/wechat/download/<slug>.html` 200 OK
    - `data/index.json` 已写入该条
  - `/wechat/download` 列表页能看到这条
  - 发 `/all` 回列表页 URL 一行；发 `/count` 回 `已收录 N 篇`；发 `/help` 回帮助文本；发 `/unknown` 回未知命令文案
  - tester 必须截图 + 贴证据行号
- 涉及需求文档章节：§5.3、§10、M7

### P8 — 部署文档

- 任务：
  - task9：部署文档
- 主责：developer（写文档，不写自动化脚本）
- 完成标准：
  - 新增 `DEPLOY.md`，至少含：环境变量、`WECHAT_BOT=1 npm start`、pm2 守护片段、§7.4 Nginx 配置模板（直接抄，注意 `proxy_set_header X-Forwarded-Proto $scheme;` 与 `X-Forwarded-Host $host;` 关键两行）、任意域名部署说明（无需改代码）
  - 不强求部署成功（环境依赖用户服务器），但文档步骤必须可独立执行
- 涉及需求文档章节：§7.4、M8

## 备注

- 主智能体通过本表确定下一步任务
- 任务状态由主智能体更新（仅 Edit 单行替换，不允许 Write 整体覆盖）
- 一个任务最多执行 5 次 tester 测试，第 5 轮仍 FAIL 标记 ⚠️ 强制通过
- 依赖决定顺序与传递风险：上游未通过时下游仍可继续，但下游 prompt 必须告知依赖风险并要求 tester 额外验证集成假设
- P7 是端到端回归任务，**不写新代码**，只跑全链路 + 写测试报告；新功能一律回退到 P1~P6
- 安装依赖时 developer 必须告知主智能体安装位置（写入 main-log.md），符合用户偏好

















