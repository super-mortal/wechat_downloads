# 微信公众号在线下载器

> 微信 ClawBot + 本地下载器：粘链接 → 公众号文章存成可移植本地文件。

把 `mp.weixin.qq.com/s/...` 链接发给绑定的微信机器人，机器人回执一条可点击的阅读 URL，同时把 HTML 落到 `public/wechat/download/` 供 `/wechat/download` 列表页访问。也可以直接在浏览器首页粘贴链接下载，三种格式（HTML / Markdown / PDF）任选。

GitHub: [super-mortal/wechat_downloads](https://github.com/super-mortal/wechat_downloads)

## 它做什么

- 首页（零账号）：打开浏览器 → 粘链接 → 选格式 → 下载。临时下载，不存盘
- 后台（管理员账号）：扫码绑定微信 → 公众号链接发到微信 → 自动归档
- 自动备份：管理员可设置按小时 / 天 / 周自动备份到 backups/

## 特性

- 零外部依赖：不依赖云函数、不依赖 LLM、不依赖第三方存储，单机即开即用
- 三种格式可选：html / md / pdf，可单选可多选
- 两种产物模式：
  - 合并为单文件（默认）：HTML 图片 base64 内嵌、Markdown 保留远程图片、PDF 自包含；所选格式各自独立下载
  - 分文件 + 打 zip：HTML / Markdown 用 imgs/ 相对路径引图；整批产物 + imgs/ 打包成单个 .zip
- 微信机器人归档：发链接到微信 → 回执 URL + 自动落 public/wechat/download/<slug>.html
- 管理员后台：绑定状态 / 自动备份调度 / 修改密码 / 公网 URL 复制 / 归档统计
- 首次访问自动引导 setup：未初始化时任意 URL 自动 302 → /admin/setup，强制首次设置密码（≥ 8 位）

## 环境要求

- Node.js `>=24.16.0 <25 || >=26.1.0`（package.json#engines 已声明；weixin-agent-sdk 强依赖）
- git / npm（推荐 npm ≥ 10）
- 可选：pm2（进程守护）/ Nginx（公网反代 + HTTPS）

## 安装与启动

```bash
git clone https://github.com/super-mortal/wechat_downloads.git
cd wechat_downloads
npm install     # 自动 postinstall: playwright install chromium
npm start
# ready · http://127.0.0.1:3915
```

浏览器打开 http://127.0.0.1:3915：

- 首次访问：自动跳到 /admin/setup，设置管理员密码（≥ 8 位）
- 设置完成后用该密码登录 /admin
- 管理员后台 /admin/qr 扫码绑定微信 → 即可开始用

## 首页用法（公开访问）

把链接粘贴到文本框（一条一行），勾选要导出的格式（HTML / Markdown / PDF），点“下载”。

| 开关 | 行为 | 批量限制 |
|---|---|---|
| 关（默认） | HTML / MD / PDF 各产一份独立下载 | 单次最多 5 条 |
| 开 | 所有产物 + imgs/ 打包成单个 zip | 无条数限制 |

> 首页仅临时下载：产物在内存池里 5 分钟无访问自动回收，不在项目目录留中间文件。

## 后台用法（管理员）

访问 /admin 用管理员密码登录后：

| 功能 | 路径 | 说明 |
|---|---|---|
| 控制台首页 | /admin | 绑定状态 / 备份控制 / 归档统计 |
| 扫码绑定 | /admin/qr | 用微信扫二维码绑定机器人 |
| 修改密码 | /admin 顶部按钮 | 旧 session 自动失效 |
| 退出登录 | /admin 顶部按钮 | 清当前 session |

### 微信机器人命令（私聊发送）

- 粘一条 `mp.weixin.qq.com/s/...` → 自动抓取 → 回执阅读 URL（标题 + URL 两行）
- `/all` → 返回已收录列表
- `/count` → 返回已收录条数
- `/help` → 命令列表

机器人只保存 HTML 到 `public/wechat/download/`，不再写 Markdown 到 `data/md/`（首页下载时仍可临时选 Markdown 格式）。

## 命令行

```bash
node cli.mjs <url> [out-prefix] [formats] [split]
# formats 逗号分隔，可选：html,md,pdf（默认 html,md,pdf）
# split   on/off（默认 off）
# 例：node cli.mjs https://mp.weixin.qq.com/s/xxx my-article md,pdf on
```

CLI 把产物写到 ./out/（已被 .gitignore 排除），便于脚本接入。首页和后台不走 out/，走内存池。

## HTTP 接口

### 公开

| 路径 | 方法 | 说明 |
|---|---|---|
| `/` | GET | 首页 UI |
| `/wechat/download/` | GET | 归档列表（HTML 渲染） |
| `/wechat/download/<slug>.html` | GET | 单篇文章（在线阅读） |
| `/wechat/download/index.json` | GET | 归档索引 JSON |

### 需要管理员登录

| 路径 | 方法 | 说明 |
|---|---|---|
| `/admin` | GET | 控制台首页 |
| `/admin/setup` | GET / POST | 首次设置密码（仅未初始化时可用） |
| `/admin/login` | GET / POST | 登录 |
| `/admin/logout` | POST | 退出 |
| `/admin/qr` | GET | 扫码绑定页 |
| `/admin/qr/start` | POST | 启动扫码会话（需 WECHAT_BOT=1） |
| `/admin/api/password` | POST | 修改密码 |
| `/admin/api/backup-config` | GET / POST | 备份周期设置 |
| `/admin/api/backup-now` | POST | 立即备份 |
| `/download` | POST | 抓取（需登录 + URL 白名单 mp.weixin.qq.com） |

## 项目结构

| 文件 | 作用 |
|---|---|
| `engine.mjs` | 浏览器引擎本地适配层；只这里 import playwright |
| `article.mjs` | 抓取 + 组装 HTML / Markdown / PDF |
| `agent.mjs` | 微信机器人入口：识别 URL → 调用抓取 → 回执 + 归档 |
| `commands.mjs` | 机器人命令派发（/help /all /count） |
| `storage.mjs` | 持久化 + 索引 + 备份恢复（atomic rename） |
| `auth.mjs` | 管理员密码 scrypt + session + 中间件 |
| `admin.mjs` | 扫码绑定 + 控制台 API |
| `backup-config.mjs` | 自动备份调度（0 / 6h / 24h / 168h） |
| `server.mjs` | HTTP 服务 + 全部路由 |
| `cli.mjs` | 命令行入口 |
| `views/` | setup / login / 控制台 / 扫码 / 归档列表 |
| `public/wechat/download/` | 归档 HTML（线上可访问） |
| `data/` | 管理员态 + 索引（详见下节） |

## 数据持久化

data/ 目录保存所有管理员态与归档数据。pm2 重启 / 服务器重启 / 磁盘未损坏场景下不丢失。

### 持久化文件清单

| 文件 | 内容 | 权限（Unix） |
|---|---|---|
| `data/auth.json` | 管理员密码 scrypt 哈希 + salt | 0600 |
| `data/sessions.json` | 活跃 session（默认 7 天滑动续期） | 0600 |
| `data/admin.log` | 审计日志（登录、改密、退出） | 0600 |
| `data/auth-failures.json` | 登录失败记录 | 0600 |
| `data/index.json` | 归档索引（slug / title / url / html_url / created_at） | 系统默认 |
| `data/md/` | Markdown 目录（兼容预留；bot 流程不再写入） | 系统默认 |
| `data/backup-config.json` | 备份周期 + 上次结果 | 0600 |
| `public/wechat/download/<slug>.html` | 归档 HTML（线上可访问） | 系统默认 |
| `public/wechat/download/index.json` | 索引镜像（与 data/index.json 同步） | 系统默认 |

### 持久化保证

- 所有写盘使用 atomic rename（先写 .tmp 再 rename），断电 / kill -9 不会写一半
- 启动时从 data/auth.json + data/sessions.json 重读到内存
- storage.mjs#init() 启动加载归档索引
- public/wechat/download/index.json 与 data/index.json 双向同步（每次写入索引都会 mirror）
- 服务器优雅关闭：SIGTERM / SIGINT → 排空 sessions + flush admin.log → server.close

## 备份与恢复

备份由管理员在 /admin 控制台配置（间隔周期：关闭 / 每 6 小时 / 每 24 小时 / 每 7 天）。

```bash
# 手动备份
node -e "import(""./storage.mjs"").then(m => m.backupDataDir(""./backups""))"

# 从备份恢复（不覆盖已有文件）
node -e "import(""./storage.mjs"").then(m => m.restoreDataDir(""./backups/wxd-backup-20260101-1200.zip""))"
```

备份 ZIP 内含：data/index.json + public/wechat/download/*.html + public/wechat/download/index.json（不打包 auth / sessions / log / 备份配置）。

## 性能

- 启动 flags 调优：--no-sandbox --disable-gpu --disable-dev-shm-usage --disable-features=IsolateOrigins,site-per-process,Translate,BackForwardCache
- navigateAndWait 拦截 <script> / <stylesheet> 置空，避免微信文章页海外链路阻塞 HTML 解析器（实测 goto + 正文 ~4s，原 ~6.5s）
- 图片真实地址从 data-src 正则直取，不依赖页面 JS
- PDF 直接对自己拼出来的 HTML 做 page.pdf()（跳过广告 / 视频 / 外链 JS）
- PDF 字体链覆盖 Windows（SimSun / 微软雅黑）/ macOS（Songti / PingFang）/ Linux（Noto Serif CJK SC / WenQuanYi）

## 安全

- /download 接口必须登录 + URL 白名单 mp.weixin.qq.com（拒绝任意 Chromium 渲染代理滥用）
- 默认无管理员账号时任意 URL 自动 302 → /admin/setup，强制首次设置密码（≥ 8 位）
- 改密会自动销毁其他设备的 session
- 紧急逃生口：`ADMIN_PASSWORD=新密码 pm2 restart ... --update-env`
- 写入鉴权日志（data/admin.log）：登录 / 改密 / 退出 / 失败

## 限制

- 不下载视频源文件本身（公众号视频 / 腾讯视频链接都不会被拉）
- 极少数文章服务端会触发“环境异常”风控（与本工具无关）
- Markdown 的表格 / 代码块做了简化处理
- 微信 bot 模式需 WECHAT_BOT 环境变量启用（不开则只走首页 + 后台）

## 部署

公网部署 + Nginx 反代 + pm2 守护详见 [DEPLOY.md](./DEPLOY.md)。

## 许可证

MIT — Copyright © 2026 super-mortal

## 卸载

项目自包含：删掉 wechat_downloads/ 等于彻底卸载。node_modules/ 是最大的一块（含 Chromium 浏览器），删之前可先 `npm install --prefix .` 之外的位置复用。
