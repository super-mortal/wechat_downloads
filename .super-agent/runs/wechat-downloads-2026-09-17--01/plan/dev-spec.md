# WechatDownloads 编码规范

> 由 super-agent 的 planner 智能体生成
> 适用项目：wechat-downloads

## 命名规范

- 所有项目相关标识符统一以 `wechat_downloads_` (snake) / `WechatDownloads` (pascal) / `wechat-downloads-` (kebab) 开头
- 文件名：Node ESM 模块统一 `.mjs` 后缀（如 `agent.mjs`、`commands.mjs`、`storage.mjs`）
- 数据库 / JSON 文件：本项目无数据库；JSON 索引文件 `data/index.json` 与 `public/wechat/download/index.json`
- 错误码：`WXD-XXX-NNNN`
- 日志前缀：`wechat-downloads-`
- localStorage / Redis namespace：本项目无前端持久化与缓存服务，同步跳过

## 错误码规范

### 格式

```
WXD-{MODULE}-{NNNN}
```

- MODULE：模块代码，2~6 个大写字母
- NNNN：4 位数字，从 0001 开始

### 默认模块

| 模块 | 含义 |
|---|---|
| AUTH | 认证 / 扫码登录 |
| CFG  | 配置 / 环境变量 |
| SYS  | 系统兜底 |
| EXT  | 跨用户 / 越权（本项目单人自部署，原则上不会出现，但保留以防误用） |

### 项目自定义模块

| 模块 | 含义 | 对应文件 |
|---|---|---|
| DOMAIN | 域名解析与缓存 | `domain.mjs` |
| STORAGE | 索引、slug、落盘 | `storage.mjs` |
| BOT    | 微信 bot / Agent 调度 | `agent.mjs` |
| CMD    | 斜杠命令分发 | `commands.mjs` |
| HTTP   | HTTP 路由 / 视图 | `server.mjs`、`views/*.html` |
| ADMIN  | 管理面板 / 二维码 | `admin.mjs`、`/admin/*` |
| FETCH  | 文章抓取复用既有 | `article.mjs` |
| NET    | 外部网络 / SDK 调用失败 | SDK 调用处 |

### 错误响应结构

```json
{
  "error_code": "WXD-DOMAIN-0001",
  "message": "用户可读的简短描述",
  "stage": "代码位置（如 domain.computePublicBaseUrl）",
  "request_id": "UUID",
  "details": {}
}
```

### 错误码登记

| 错误码 | 模块 | HTTP | 含义 | 抛出位置 |
|---|---|---|---|---|
| WXD-HTTP-0003 | http | 400 | URL 路径解码失败 | server.mjs#/wechat/download/<slug>.html |
| WXD-HTTP-0002 | http | 404 | /wechat/download/<slug>.html 文件不存在 | server.mjs#wechat/download |
| WXD-AUTH-0001 | auth | 401 | startWeixinLoginWithQr 返回非 QR 数据 | admin.mjs#startQrSession |
| WXD-AUTH-0002 | auth | 401 | waitForWeixinLogin timeout（>300s） | admin.mjs#pollQrStatus |
| WXD-CFG-0001  | cfg  | 500 | 关键环境变量缺失 | server.mjs 启动钩子 |
| WXD-DOMAIN-0001 | domain | 500 | X-Forwarded-Host 多值取首失败 | domain.mjs#computePublicBaseUrl |
| WXD-DOMAIN-0002 | domain | 500 | 缓存读不到且无 env（理论上不会触发，因为兜底 127.0.0.1） | domain.mjs#getCachedPublicBaseUrl |
| WXD-STORAGE-0001 | storage | 500 | 读 / 写 `data/index.json` 失败 | storage.mjs#readIndex / writeIndex |
| WXD-STORAGE-0002 | storage | 500 | slug 冲突且 MD5 不一致 | storage.mjs#addEntry |
| WXD-STORAGE-0003 | storage | 500 | Markdown / HTML 写盘失败 | storage.mjs#writeMarkdown / writeHtml |
| WXD-BOT-0001    | bot | — | Agent.chat 返回值缺 text | agent.mjs#chat |
| WXD-CMD-0001    | cmd | — | 命令命中但 baseUrl 拿不到（兜底已给 127.0.0.1；理论上不应触发） | commands.mjs#handleCommand |
| WXD-HTTP-0001   | http | 400 | POST /download 缺 urls / formats（既有） | server.mjs |
| WXD-ADMIN-0001  | admin | 404 | /admin/qr/status 的 session 不存在 / 过期 | admin.mjs |
| WXD-ADMIN-0002  | admin | 500 | admin 子进程崩溃 | admin.mjs |
| WXD-NET-0001    | net  | 502 | article.mjs.downloadArticle 抓取失败（含重试 1 次后） | agent.mjs#downloadAndReply |
| WXD-NET-0002    | net  | 502 | weixin-agent-sdk 长轮询断开 | server.mjs 启动钩子 |
| WXD-SYS-0001    | sys  | 500 | 未捕获异常兜底 | server.mjs 顶层 catch |

