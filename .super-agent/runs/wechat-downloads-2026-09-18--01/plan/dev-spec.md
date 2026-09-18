# WechatDownloads 编码规范（02 批次：鉴权 + 控制台拆分）

> 由 super-agent 的 planner 智能体生成
> 适用项目：wechat-downloads
> 在 01 批次基础上扩展（新增 AUTH 模块错误码登记 + 数据持久化约束 + UI 规范）

## 命名规范

- 所有项目相关标识符统一以 `wechat_downloads_` (snake) / `WechatDownloads` (pascal) / `wechat-downloads-` (kebab) 开头
- 文件名：Node ESM 模块统一 `.mjs` 后缀（如 `auth.mjs` `agent.mjs` `commands.mjs` `storage.mjs`）
- 数据库 / JSON 文件：本项目无数据库；JSON 文件 `data/index.json`、`data/auth.json`、`data/sessions.json`、`public/wechat/download/index.json`
- 错误码：`WXD-{MODULE}-{NNNN}`（MODULE 2~6 个大写字母，NNNN 4 位数字）
- 日志前缀：`wechat-downloads-`
- localStorage / Cookie / Redis namespace：
  - Cookie 名固定 `wxd_sid`（避免暴露业务）；属性 `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
  - 本项目无前端持久化与缓存服务，同步跳过

## 错误码规范

### 格式

```
WXD-{MODULE}-{NNNN}
```

- MODULE：模块代码，2~6 个大写字母
- NNNN：4 位数字，从 0001 开始

### 默认模块（沿用 01 批次 + 本批次新增）

| 模块 | 含义 | 备注 |
|---|---|---|
| AUTH | 认证 / 授权 / session | **本批次主战场** |
| CFG  | 配置 / 环境变量 | 01 批次 |
| SYS  | 系统兜底 | 01 批次 |
| EXT  | 跨用户 / 越权 | 01 批次（保留，单人项目暂不用） |

### 项目自定义模块（沿用 01 批次）

| 模块 | 含义 | 对应文件 |
|---|---|---|
| DOMAIN | 域名解析与缓存 | `domain.mjs` |
| STORAGE | 索引、slug、落盘 | `storage.mjs` |
| BOT    | 微信 bot / Agent 调度 | `agent.mjs` |
| CMD    | 斜杠命令分发 | `commands.mjs` |
| HTTP   | HTTP 路由 / 视图 | `server.mjs`、`views/*.html` |
| ADMIN  | 管理面板 / 二维码 | `admin.mjs`、`/admin/qr*` |
| FETCH  | 文章抓取复用既有 | `article.mjs` |
| NET    | 外部网络 / SDK 调用失败 | SDK 调用处 |

### 错误响应结构

```json
{
  "error_code": "WXD-AUTH-0001",
  "message": "用户可读的简短描述",
  "stage": "代码位置（如 auth.mjs#verify）",
  "request_id": "UUID",
  "details": {}
}
```

### 错误码登记

02 批次新增 AUTH 模块 6 条（auth.mjs 鉴权子系统），由 `register_error_code.py` 追加登记，禁止手工编辑本表。

| 错误码 | 模块 | HTTP | 含义 | 抛出位置 |
|---|---|---|---|---|
| WXD-SYS-0003 | sys | 500 | 备份配置读写失败 | backup-config.mjs#writeConfigToDisk |
| WXD-SYS-0002 | sys | 500 | 自动备份调度失败（备份写入异常） | backup-config.mjs#runBackupNow |
| WXD-SYS-0001 | sys | 500 | Chromium 不可执行（首次启动预检失败） | engine.mjs#openBrowser |
| WXD-BOT-0001 | bot | 503 | 服务未以 WECHAT_BOT=1 启动，无法扫码绑定 | admin.mjs#startQrSession |
| WXD-HTTP-0005 | http | 400 | POST /download URL 域名非白名单（非 mp.weixin.qq.com） | server.mjs#/download |
| WXD-HTTP-0004 | http | 401 | POST /download 未登录（需要先登录管理后台） | server.mjs#/download |
| WXD-STORAGE-0006 | storage | 500 | atomic rename 失败（磁盘满 / 权限不足） | auth.mjs#atomicWriteJson / storage.mjs#atomicWriteFile |
| WXD-STORAGE-0005 | storage | 500 | 备份文件不存在或损坏 | storage.mjs#restoreDataDir |
| WXD-STORAGE-0004 | storage | 500 | data 目录不可写（备份/恢复失败） | storage.mjs#backupDataDir |
| WXD-AUTH-0014 | auth | 401 | 环境 ADMIN_PASSWORD 与 user 输入不一致 | auth.mjs#verify |
| WXD-AUTH-0013 | auth | 401 | 改密时 session 已失效（要求重登） | server.mjs#/api/admin/password |
| WXD-AUTH-0012 | auth | 302 | 未登录访问受保护路径（→ 跳转 login） | auth.mjs#requireAuth |
| WXD-AUTH-0011 | auth | 302 | login 时 auth 未初始化（→ 跳转 setup） | server.mjs#/admin/login |
| WXD-AUTH-0010 | auth | 302 | setup 已初始化但又访问 /admin/setup | server.mjs#/admin/setup GET |
| WXD-AUTH-0009 | auth | 400 | setup 两次密码不一致 | server.mjs#/admin/setup POST |
| WXD-AUTH-0008 | auth | 400 | 新密码强度不足（长度 < 8） | auth.mjs#changePassword |
| WXD-AUTH-0007 | auth | 401 | 旧密码错误（changePassword 拒绝） | auth.mjs#changePassword |
| WXD-AUTH-0006 | auth | 500 | auth.json 损坏或解析失败 | auth.mjs#isInitialized |
| WXD-AUTH-0005 | auth | 302 | 未初始化访问受保护路由（→ /admin/setup） | auth.mjs#requireAuth |
| WXD-AUTH-0004 | auth | 401 | session 失效或不存在 | auth.mjs#requireAuth |
| WXD-AUTH-0003 | auth | 401 | 用户名或密码错误 | auth.mjs#verify |
| WXD-AUTH-0001 | auth | 401 | startWeixinLoginWithQr 返回非 QR 数据（从 01 批次延续） | admin.mjs#startQrSession |
| WXD-AUTH-0002 | auth | 401 | waitForWeixinLogin timeout（>300s）（从 01 批次延续） | admin.mjs#pollQrStatus |

> 01 批次已登记的 18 条错误码（WXD-HTTP-0001~0003、WXD-AUTH-0001~0002、WXD-CFG-0001、WXD-DOMAIN-0001~0002、WXD-STORAGE-0001~0003、WXD-BOT-0001、WXD-CMD-0001、WXD-ADMIN-0001~0002、WXD-NET-0001~0002、WXD-SYS-0001）继续保留；02 批次不迁移 01 批次的 AUTH 编号，直接从 0003 起新增。
>
> 02 批次新增的 6 条 AUTH 错误码（auth.mjs 鉴权子系统）由 `register_error_code.py` 追加登记，禁止手工编辑本表。
> tester 在断言错误响应或异常路径时必须断言 `error_code` 出现在本表中。

## 日志格式

- 时间格式：`YYYY-MM-DD HH.MM`（北京时间）
- 时间来源：必须运行 `python "C:\Users\mortal\.codex\skills\super-agent\scripts\now.py"`，禁止自行推算
- 主智能体日志路径：`D:\github\wechat_downloads\.super-agent\runs\wechat-downloads-2026-09-18--01\logs\main-log.md`
- 每行一条，以 `- {YYYY-MM-DD HH.MM} {事件}` 开头
- 必含字段：阶段、文件路径、行号（如适用）、错误码（如适用）
- 安装依赖场景：developer 写 `- {ts} 依赖安装完成 | {包名}@{版本} | node_modules/{包名}/` 由主智能体转述给用户（用户偏好：「每次安装了什么依赖的时候，完成后需要告诉我安装位置」）
- 本批次预期**不引入新依赖**（auth.mjs 全部 Node 内置 crypto/fs/path）；如 developer 主张引入依赖必须升级本 spec 并经主智能体确认

## 加密规范

### 密码哈希（**本批次新增**）

- 算法：`scrypt`（Node 内置 `crypto.scryptSync`，零依赖）
- 参数：`{ N: 16384, r: 8, p: 1, keylen: 32 }`（固定，存 `data/auth.json` 的 `params` 字段以便未来调整）
- 盐：`crypto.randomBytes(16)` 生成，hex 字符串存 `data/auth.json`
- 哈希输出：hex 字符串存 `data/auth.json` 的 `scryptHash` 字段
- 验证：每次 `verifyPassword` 用 `crypto.timingSafeEqual(Buffer.from(storedHash,'hex'), Buffer.from(computedHash,'hex'))` 防时序攻击
- env 逃生口：`process.env.ADMIN_PASSWORD` 非空时 verify 优先比对 env（不查文件）；此分支同样用 `timingSafeEqual` 保护

### 文件权限

| 文件 | 路径 | 权限 | gitignore |
|---|---|---|---|
| 密码哈希 | `data/auth.json` | `0600` | 是 |
| session | `data/sessions.json` | `0600` | 是 |
| 目录 | `data/` | `0700` | 是（但其内 md/html 不忽略） |

- 写入用 `fs.writeFileSync(path, json, { mode: 0o600 })`；写完后必须 `fs.statSync().mode & 0o777 === 0o600` 断言（Unix 严格，Windows 测试跳过该断言但仍调 writeFileSync 的 mode 选项以保持可移植性）
- 目录不存在时 `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })`

### 微信 ClawBot 媒体加解密

- 由 `weixin-agent-sdk` 内部 AES-128-ECB 处理，不在应用层再做（沿用 01 批次）
- 不存用户密码 / Token / Cookie 明文（Cookie `wxd_sid` 仅是不透明 sid，服务端表存 username + expiresAt）

## 文件名 / URL 指纹

- 持久化文件：`data/auth.json`、`data/sessions.json`、`data/index.json`、`data/md/<slug>.md`、`public/wechat/download/<slug>.html`、`public/wechat/download/index.json`、`.domain-cache.json`
- 路由前缀：`/admin`、`/admin/login`、`/admin/setup`、`/admin/logout`、`/admin/qr`、`/admin/qr/start`、`/admin/qr/status`、`/api/admin/login`、`/api/admin/setup`、`/api/admin/password`、`/api/admin/me`
- Cookie 指纹：`wxd_sid=<sid>`（sid = `crypto.randomBytes(32).toString('hex')`，64 字符）
- session 表结构：`{ [sid: string]: { user: string, createdAt: ISOString, expiresAt: ISOString } }`
- auth.json 结构：`{ username: string, scryptHash: string, salt: string, params: {N,r,p,keylen}, createdAt: ISOString, updatedAt?: ISOString }`

## 数据库规范

- 本项目无数据库
- 索引存储采用 JSON 文件（`data/index.json`）；session 用 `data/sessions.json`
- 并发写入由 Node 单进程串行处理（无需锁）；auth/session 写入用 atomic rename（先写 `.tmp` 再 `fs.renameSync` 覆盖）保证崩溃一致

## API 设计规范

- 路由风格：纯 HTTP（无 `/api/` 统一前缀，沿用既有 server.mjs 风格）
- 鉴权路由前缀 `/api/admin/*` 与视图路由 `/admin/*` 严格分开
- 错误响应统一结构（见上）
- 鉴权：cookie `wxd_sid` + 服务端 session 表；`/admin/*` 守卫在 server.mjs 中间件链统一拦截（除白名单）
- 微信 bot 端：用户身份即微信扫码的微信号本身；不应用层校验

## 前端规范（§十二）

### 必须复用

- 字体：仅 `var(--reading)`（思源宋体）或 `ui-monospace, Consolas, monospace`
- 颜色：仅 CSS 变量（`--paper` `--ink` `--pencil` `--border` `--accent` 等）；不允许新 hex
- 布局：仅 flexbox / grid；不允许 float / 绝对定位堆叠
- 错误展示：`<div class="note err">` 或 `<pre class="err">`，monospace 字体，分行展示 `error_code` / `message` / `stage` / `request_id`（与 admin-qr.html 既有 `.err` 块一致）

### 卡片规范（控制台 4 卡片）

```css
.panel {
  border: 1px solid var(--ink);
  background: var(--paper);
  padding: 24px 22px;
  border-radius: 3px;
}
.panel h2 { margin: 0 0 12px; font-size: 18px; font-weight: 900; letter-spacing: .05em; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.panel .stat { font: 600 24px/1.2 ui-monospace, Consolas, monospace; color: var(--ink); }
.panel .stat-label { font-size: 13px; letter-spacing: .3em; color: var(--pencil); text-transform: uppercase; }
```

外层用 `display: grid; grid-template-columns: 1fr 1fr; gap: 18px;`（窄屏 `flex-direction: column`）。

### 顶部用户态条（仅后台页面）

```html
<span class="blog-link" style="pointer-events:none;">当前：<b><%= username %></b></span>
<a class="blog-link" href="/admin/logout">退出</a>
<a class="blog-link" href="/admin/password">修改密码</a>
```

公开页（`/`、`/wechat/download*`）**不加**。

### 文案规范（§十二.6）

| 路由 | 标题 |
|---|---|
| `/` | `微信公众号在线下载器 · …` |
| `/admin` | `管理员后台 · 微信公众号在线下载器` |
| `/admin/login` | `管理员登录 · 微信公众号在线下载器` |
| `/admin/setup` | `首次设置 · 微信公众号在线下载器` |
| `/admin/qr` | `扫码绑定微信 · 微信公众号在线下载器` |
| `/wechat/download` | `已收录文章 · 微信公众号在线下载器` |

### 不允许的写法（§十二.9）

- ❌ 引入新字体
- ❌ 引入新 hex 颜色
- ❌ 引入动画 / 过渡（全局已 `transition: none !important`）
- ❌ 改 favicon
- ❌ 用 flexbox / grid 之外的花式布局
- ❌ 引入 JS 框架（保持原生 `<script>`）
- ❌ 引入新图标（除现有 favicon 外不再加图标资源）

### 抽离复用 CSS 的可选重构（非必需）

v3 阶段**暂不抽离**。所有视图各自保留 `:root` + 重置，代价是文件间重复 ~60 行 CSS。后续如果新增第 6 个视图再考虑抽 `views/_shared.css`。

## 数据持久化保证（§六）

- 落盘路径强约束：`data/md/` `public/wechat/download/` `data/auth.json` `data/sessions.json` 均基于 `cwd()` 解析（`storage.mjs` 用 `__dirname`，`auth.mjs` 用 `process.cwd()` 或 `__dirname` 一致）
- 写盘用 atomic rename：`fs.writeFileSync(path + '.tmp', json, { mode })` → `fs.renameSync(path + '.tmp', path)`
- 启动重读：`auth.mjs` 模块加载时若 `data/auth.json` 存在 → 读回 sessions 进内存 Map
- 写盘策略：session 创建/销毁仅写内存 + 文件，不在每个请求热路径同步 IO（§〇 Q8）
- 备份范围：`data/md/`、`data/index.json`、`data/auth.json`、`public/wechat/download/`；**不**备份 `data/sessions.json` / `.domain-cache.json`（重启重建）

## 测试规范

- 后端：vitest 或 `node:test`（推荐 `node:test`，无需额外依赖）
- 前端：人工浏览 + 截图；列表页用 curl 验证 HTML 输出
- 错误码断言：测试报告中所有错误响应或异常路径必须贴 `error_code`
- 证据保留：测试报告必须贴文件路径 + 行号；视觉测试必须截图（PNG，存放在测试报告同目录 `test-reports/_screenshots/`）
- 新增测试覆盖：
  - `tests/auth.test.mjs` ≥ 10 用例
  - `tests/persistence.test.mjs` ≥ 5 用例（对齐 §六.B）
  - `tests/copy.test.mjs` ≥ 3 用例（扫所有 `*.html`/`*.md` 禁止旧文案）
- 既有 43 个单测必须回归通过

## Code Style

- 格式化：沿用既有 `server.mjs` / `article.mjs` 的 2 空格缩进 + 分号风格；新模块统一同上
- Lint：暂不强制 ESLint（项目无构建）；关键模块由 tester 在审阅时检查
- Type hints：本项目为纯 JS，无 TS；复杂接口（如 `Agent.chat` `requireAuth`）用 JSDoc 注释约束

## 红线（绝对禁止）

- ❌ "操作失败，请稍后重试"这类无错误码的宽泛文案
- ❌ 前端统一显示错误信息
- ❌ 在 import 时读取密钥或模型（本项目无，但新增 auth.mjs 不得在模块顶层读取 `process.env.ADMIN_PASSWORD`，必须在 verify 函数体内读取以支持运行时切换）
- ❌ 直接抛未编码的异常 / 错误对象，必须用错误码常量
- ❌ 修改 `references/` 任何只读参考（本项目无）
- ❌ 在测试报告里"修改代码"
- ❌ 输出推测的字段名或协议字段（如 SDK 的字段名必须先查 Context7 再写）
- ❌ 把变更内容写进子智能体返回文本
- ❌ 微信回执带标题 / 本地路径 / emoji（必须**只有 URL 一行**，沿用 01 批次）
- ❌ 在 `index.json` 写绝对域名（必须用相对路径 `/wechat/download/<slug>.html`）
- ❌ 把 `WECHAT_BOT=1` 默认开启（默认仅 HTTP，沿用 01 批次）
- ❌ 引入新 npm 依赖（auth.mjs 全部使用 Node 内置 crypto/fs/path；如需引入需升级本 spec 并经主智能体确认）
- ❌ 把密码明文 / 哈希写进日志（仅允许在调试模式且脱敏后写首字符 + `****`）
- ❌ 把 session sid 写进日志（仅允许在调试模式且写前 8 字符 + `****`）
- ❌ 在 `data/auth.json` 写入时省略 mode 0600（Unix 下必须严格，Windows 下测试跳过该断言但 mode 选项必须传）

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
- 本批次承接 01 批次的代码基线，task2~task10 改动必须基于 `wechat-downloads-2026-09-17--01/final-report.md` 列出的既有文件
