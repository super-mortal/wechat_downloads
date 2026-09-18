# 微信公众号在线下载器 · 部署文档

> 单人自部署指南。微信公众号在线下载器：环境、启动、扫码绑定、进程守护、Nginx 反代、任意域名部署、文件落盘、回执格式、故障排查。

---

## 一、项目简介

`wechat_downloads` 是**微信 ClawBot + 本地下载器**的个人自部署项目：你在自己服务器上跑一个 Node 服务，浏览器打开 `/admin/qr` 扫码绑定微信后，把公众号链接（`https://mp.weixin.qq.com/s/...`）发到微信里，机器人就会回执一条**纯阅读 URL**，同时把 Markdown 落盘到 `data/md/`、把 HTML 部署到 `public/wechat/download/`，所有文章都能在 `/wechat/download` 列表页访问。**全程零外部依赖**——不依赖任何 AI/LLM 模型、不需要公网 webhook、不依赖第三方云存储，单机即开即用。

---

## 二、环境要求

| 工具 | 版本要求 | 说明 |
|---|---|---|
| **Node.js** | **≥ 22** | `weixin-agent-sdk` 要求 Node ≥ 22（见其 `engines` 字段） |
| **git** | 任意稳定版 | 克隆仓库 |
| **npm** | 随 Node 自带 | 安装依赖（建议 npm ≥ 10） |