> 错误码登记在 `dev-spec.md` 维护；新增时由 developer 调用 `register_error_code.py` 追加，禁止手工编辑本表。
> tester 在断言错误响应或异常路径时必须断言 `error_code` 出现在本表中。

## 日志格式

- 时间格式：`YYYY-MM-DD HH.MM`（北京时间）
- 时间来源：必须运行 `python "C:\Users\mortal\.codex\skills\super-agent\scripts\now.py"`，禁止自行推算
- 主智能体日志路径：`D:\github\wechat_downloads\.super-agent\runs\wechat-downloads-2026-09-17--01\logs\main-log.md`
- 每行一条，以 `- {YYYY-MM-DD HH.MM} {事件}` 开头
- 必含字段：阶段、文件路径、行号（如适用）、错误码（如适用）
- 安装依赖场景：developer 写 `- {ts} 依赖安装完成 | {包名}@{版本} | node_modules/{包名}/` 由主智能体转述给用户（用户偏好：「每次安装了什么依赖的时候，完成后需要告诉我安装位置」）

## 加密规范

本项目**无独立密钥**：

- 微信 ClawBot 的媒体加解密由 `weixin-agent-sdk` 内部 AES-128-ECB 处理，不在应用层再做
- 不存用户密码 / Token / Cookie
- `PUBLIC_BASE_URL` 等环境变量以明文落 `.env`，不入仓

## 数据库规范

- 本项目无数据库
- 索引存储采用 JSON 文件（`data/index.json`），并发写入由 Node 单进程串行处理（无需锁）
- 若后续引入 SQLite，迁移用 `node-pg-migrate` 或 `drizzle-kit`，所有查询必须带 `user_id` 过滤（本项目为单人，可省略）

## API 设计规范

- 路由风格：纯 HTTP（无 `/api/` 前缀，沿用既有 server.mjs 风格）
- 错误响应统一结构（见上）
- 鉴权：管理后台 `WECHAT_BOT=1` 启动即开放 `/admin/*`（单人自部署，无密码）
- 微信 bot 端：用户身份即微信扫码的微信号本身；不应用层校验

## 前端规范

- 框架：原生 HTML + 极少量 vanilla JS（沿用既有 server.mjs，无构建）
- 样式：纸墨风（`--paper:#FDFBF7`、`--ink:#1A1A1A`、思源宋体）；CSS 变量集中在 `:root`，新页面必须复用
- 状态管理：无（仅单页面轮询）
- 错误展示：管理面板状态文字需映射 `error_code` 显示

## 测试规范

- 后端：vitest 或 node:test（推荐 `node:test`，无需额外依赖）
- 前端：人工浏览 + 截图；列表页用 curl 验证 HTML 输出
- 错误码断言：测试报告中所有错误响应或异常路径必须贴 `error_code`
- 证据保留：测试报告必须贴文件路径 + 行号；视觉测试必须截图（PNG，存放在测试报告同目录 `test-reports/_screenshots/`）

## Code Style

- 格式化：沿用既有 `server.mjs` / `article.mjs` 的 2 空格缩进 + 分号风格；新模块统一同上
- Lint：暂不强制 ESLint（项目无构建）；关键模块由 tester 在审阅时检查
- Type hints：本项目为纯 JS，无 TS；复杂接口（如 `Agent.chat`）用 JSDoc 注释约束

## 红线（绝对禁止）

- ❌ "操作失败，请稍后重试"这类无错误码的宽泛文案
- ❌ 前端统一显示错误信息
- ❌ 在 import 时读取密钥或模型（本项目无）
- ❌ 直接抛未编码的异常 / 错误对象，必须用错误码常量
- ❌ 修改 `references/` 任何只读参考（本项目无）
- ❌ 在测试报告里"修改代码"
- ❌ 输出推测的字段名或协议字段（如 SDK 的字段名必须先查 Context7 再写）
- ❌ 把变更内容写进子智能体返回文本
- ❌ 微信回执带标题 / 本地路径 / emoji（必须**只有 URL 一行**）
- ❌ 在 `index.json` 写绝对域名（必须用相对路径 `/wechat/download/<slug>.html`）
- ❌ 把 `WECHAT_BOT=1` 默认开启（默认仅 HTTP）

## 项目核心约束（用户偏好）

- 安装依赖后 developer 必须告知主智能体安装位置（`node_modules/{包名}/` 绝对路径），由主智能体转述给用户
- 临时笔记 / 草稿只放 `D:\big-note\note-temp`，中文命名 markdown；脚本不进此目录
- 不在临时笔记里塞业务代码
- 只有用户明确说"做笔记"才记笔记，否则不主动写

## 核心约束提醒（给子智能体）

- planner / developer / tester 一律不得修改 `references/` 与项目既有模块的非任务相关代码
- developer 修改文件后只回报"修改文件路径 + 一行变更摘要 + 新增依赖"，不贴代码
- tester 仅写 `{run_root}/test-reports/{taskN}-{pN}-{module}-test-report.md`，不得修改业务代码
- 主智能体通过本 `dev-spec.md` 维护错误码登记，developer 必须用脚本登记