> 如果服务器上还没有 Node 22，推荐用 [nvm](https://github.com/nvm-sh/nvm) 或 [fnm](https://github.com/Schniz/fnm) 装一个；`weixin-agent-sdk` 在更低的 Node 版本上无法启动。

### 可选工具

- **pm2**：进程守护（推荐）
- **Nginx**：反代 + HTTPS（公网部署必备）

---

## 三、克隆与安装

```bash
git clone <你的仓库地址>
cd wechat_downloads
npm install
```

`npm install` 会拉取三个运行依赖：

| 包 | 用途 |
|---|---|
| `weixin-agent-sdk` | 微信消息长轮询 + Agent 封装 |
| `@tencent-weixin/openclaw-weixin` | 二维码登录 API |
| `playwright` | 公众号文章 DOM 抓取 |

> 安装过程如果下载 Chromium 失败，可以参考 Playwright 官方文档配置镜像；不需要 Chromium 跑扫码登录，但**首次抓取文章时会用到**。

---

## 四、启动方式

启动入口是 `server.mjs`，默认监听 `127.0.0.1:3915`。有三种启动模式：

### 4.1 仅 HTTP（默认）

```bash
npm start
```

预期日志：

```
ready · http://127.0.0.1:3915
```

适合：先验证服务能起来、看首页/列表页，**还不接微信**的时候。

### 4.2 HTTP + 微信 bot

```bash
WECHAT_BOT=1 npm start
```

预期日志（首次启动、还没扫码）：

```
ready · http://127.0.0.1:3915
[wechat-bot] bot started { type: 'object', isBot: true }
[wechat-bot] ... (SDK 长轮询日志)
```

如果日志里出现 `error_code: WXD-NET-0002`，说明二维码还没扫或长轮询断开——按本文件「十二、故障排查」处理。

### 4.3 强制定位（可选）

```bash
PUBLIC_BASE_URL=https://your.domain npm start
```

什么时候用：你想跳过"第一次 HTTP 访问来缓存域名"的逻辑，让 agent 的回执 URL **立即**就是你的公网域名。优先级：`PUBLIC_BASE_URL` env > Nginx 头 > Host > 兜底 `127.0.0.1:3915`。

> 三种模式互不冲突——HTTP 一直都在，`WECHAT_BOT=1` 只是额外把 agent 接入 SDK 长轮询。

---

## 五、首次扫码绑定

只有 `WECHAT_BOT=1` 启动后才需要这一步。

1. 浏览器打开 `https://<你的域名>/admin/qr`
2. 页面加载后会自动调 `POST /admin/qr/start` 生成二维码
3. 用**想要绑定的微信**扫一扫页面上的二维码
4. 页面状态按以下顺序切换：

   | 状态 | 含义 |
   |---|---|
   | `wait` | 等你扫 |
   | `scanned` | 已扫，等你在手机上点"登录" |
   | `confirmed` | 绑定成功 |
   | `expired` | 二维码过期，需刷新页面重新生成 |

5. 看到 `confirmed` 后，这个微信号就绑定了，可以往这个微信号发公众号链接测试。

> 二维码有效期约 5 分钟（SDK 默认 300_000 ms），过期后刷新页面即可重新生成，无需重启服务。

---

## 七、进程守护（pm2）

服务器上跑 Node 服务，推荐用 pm2 托管，断电/重启后自动拉起。

### 7.1 安装 pm2

```bash
npm i -g pm2
```

### 7.2 仅 HTTP 模式

```bash
pm2 start server.mjs --name wechat-downloads --time
pm2 startup    # 生成开机自启脚本，按提示执行它输出的命令
pm2 save       # 保存当前进程列表，开机按这个列表恢复
```

### 7.3 HTTP + 微信 bot 模式

```bash
WECHAT_BOT=1 pm2 start server.mjs --name wechat-downloads --time
pm2 startup
pm2 save
```

### 7.4 改环境变量后重启

pm2 不会自动继承 shell 的 env。改 `WECHAT_BOT` 或 `PUBLIC_BASE_URL` 后：

```bash
WECHAT_BOT=1 pm2 restart wechat-downloads --update-env
```

`--update-env` 会把当前 shell 的环境变量刷进去。

### 7.5 常用命令

```bash
pm2 logs wechat-downloads          # 实时日志
pm2 status                        # 进程状态
pm2 restart wechat-downloads      # 普通重启
pm2 stop wechat-downloads         # 停
pm2 delete wechat-downloads       # 删
```

---

## 八、Nginx 反代（按 DEV_PLAN §7.4）

服务监听 `127.0.0.1:3915`，**必须**经过 Nginx 反代才能暴露公网域名、HTTPS、以及微信能访问的 URL。

### 8.1 完整 server 块

```nginx
server {
    listen 80;
    server_name your.domain.com;

    location /wechat/download/ {
        proxy_pass http://127.0.0.1:3915/wechat/download/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;   # ← 关键
        proxy_set_header X-Forwarded-Host  $host;     # ← 关键
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:3915/admin/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
    }
}
```

### 8.2 ⚠️ 两行关键头不能漏

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
```

**这两行缺一不可**——`wechat_downloads` 的 `domain.mjs` 靠这两个头来识别公网域名（见 DEV_PLAN §7.1），如果 Nginx 没传，agent 回执里的 URL 会退化成 `http://127.0.0.1:3915/wechat/download/xxx.html`，扫码点开就是"连接被拒"。

> 想跑 HTTPS？在 server 块前加 `listen 443 ssl;` + `ssl_certificate` / `ssl_certificate_key`，并把 `proxy_set_header X-Forwarded-Proto https;`（或保留 `$scheme`，Nginx 会自动识别）。

---

## 九、任意域名部署说明

**任意域名都能直接用，不需要改任何代码**。原理（见 DEV_PLAN §7.1 / §7.2）：

1. **第一次访问** `/admin` 或 `/wechat/download` 时，`domain.mjs` 把 `Host` 头（或反代传过来的 `X-Forwarded-Host`）缓存到模块级变量。
2. **agent 回执**时读这个缓存，组装出真实的公网 URL。
3. 所以你只要把 Nginx 配好，让 `Host` / `X-Forwarded-Host` 正确传给 Node 服务，换域名 = 改 Nginx `server_name`，Node 端一行都不用动。

### 三种覆盖域名的方式（按优先级）

| 优先级 | 方式 | 适用场景 |
|---|---|---|
| 1 | `PUBLIC_BASE_URL=https://your.domain npm start` | 还没上 Nginx 之前想强制定位；或测试环境 |
| 2 | Nginx `X-Forwarded-Host` + `X-Forwarded-Proto` | 生产环境标准做法 |
| 3 | 直接访问 Node 服务的 `Host` 头 | 本机调试 `http://127.0.0.1:3915` |
| 兜底 | `http://127.0.0.1:3915` | 没人访问过任何 HTTP 路由、agent 直接被触发 |

> 注意：env 的优先级永远最高——只要设了 `PUBLIC_BASE_URL`，反代头就被忽略。

---

## 十、文件落盘位置

| 路径 | 内容 |
|---|---|
| `data/md/<slug>.md` | 抓取后的 Markdown 原文 |
| `public/wechat/download/<slug>.html` | 渲染好的单篇 HTML（公网可访问） |
| `data/index.json` | 文章索引（slug / 标题 / 作者 / URL / 时间等） |

`slug` 规则（v3，见 storage.mjs#buildSlug）：

```
<yyyy-mm-dd>-<6位hash>
```

例：`2026-09-17-FtWvOW`。**title 不再进 URL**（中文 / 特殊字符 / 长度都不影响 slug），只存在 `data/index.json` 的 `title` 字段里。同一 URL 永远同一 slug（含 hash 稳定）。

> 这些目录**首次启动时会自动创建**。`.gitignore` 已经把 `data/md/` 和 `public/wechat/download/*.html` / `*.json` 排除，**不会被提交到 git**。

---

## 十一、回执格式（按 DEV_PLAN §5.3）

### 11.1 成功收录

用户发 `https://mp.weixin.qq.com/s/FtWvOWI2kVVS_1sQiKNWbw`，回执：

```
我用workbuddy手搓了一个爆款视频反推skill，一键复刻
https://your.domain.com/wechat/download/2026-09-17-a7174c.html
```

**v3 起两行**：第一行是标题（一眼看到是啥），第二行是阅读 URL（微信会自动转成可点的链接卡片）。无本地路径、无 emoji。

### 11.2 重复收录

已经抓过同一 URL，回执仍然是已有 URL（两行，不重复抓取）：

```
原文章标题
https://your.domain.com/wechat/download/2026-09-17-a7174c.html
```

### 11.3 抓取失败

文章被删/反爬/网络失败，回执：

```
该文章无法访问，换一条试试
```

### 11.4 斜杠命令

| 命令 | 回执 |
|---|---|
| `/help` | 帮助文字 |
| `/all` | 一行列表页 URL：`https://your.domain.com/wechat/download` |
| `/count` | 文章总数（例如：`12`） |

> 其他任何文本（包括非公众号链接）回执：「请发 mp.weixin.qq.com/s/... 公众号链接，或 /help 看命令」

---

## 十二、故障排查

### 12.1 二维码出不来

**症状**：浏览器 `/admin/qr` 一直转圈，或 `POST /admin/qr/start` 返回 500。

**排查**：

1. **网络能不能访问 `ilinkai.weixin.qq.com`**——SDK 依赖腾讯的 QR 服务，服务器必须能出公网：
   ```bash
   curl -I https://ilinkai.weixin.qq.com
   ```
2. 检查 `server.mjs` 进程是否还在：
   ```bash
   pm2 status
   pm2 logs wechat-downloads --lines 100
   ```
3. 看 `error_code: WXD-NET-0002` 之类，看 `stage` 字段定位是 `admin.mjs#startQr` 还是 `admin.mjs#pollQrStatus`。

### 12.2 回执变成 127.0.0.1

**症状**：微信里收到 `http://127.0.0.1:3915/wechat/download/xxx.html`，点开连不上。

**原因**：**Nginx 没传 `X-Forwarded-Proto` 和 `X-Forwarded-Host` 这两个头**（或只用了一行）。

**修复**（参考「八、Nginx 反代」§8.2）：

```nginx
proxy_set_header X-Forwarded-Proto $scheme;   # ← 必须
proxy_set_header X-Forwarded-Host  $host;     # ← 必须
```

加完后 `nginx -s reload`，并在浏览器里访问一次 `/wechat/download`（让缓存刷新），再让微信重发一次链接。

### 12.3 文件没落盘

**症状**：微信回执了 URL，但 `data/md/` 或 `public/wechat/download/` 下没文件。

**排查**：

1. 检查 Node 进程对这两个目录有没有写权限：
   ```bash
   ls -ld data public/wechat/download
   ```
2. pm2 跑的进程可能用了 www 用户，确认 `pm2 start` 的 `--user` 与目录 owner 一致：
   ```bash
   pm2 start server.mjs --name wechat-downloads --user www
   ```
3. 看 `pm2 logs` 里有没有 `EACCES` / `EPERM` 错误。

### 12.4 服务起来了但 502

**症状**：访问域名看到 502 Bad Gateway。

**排查**：

1. Node 服务是否真在 3915 监听：
   ```bash
   ss -ltnp | grep 3915
   ```
2. Nginx 配的 `proxy_pass http://127.0.0.1:3915;` 是否正确。
3. `pm2 logs wechat-downloads --lines 200` 看 Node 端有没有报错。

### 12.5 二维码过期但页面没反应

**症状**：扫码提示已过期，但页面还停在 `scanned`。

**修复**：直接刷新页面（`Cmd/Ctrl + R`）。二维码有效期 5 分钟（300 秒），过期后会自动回到 `expired`，刷新页面会重新生成。

---


---

## 十三、修订记录

### v2 · 2026-09-18 · domain 缓存文件持久化

**改动**：domain.mjs 把公网域名同步落盘到项目根目录 .domain-cache.json（100ms 防抖），进程重启后第一次 bot 回执会自动从该文件恢复，不再退回到 http://127.0.0.1:3915。

**为什么**：原先域名只存在内存里，进程一重启就清空；如果重启后 bot 立即收到链接（中间没人访问过 HTTP），就只能走兜底值。

**现在的优先级（从高到低）**：

1. PUBLIC_BASE_URL env（仍是最高优）
2. Nginx X-Forwarded-Host + X-Forwarded-Proto（HTTP 请求时自动记录到内存）
3. 直接访问 Node 服务的 Host 头（HTTP 请求时自动记录到内存）
4. **.domain-cache.json 文件持久化缓存（新增）**
5. 兜底 http://127.0.0.1:3915

**部署侧无需任何改动**：.domain-cache.json 已被 .gitignore 忽略，不会污染仓库；你已经在服务器上设的 PUBLIC_BASE_URL=http://128.241.231.124:3916 也不受影响（env 永远优先）。

> **验证方式**：服务器上 pm2 restart wechat-downloads --update-env && pm2 save 后，让微信立刻重发一条链接，回执应该是 http://128.241.231.124:3916/wechat/download/...，而不是 127.0.0.1:3915。

---

## 附录 A：环境变量速查

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3915` | 当前是硬编码，暂不通过 env 改 |
| `WECHAT_BOT` | 空 | 设为 `1` 启动微信 bot 长轮询 |
| `PUBLIC_BASE_URL` | 空 | 强制覆盖域名（最高优先级），例：`https://your.domain` |

---

> 文档同步自 `DEV_PLAN.md` §5.3 / §7.x / §9.x / §10.3。
> 修订：v3 · 2026-09-18 · slug 简化为 `<date>-<hash6>` + 回执两行
> · v2 · 2026-09-18 · domain 缓存文件持久化
> · v1 · 2026-09-17



---

## Y. 数据持久化与备份

### Y.1 持久化清单

见 [README.md §数据持久化](./README.md#数据持久化)。**核心：`data/` 目录 + `public/wechat/download/`**。

### Y.2 备份脚本

在 crontab 中加入：

```cron
# 每日凌晨 3 点备份（保留 30 天）
0 3 * * * cd /path/to/wechat_downloads && node -e "import('./storage.mjs').then(m => m.backupDataDir('./backups/$(date +\%Y\%m\%d)'))" && find ./backups -maxdepth 1 -type d -mtime +30 -exec rm -rf {} \;
```

### Y.3 灾难恢复

```bash
# 1. 停服
pm2 stop wechat-downloads

# 2. 备份当前 data/（以防恢复出错）
mv data data_backup

# 3. 解压备份
node -e "import('./storage.mjs').then(m => m.restoreDataDir('./backups/20260101/wxd-backup.zip'))"

# 4. 启动
pm2 start wechat-downloads

# 5. 验证
curl https://your.domain/admin/api/me  # 应返回当前用户
```

### Y.4 注意事项

- **`data/` 不要放在 git 仓库**（已在 `.gitignore` 排除）
- **不要手动改 `auth.json` / `sessions.json`**：所有写入均走 atomic rename，手改会被覆盖
- **磁盘满**会触发 `WXD-STORAGE-0006` 错误，监控 data 目录大小
- **`backups/`** 也建议加 cron 清理（保留 30 天滚动）

### Y.5 优雅关闭

`pm2` 默认发送 `SIGINT`，本项目会捕获并优雅退出（§六 §六.C）。如果用 `kill -9` 强制杀掉：
- 已写入的 session / admin.log 不丢失（atomic rename 保护）
- 未写入的 session 创建 / 改密操作可能丢失（在内存未落盘阶段）
