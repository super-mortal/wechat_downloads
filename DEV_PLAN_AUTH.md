# DEV_PLAN_AUTH.md — 管理员鉴权 & 控制台拆分方案

> 状态：定稿 v3 · 已确认决策（v1 把首页改成控制台被否决 → v2 两条产品线分开 → v3 决策定稿 + 数据持久化补充）
> 范围：单用户自部署场景下的"扫码前必须有管理员身份"机制，控制台作为独立入口，文案统一替换，归档数据持久化保证
> 关联：`server.mjs` `admin.mjs` `domain.mjs` `agent.mjs` `storage.mjs` `auth.mjs`（新）`views/*.html` `README.md` `DEPLOY.md`

---

## 〇、决策定稿（已确认）

| # | 决策 | 定稿 |
|---|---|---|
| Q1 | 鉴权范围 | **B · 仅 `/admin/*` 受保护**（`/`、`/wechat/download/*` 公开） |
| Q2 | 控制台入口位置 | **A · 主页右上角文字链接** `<a class="blog-link" href="/admin">管理后台 →</a>` |
| Q3 | 密码存哪 | **初始化时通过 `/admin/setup` 表单填写 → 写入 `data/auth.json`（scrypt 哈希 + 随机 salt，文件 mode 0600）。env `ADMIN_PASSWORD` 仅作逃生口**（详见 §四） |
| Q4 | 哈希算法 | **scrypt**（`crypto.scryptSync`，Node 内置，零依赖） |
| Q5 | session 机制 | **cookie + 服务端 session**（cookie 名 `wxd_sid`，`HttpOnly; SameSite=Lax`） |
| Q6 | 首次启动向导 | **A · 强制 `/admin/setup`**（未初始化访问 `/admin` → 302 `/admin/setup`；已初始化访问 `/admin/setup` → 302 `/admin/login`） |
| Q7 | session 默认有效期 | **7 天滑动续期**（每次 `getSession()` 自动延长 7 天） |
| Q8 | session 存储 | **内存 + `data/sessions.json` 文件持久化**（服务启动时读回；启动后写入仅落内存+文件，避免热路径同步 IO） |

---

## 一、为什么做这件事

### 1.1 现状盘点

| 路由 | 现在谁能访问 | 备注 |
|---|---|---|
| `/` | 任何人 | **产品线 A**：浏览器粘贴链接 → 下载产物。**保留不变。** |
| `/admin` | 任何人 | 现在的"扫码绑定"介绍页 |
| `/admin/qr` | 任何人 | **产品线 B 入口 / 攻击面** —— 任何人都能扫浏览器里的二维码，把当前服务器实例的微信绑到对方微信号上 |
| `/admin/qr/start` `/admin/qr/status` | 任何人 | 扫码 API |
| `/wechat/download` | 任何人 | 归档列表页 |
| `/wechat/download/<slug>.html` | 任何人 | 单篇文章页 |

### 1.2 两条产品线（明确分开）

| 产品线 | 入口 | 谁能用 | 目的 |
|---|---|---|---|
| **A. 公开在线下载器** | `/` | 任何人 | 粘贴链接 → 下载产物（HTML / MD / PDF） |
| **B. 微信机器人绑定 / 归档管理** | `/admin` | 仅管理员 | 扫码绑定微信、查看归档、查看系统状态 |

### 1.3 这次要解决的问题

1. **加管理员鉴权** —— 仅保护 `/admin/*`，挡住 `/admin/qr` 的攻击面
2. **新增独立控制台** —— `/admin` 改造成控制台首页（扫码卡片、归档入口、域名 / 状态展示）
3. **主页只动两点** —— 加一个"管理后台 →"入口链接 + 文案替换为"微信公众号在线下载器"，表单 / 按钮 / 交互全部保留
4. **后台页面顶部加用户态** —— "当前用户 / 退出"条，仅 `/admin/*` 出现
5. **微信归档数据持久化保证** —— 用户从微信发链接产生的 HTML / Markdown / 索引文件，必须做到 pm2 重启、服务器重启、磁盘未损坏场景下不丢失（详见 §六）

---

## 二、模块拆分

新增 / 改动的文件：

| 文件 | 类型 | 作用 |
|---|---|---|
| `auth.mjs` **新增** | 模块 | scrypt 哈希、session 增删查、`requireAuth(req, res)` 中间件、初始化检测、改密 |
| `views/login.html` **新增** | 视图 | 登录页（`/admin/login`） |
| `views/setup.html` **新增** | 视图 | 首次设置管理员密码页（`/admin/setup`） |
| `views/admin.html` 改 | 视图 | **从"扫码介绍页"改造成"控制台首页"**（加鉴权 + 4 张卡片 + 顶部条 + "修改密码"按钮） |
| `views/admin-qr.html` 改 | 视图 | 加顶部条（用户态 / 退出） |
| `views/list.html` 不动 | 视图 | 公开页，不加顶部条；仅文案 |
| `server.mjs` 改 | 入口 | 引入 `auth.mjs`、新增 6 个路由、`requireAuth` 中间件、给 `/admin/*` 加守卫。**`renderHome()` 不动结构**，只改文案 + 加 1 个链接 |
| `data/auth.json` **运行时生成，mode 0600** | 状态 | `{ username, scryptHash, salt, params, createdAt, updatedAt }` |
| `data/sessions.json` **运行时生成** | 状态 | `{ sid: { user, createdAt, expiresAt } }` |
| `tests/auth.test.mjs` **新增** | 测试 | scrypt / session / 中间件 / 改密 / 0600 权限 |
| `tests/persistence.test.mjs` **新增** | 测试 | **新增**：归档数据"模拟 pm2 restart 后仍能读到"（详见 §六） |
| `tests/copy.test.mjs` **新增** | 测试 | 扫所有 `*.html` / `*.md`，禁止旧文案 |
| `README.md` 改 | 文档 | 第一行、描述、特性、限制同步替换 + 加"数据持久化"段 |
| `DEPLOY.md` 改 | 文档 | 文案替换、新增 §X 管理员账号、新增 §Y 数据持久化与备份 |

---

## 三、鉴权模块接口（auth.mjs）

```js
// ====== 状态查询 ======
isInitialized()                    // data/auth.json 存在且合法 → true
hasEnvOverride()                   // process.env.ADMIN_PASSWORD 非空 → true

// ====== 初始化（仅未初始化时可用）======
setup(username, password)          // 写 auth.json（mode 0600）+ 自动登录
                                  // 已初始化时调用 → 抛 WXD-AUTH-0003

// ====== 改密（仅已登录可用）======
changePassword(sid, oldPw, newPw)  // 校验旧密码 → scrypt 新哈希 → 写盘

// ====== 登录 / 登出 ======
verify(username, password)         // true / false（env 覆盖优先）
createSession(username)            // 生成 sid + 写 sessions.json → 返回 sid
getSession(sid)                    // 读 sid，未过期返回 user，过期则删
destroySession(sid)                // 登出

// ====== 中间件 ======
requireAuth(req, res)              // 未登录 → 302 /admin/login?next=<path>
//                                    已登录 → 写入 req.user，回调 next()

// ====== 内部实现要点 ======
// 1) crypto.randomBytes(16) 生成 salt
// 2) crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }) 生成 hash
// 3) fs.writeFileSync(authPath, json, { mode: 0o600 })
// 4) verify 时 scrypt 新 hash 与存储 hash 比对，用 crypto.timingSafeEqual 防时序攻击
// 5) env 覆盖：hasEnvOverride() 为 true 时，verify 直接拿 process.env.ADMIN_PASSWORD 与 user 输入比对
```

### 3.1 路由改动总览

| 路由 | 改前 | 改后 |
|---|---|---|
| `GET /` | 公开 → `renderHome()` 表单页 | **公开不变**，仅改文案 + 加"管理后台 →"链接 |
| `GET /admin/login` | (无) | **公开** → `views/login.html` |
| `POST /api/admin/login` | (无) | **公开** → 校验 + Set-Cookie + 302 |
| `GET /admin/logout` | (无) | **需登录** → 销毁 sid + 302 /admin/login |
| `GET /admin/setup` | (无) | **公开但仅当未初始化** → `views/setup.html`；已初始化 → 302 /admin/login |
| `POST /api/admin/setup` | (无) | **公开但仅当未初始化** → 写 auth.json（0600） + 自动登录 + 302 /admin |
| `POST /api/admin/password` | (无) | **需登录** → 改密；用于控制台"修改密码"按钮 |
| `GET /admin` | 公开 → 介绍页 | **需登录** → `views/admin.html`（控制台） |
| `GET /admin/qr` | 公开 | **需登录** |
| `GET /admin/qr/start` `GET /admin/qr/status` | 公开 | **需登录** |
| `GET /wechat/download*` | 公开 | **公开不变** |

### 3.2 中间件顺序（server.mjs）

```
域名解析（既有，recordPublicBaseUrl）
→ 鉴权守卫（新增）：白名单放行，其余未登录 → 302 /admin/login?next=<path>
→ 路由分发
```

**白名单（不需登录）**：`/`、`/index.html`、`/admin/login`、`/api/admin/login`、`/admin/setup`、`/api/admin/setup`、`/admin/logout`、`/wechat/download`、`/wechat/download/index.json`、`/wechat/download/<slug>.html`、`/assets/*`、`/download`（POST 公开下载）。

**需登录**：`/admin`、`/admin/qr`、`/admin/qr/start`、`/admin/qr/status`、`/api/admin/password`、所有 `/api/admin/*`（除 login/setup）。

### 3.3 主页右上角入口（最小改动）

`server.mjs` 的 `renderHome()` 中，`.hd-links` 现有 "GitHub" / "博客 → supermortal.cn" 之间插入：

```html
<a class="blog-link" href="/admin">管理后台 →</a>
```

> 对未登录访客可见，点击 → 跳 `/admin/login`（或首次访问 → `/admin/setup`）。

---

## 四、密码存储细节（Q3 定稿）

### 4.1 初始化流程

```
访客首次访问 /admin
  └─ isInitialized() === false
     └─ 中间件：未登录 + 未初始化 → 302 /admin/setup

用户访问 /admin/setup
  └─ 表单输入 username + password + 确认密码
     └─ POST /api/admin/setup
        ├─ 校验两次密码一致（前端 + 后端都校验）
        ├─ 校验 username 长度 ≥ 3，password 长度 ≥ 8
        ├─ crypto.randomBytes(16) 生成 salt
        ├─ crypto.scryptSync(password, salt, 64, {N:16384, r:8, p:1})
        ├─ fs.writeFileSync('data/auth.json', JSON.stringify({
        │     username, scryptHash: hash.toString('hex'),
        │     salt: salt.toString('hex'),
        │     params: { N:16384, r:8, p:1, keylen:64 },
        │     createdAt: new Date().toISOString()
        │   }, null, 2), { mode: 0o600 })
        ├─ mkdir data/ 同步 mode 0o700
        ├─ createSession(username) → set-cookie
        └─ 302 /admin
```

### 4.2 登录流程

```
访客提交 /admin/login 表单
  └─ POST /api/admin/login { username, password }
     ├─ hasEnvOverride() === true
     │   └─ 直接比对 process.env.ADMIN_PASSWORD（恒定时长，防时序攻击）
     ├─ 否则 fs.readFileSync('data/auth.json') → 取 salt + params + scryptHash
     └─ crypto.scryptSync(password, salt, 64, params) === scryptHash
        ├─ true → createSession(username) + Set-Cookie: wxd_sid=<sid>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800
        └─ false → 401 + 错误码 WXD-AUTH-0001
```

### 4.3 文件位置 & 权限

| 文件 | 路径 | 权限 | gitignore |
|---|---|---|---|
| 密码哈希 | `data/auth.json` | `0600`（仅 owner 可读写） | 是 |
| session | `data/sessions.json` | `0600` | 是 |
| 目录 | `data/` | `0700` | 是（但其内 md/html 不忽略） |

> `data/auth.json` 写完后用 `fs.statSync().mode & 0o777` 断言确实是 `0600`，否则抛错退出。

### 4.4 逃生口（防自己改错密码锁死）

```bash
# 临时绕过文件密码：
ADMIN_PASSWORD=新密码 pm2 restart wechat-downloads --update-env

# verify() 检测到 env 非空，直接用它，覆盖文件：
verify('admin', process.env.ADMIN_PASSWORD) === true
```

- 仅当 `process.env.ADMIN_PASSWORD` 非空时生效；空则忽略
- 不修改 `data/auth.json`，仅作为本次启动的"临时密码"
- pm2 `pm2 save` 后下次重启仍生效（env 写进 dump.pm2）
- 找回文件访问权后，再用控制台"修改密码"按钮把文件密码更新

### 4.5 修改密码（控制台"修改密码"按钮）

```
控制台 /admin → 点 "修改密码" → 弹窗 / 跳转 /admin/password
  └─ 输 oldPw + newPw + 确认 newPw
     └─ POST /api/admin/password
        ├─ verify(req.user, oldPw) === false → 401 WXD-AUTH-0001
        ├─ scrypt 新密码
        ├─ 原子写 auth.json（tmp + rename，防半成品）
        └─ 200 + 提示"密码已更新，下次登录请用新密码"
```

### 4.6 为什么不用 env 作为主路径

| 维度 | env 为主 | 文件为主 |
|---|---|---|
| 改密码 | 需重启服务 + 改 pm2 dump | 浏览器一键 |
| 多实例 | 各实例需同步 env | 文件天然一致 |
| 初次配置 | 必填，忘了起不来 | 自动跳 /admin/setup |
| 文件可移植 | 不依赖文件系统 | 直接拷贝 `data/auth.json` 即可 |

> 文件为主 + env 为逃生口，覆盖所有场景。

---

## 五、文案 / 页面改动方案

### 5.1 文案对照表

| 位置 | 改前 | 改后 |
|---|---|---|
| README 第 1 行 | `# 免费公众号下载器` | `# 微信公众号在线下载器` |
| README 描述 | "在本机浏览器里把公众号文章存成可移植的本地文件" | "在线工具：粘贴链接即可下载公众号文章；同时支持扫码绑定微信机器人，长期自动归档。" |
| README 特性段 | "零账号、零代理：起一个本地 HTTP 服务…" | "无需账号：粘贴链接就能用 / 在线归档：扫码绑定微信后，发链接即自动归档，HTML 列表可分享" |
| `server.mjs` `<title>` | "免费公众号下载器" | "微信公众号在线下载器" |
| `server.mjs` `brand` 文案 | "免费公众号下载器" | "微信公众号在线下载器" |
| `server.mjs` `eyebrow` | "免登录 · 免 Cookie · 本地浏览器直读" | "免登录 · 免账号 · 在线下载" |
| `server.mjs` `h1` | "把微信公众号里看到的好文章，<br><mark>一键留到本机</mark>。" | "把微信里看到的<mark>好文章</mark>，<br><mark>一键归档</mark>。" |
| `server.mjs` `lead` | "贴链接、勾格式，点下载…" | "粘贴公众号链接，选 HTML / Markdown / PDF，浏览器自动下载。也可扫码绑定微信机器人，发链接给机器人即自动归档到 `/wechat/download`。" |
| footer `title` | "免费公众号下载器" | "微信公众号在线下载器" |
| footer `small` | "一个用本机浏览器直接读公众号文章…" | "粘贴链接即时下载；扫码绑定微信后可让机器人自动归档。" |
| `views/admin.html` `title` | "管理面板 · 微信扫码绑定" | "管理后台 · 微信公众号在线下载器" |
| `views/admin.html` eyebrow | `ADMIN · QR LOGIN` | `ADMIN · CONTROL PANEL` |
| `views/admin.html` h1 | "把微信<mark>扫码绑定</mark><br>搬到浏览器里" | "管理员<mark>控制台</mark>" |
| `views/admin.html` lead | "单次扫码即可把本机部署的 wechat-downloads 与你的微信连起来…" | "在此扫码绑定微信、管理归档、查看服务状态。" |
| `views/list.html` `title` | "已收录文章 · wechat-downloads" | "已收录文章 · 微信公众号在线下载器" |
| `views/list.html` lead | "微信公众号文章本地归档…" | "微信公众号文章在线归档…" |
| DEPLOY.md § 一 项目简介 | "微信 ClawBot + 本地下载器" | "微信公众号在线下载器（含 ClawBot 微信机器人）" |
| DEPLOY.md 全文 "本机" / "本地浏览器" 散落 | 各种 | "本服务" / "在线" |

### 5.2 主页 `/` 结构（**保持原样**，只动顶部链接 + 文案）

```
微信公众号在线下载器    GitHub  管理后台 →  博客 → supermortal.cn  ← 多一个链接
eyebrow: 免登录 · 免账号 · 在线下载
h1: 把微信里看到的好文章，一键归档。
[URL 输入框] [存放方式开关] [格式 chips] [下载按钮]   ← 全部保留
footer 4 张说明卡片（文案替换）
```

> 主页表单 / 按钮 / JS / 交互全部保留，仅文案变 + 多一条链接。

### 5.3 控制台 `/admin` 结构（受保护）

```
微信公众号在线下载器 · 管理后台      当前：<u> 退出   修改密码
eyebrow: ADMIN · CONTROL PANEL
h1: 管理员控制台
lead: 在此扫码绑定微信、管理归档、查看服务状态。
┌──────────────┐ ┌──────────────┐
│  扫码绑定微信 │ │  已收录文章  │
│  状态：已绑定 │ │  共 N 篇     │
│  [开始扫码]   │ │  [查看列表]  │
└──────────────┘ └──────────────┘
┌──────────────┐ ┌──────────────┐
│  公网域名    │ │  系统状态    │
│  xxx:3916    │ │  uptime / v  │
└──────────────┘ └──────────────┘
footer: 路由速览
```

### 5.4 登录页 `/admin/login`

```
微信公众号在线下载器
eyebrow: ADMIN · SIGN IN
h1: 管理员登录
[用户名]  [密码]  [登录]
错误时下方红框显示错误码 / 错误信息
顶部条 / 退出按钮不显示（未登录）
```

### 5.5 首次设置页 `/admin/setup`

```
微信公众号在线下载器
eyebrow: ADMIN · FIRST RUN
h1: 设置管理员账号
lead: 首次访问，配置一个管理员账号和密码。此后所有 `/admin/*` 都需要登录。
[用户名]  [密码]  [确认密码]  [完成]
顶部条 / 退出按钮不显示（尚未登录）
```

### 5.6 顶部用户态条（仅后台页面）

`views/admin.html`、`views/admin-qr.html` 的 `<header>` `.hd-links` 加：

```html
<span class="blog-link" style="pointer-events:none;">当前：<b><%= username %></b></span>
<a class="blog-link" href="/admin/logout">退出</a>
<a class="blog-link" href="/admin/password">修改密码</a>
```

> 公开页面（`/`、`/wechat/download*`）**不加**。

---

## 六、数据持久化保证（新增 §）

### 6.1 用户需求

> "微信用户那边传过来的链接保存好了 HTML 以及在相关的页面展示了之后，是需要持久化存储，重启什么的不丢失。"

### 6.2 现状分析

**已经在磁盘上且持久**：

| 内容 | 路径 | 是否 gitignore | 是否随磁盘 |
| --- | --- | --- | --- |
| Markdown 原文 | `data/md/<slug>.md` | 是 | ✅ |
| 文章 HTML | `public/wechat/download/<slug>.html` | 是 | ✅ |
| 索引（源） | `data/index.json` | 是 | ✅ |
| 索引（镜像） | `public/wechat/download/index.json` | 是 | ✅ |
| 域名缓存 | `.domain-cache.json` | 是 | ✅ |

> 这些都是普通文件，落盘后不会被 pm2 restart / 服务器重启影响；只是不入 git 仓。

**目前没磁盘化的状态**：

| 内容 | 位置 | 重启影响 |
| --- | --- | --- |
| QR 扫码会话 | `admin.mjs` 内存 Map | 重启清空（无害，5 分钟生命周期） |
| 单次下载文件池 | `server.mjs` `pendingFiles` | 重启清空（无害，5 分钟生命周期） |
| admin session | `auth.mjs` 内存 + `data/sessions.json` | 重启后从文件读回（**新方案**，已含） |

### 6.3 保证机制

#### A. 落盘路径强约束（已存在，需在文档里突出）

- `data/md/` `public/wechat/download/` 写在项目内、跟着 `cwd()` 走 → 无论服务从哪个目录启动，落盘位置不变（`storage.mjs` 用 `__dirname` 解析路径，已正确）
- `domain.mjs` 的 `.domain-cache.json` 同样基于 `cwd()`，已持久化
- `auth.mjs`（新）`data/auth.json` / `data/sessions.json` 同理

#### B. 测试覆盖（**新增 `tests/persistence.test.mjs`**）

| 用例 | 断言 |
| --- | --- |
| `落盘 + 重启后仍可读` | 模拟 `agent.downloadAndReply('https://mp.weixin.qq.com/s/x')` → 写文件 → 销毁所有内存引用 → 新进程读取 `data/index.json` 和 `public/wechat/download/<slug>.html` 都能拿到 |
| `html 文件路径约定` | `slug + '.html'` 必须落在 `public/wechat/download/`（不写到 tmp 或 cwd 根） |
| `index 镜像同步` | `mirrorIndexToPublic()` 后 `public/wechat/download/index.json` 与 `data/index.json` 内容一致 |
| `auth.json 0600` | 写入完成 → `fs.statSync().mode & 0o777 === 0o600` |
| `sessions.json 重启保留` | `createSession('a')` → 模拟重启（重新 `require('./auth.mjs')`）→ `getSession(sid)` 仍能拿到 |

#### C. DEPLOY.md 新增 §Y 数据持久化与备份

```markdown
## Y · 数据持久化与备份

### Y.1 持久化清单

| 数据 | 路径 | 备份频率建议 |
| --- | --- | --- |
| Markdown 原文 | `data/md/` | 周 |
| 文章 HTML | `public/wechat/download/` | 周 |
| 文章索引 | `data/index.json` | 周（**重要**，重建全靠它） |
| 镜像索引 | `public/wechat/download/index.json` | 同上 |
| 域名缓存 | `.domain-cache.json` | 无需备份 |
| 管理员密码 | `data/auth.json` | **请单独、安全备份** |
| session | `data/sessions.json` | 无需备份 |

### Y.2 备份脚本（建议）

```bash
#!/bin/bash
# backup-wechat-downloads.sh
DATE=$(date +%Y%m%d)
tar czf /path/to/backup/wxd-$DATE.tar.gz \
  data/md data/index.json data/auth.json \
  public/wechat/download
# 注意：sessions.json 和 .domain-cache.json 不在备份范围（重启会重建）
```

### Y.3 灾难恢复

1. 解压备份到新机器的 `wechat_downloads/` 目录
2. `npm install`
3. `PUBLIC_BASE_URL=https://your.domain WECHAT_BOT=1 pm2 start server.mjs --name wechat-downloads`
4. **不需要**重新扫码（admin 密码已在 `data/auth.json` 里）
5. **不需要**重新抓文章（HTML 和 MD 都在）

### Y.4 部署时的注意事项

- `git pull` 不会清掉 `data/` 和 `public/wechat/download/`（gitignore 已排除）
- 升级代码时**先备份再升级**，万一不兼容可回滚
- 不要把 `data/auth.json` 提交到 git（已 gitignore）
- 不要 `rm -rf data/` 或 `rm -rf public/wechat/download/`（除非你想清空归档）
```

#### D. README.md 新增"数据持久化"段

```markdown
## 数据持久化

所有归档数据（Markdown 原文、文章 HTML、索引）都写在项目内的 `data/` 和 `public/wechat/download/` 目录，
通过 pm2 / Docker / 服务器重启都不会丢失。

- 不会被 `git pull` 清掉（已被 `.gitignore` 排除）
- 不会被代码升级影响（应用代码与数据目录解耦）
- 备份只需 `tar czf backup.tar.gz data/ public/wechat/download/` 一行命令
- 灾难恢复无需重新抓文章、也无需重新扫码绑定

详见 `DEPLOY.md` §Y。
```

#### E. 控制台"系统状态"卡片增加数据目录信息

```
┌──────────────┐
│  系统状态    │
│  uptime: 12d │
│  Node: v22.x │
│  pid: 12345  │
│  data/: 42MB │  ← 新增
│  public/: 38MB│  ← 新增
│  共 23 篇    │
└──────────────┘
```

读 `fs.statSync` 递归算目录大小（仅顶层 entries，O(n) 但 n 是文件数）；超过 100MB 标黄提醒备份。

---

## 七、测试方案（汇总）

### 7.1 `tests/auth.test.mjs`（新增）

| 用例 | 断言 |
| --- | --- |
| `setup 写入并能 verify` | `setup('a','p1')` 后 `verify('a','p1') === true` |
| `verify 错密码返回 false` | `verify('a','p2') === false` |
| `isInitialized 状态切换` | 初次 false，setup 后 true |
| `session 增 / 查 / 续期 / 删` | `createSession('a')` → `getSession(sid)`；改 `now` 后过期 → null |
| `requireAuth 拦截未登录` | mock req/res，期望 302 /admin/login |
| `requireAuth 放行已登录` | mock cookie 携带合法 sid，期望 next() 被调用 |
| `setup 二次调用被拒` | 已初始化再调 `setup` → 抛 WXD-AUTH-0003 |
| `env 覆盖逃生口` | 设 `process.env.ADMIN_PASSWORD='x'` 后 `verify('a','x') === true` |
| `改密成功` | `changePassword(sid, 'p1', 'p2')` 后旧密码失败、新密码成功 |
| `改密时旧密码错` | 抛 WXD-AUTH-0001 |
| `auth.json 0600` | `fs.statSync().mode & 0o777 === 0o600` |

### 7.2 `tests/persistence.test.mjs`（新增）

详见 §六.B。

### 7.3 `tests/copy.test.mjs`（新增）

扫 `server.mjs` + `views/*.html` + `README.md` + `DEPLOY.md`：
- 断言**不存在**："免费公众号下载器"、"本机浏览器直读"、"一键留到本机"、"本地浏览器"
- 断言**存在**："微信公众号在线下载器"、"管理后台"、"扫码绑定"

### 7.4 回归

原有 47 个测试全部继续通过。

---

## 八、风险 & 回退

| 风险 | 缓解 |
| --- | --- |
| 自己改密码改错锁死 | env `ADMIN_PASSWORD` 启动绕过文件 |
| 浏览器关闭后又要重新登录 | 7 天滑动续期 |
| 服务重启把内存 session 清空 | session 写 `data/sessions.json`，启动时读回 |
| 改完文案漏掉角落 | `tests/copy.test.mjs` 强制断言 |
| `/admin/setup` 二次访问 | 已初始化再访问 → 302 `/admin/login` |
| `data/auth.json` 文件权限 | 写完后断言 `0o600`，否则抛错退出 |
| 升级代码时数据被误删 | DEPLOY.md §Y 强调"git pull 不影响数据"；建议升级前备份 |
| 灾难恢复时忘记备份密码 | DEPLOY.md §Y 单独强调 `data/auth.json` 要备份 |

回退：每一步都可单独 revert。`auth.mjs` 加在 server.mjs 里只是 `if (requireAuth(...)) return;` 的拦截，不影响现有路由逻辑。

---

## 九、开发任务拆分

```
T1. auth.mjs 核心（scrypt + session 文件持久化 + env 逃生口）  ~3h
T2. /admin/login /admin/setup /api/admin/login /api/admin/setup /admin/logout /api/admin/password 路由  ~2.5h
T3. server.mjs 接入 requireAuth 中间件 + 白名单 + auth.json 写入 0600  ~1.5h
T4. views/login.html + views/setup.html + views/admin-password.html（修改密码页，可选弹窗）  ~2h
T5. views/admin.html 改造成控制台（4 张卡片 + 顶部条 + 修改密码按钮）  ~2h
T6. views/admin-qr.html 加顶部条                       ~0.5h
T7. server.mjs renderHome() 顶部链接 + 文案替换         ~1h
T8. README.md / DEPLOY.md 文案替换 + DEPLOY.md §X 管理员账号 + §Y 数据持久化  ~2h
T9. tests/auth.test.mjs + tests/persistence.test.mjs + tests/copy.test.mjs  ~2.5h
```

总计 ~17h。建议顺序：T1 → T3 → T2 → T4 → T5 → T6 → T7 → T8 → T9。

---

## 十、与现有架构的依赖关系

| 现有文件 | 改动点 |
| --- | --- |
| `server.mjs` | 导入 `auth.mjs`、新增 6 个路由、`requireAuth` 中间件、`renderHome()` 文案 + 顶部链接 |
| `admin.mjs` | **不动**（鉴权层在外层包裹，admin 只管 SDK 调用） |
| `domain.mjs` | **不动**（但 admin.html 会读 `getCachedPublicBaseUrl()`） |
| `agent.mjs` | **不动**（bot 回执不需要鉴权，session 走自己的） |
| `storage.mjs` | **不动**（数据持久化机制本就是文件，已满足 §六） |
| `views/admin.html` | 从"介绍页"改成"控制台"（4 卡片 + 顶部条 + 文案 + 修改密码入口） |
| `views/admin-qr.html` | 仅加顶部条 |
| `views/list.html` | 仅文案（title / lead） |
| `views/admin-qr.html` 之外 | 不动 |
| `README.md` | 第 1 行、描述段、特性段、限制段 + 新增"数据持久化"段 |
| `DEPLOY.md` | § 一 项目简介、散落文案、新增 §X 管理员账号、新增 §Y 数据持久化与备份 |

零外部依赖（`crypto` Node 内置），不动 `package.json`。

---

## 十二、现有 UI 规范（必须遵守）

> 所有新增 / 修改的视图（`views/login.html`、`views/setup.html`、`views/admin.html` 改造、`views/admin-qr.html` 修改、可选 `views/admin-password.html`）**必须复用现有视觉语言**。禁止引入新字体、新配色、新组件样式，保证整个产品视觉一致。

### 12.1 必须复用的 CSS 变量

现有所有视图（`admin.html`、`admin-qr.html`、`list.html`、`server.mjs` 内嵌 home）的 `:root` 都一样：

```css
:root {
  --paper: #FDFBF7;        /* 主体背景，米黄 */
  --paper-deep: #F5F5F5;   /* 卡片 / 凹陷背景 */
  --ink: #1A1A1A;          /* 主文字色 */
  --pencil: #4A4A4A;       /* 次级文字色 */
  --soft: #9a9a9a;         /* 三级文字 / 禁用 */
  --border: #E0E0E0;       /* 普通边框 */
  --hl: #FFFF00;           /* 高亮底色（h1 mark） */
  --accent: #7A4A20;       /* 强调色（棕） */
  --err: #A93226;          /* 错误色 */
  --ok: #1F6B3A;           /* 成功色 */
  --reading: "Noto Serif SC", Georgia, "Songti SC", serif;
  --motion: none;          /* 全局禁用动画 */
}
```

> 新页面**必须**用这些变量。**禁止**新加 hex 色值。

### 12.2 必须复用的全局重置

```css
*, *::before, *::after {
  box-sizing: border-box;
  transition: none !important;
  animation: none !important;
}
```

> 全站动画 / 过渡已经全禁。新页面不能再开。

### 12.3 必须复用的布局骨架

```
<div class="wrap">              ← 主体容器（max-width 720/820/920px 按页面选）
  <header>
    <div class="hd-row">        ← flex space-between + flex-wrap + gap:18
      <div class="brand">
        <span class="mark">免</span>  ← 28x28 边框方块图标
        微信公众号在线下载器
      </div>
      <div class="hd-links">    ← 头部右侧动作组
        <a class="blog-link">…</a>
      </div>
    </div>
  </header>

  <main class="wrap">           ← 注意 main 也加 .wrap，admin-qr 是这样
    <span class="eyebrow">ADMIN · SIGN IN</span>  ← 小号大写类别
    <h1>标题<mark>强调</mark></h1>               ← 标题 + 黄底高亮
    <p class="lead">副标题段落</p>                 ← 灰色、宽度受限
    <!-- 主要内容 -->
  </main>
</div>
```

### 12.4 必须复用的组件类

| 类 | 用途 | 适用页面 |
|---|---|---|
| `.blog-link` | 头部 / 页脚的小药丸按钮 | 所有页面的动作（管理后台、GitHub、退出、修改密码） |
| `.eyebrow` | 小号大写类别标签 | 所有页面标题上方 |
| `.panel` | 带边框卡片 | 控制台 4 张卡片（如换这种容器） |
| `.cta` | 主行动按钮（带 → 后缀） | "开始扫码"、"登录"、"完成设置" |
| `.note` | 灰底提示条（左侧 3px 棕条） | 错误、说明、操作提示 |
| `.kv` | monospace key-value 网格 | 路由速览、状态键值 |
| `.formgrid` + `.fieldlabel` + `.cta` | 表单三件套 | 登录 / 设置 / 改密 表单 |
| `.err` | 错误块（monospace） | 错误码展示 |
| `.stage` + `.dot.on` | 阶段指示器（扫码状态） | admin-qr.html 复用 |

### 12.5 必须复用的图标 / favicon

```html
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
  <rect width='64' height='64' fill='#FDFBF7' stroke='#1A1A1A' stroke-width='4'/>
  <text x='32' y='46' text-anchor='middle' font-family='serif' font-weight='900' font-size='40' fill='#1A1A1A'>免</text>
</svg>">
```

> 所有页面统一 favicon。`<span class="mark">免</span>` 在 brand 区域是同一图标的方块版。

### 12.6 `<title>` 格式

`<title>{页面名} · 微信公众号在线下载器</title>`

| 路由 | title |
|---|---|
| `/` | `微信公众号在线下载器` |
| `/admin/login` | `管理员登录 · 微信公众号在线下载器` |
| `/admin/setup` | `设置管理员账号 · 微信公众号在线下载器` |
| `/admin/password` | `修改密码 · 微信公众号在线下载器` |
| `/admin` | `管理后台 · 微信公众号在线下载器` |
| `/admin/qr` | `扫码绑定微信 · 微信公众号在线下载器` |
| `/wechat/download` | `已收录文章 · 微信公众号在线下载器` |

### 12.7 错误展示规范

错误用 `<div class="note err">` 或 `<pre class="err">`，**monospace 字体**（`ui-monospace, Consolas, monospace`），分行展示 `error_code` / `message` / `stage` / `request_id`，与 admin-qr.html 现有 `.err` 块完全一致：

```html
<pre class="err">[WXD-AUTH-0001] 用户名或密码错误
stage: auth.mjs#verify
request_id: 1f4e7a8b-…</pre>
```

### 12.8 卡片 / 网格样式参考

控制台 4 张卡片建议统一用 `.panel` 类：

```css
.panel {
  border: 1px solid var(--ink);
  background: var(--paper);
  padding: 24px 22px;
  border-radius: 3px;
}
.panel h2 {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: .05em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
}
.panel .stat {
  font: 600 24px/1.2 ui-monospace, Consolas, monospace;
  color: var(--ink);
}
.panel .stat-label {
  font-size: 13px;
  letter-spacing: .3em;
  color: var(--pencil);
  text-transform: uppercase;
}
```

外层用 `display: grid; grid-template-columns: 1fr 1fr; gap: 18px;`（窄屏 `flex-direction: column`）。

### 12.9 不允许的写法

- ❌ 引入新字体（必须复用 `var(--reading)` 或 `ui-monospace, Consolas, monospace`）
- ❌ 引入新 hex 颜色（必须用现有 CSS 变量）
- ❌ 引入动画 / 过渡（全局已 `transition: none !important`）
- ❌ 改 favicon
- ❌ 用 flexbox / grid 之外的花式布局（如 `float`、绝对定位堆叠）
- ❌ 引入 JS 框架（保持原生 `<script>`）
- ❌ 引入新图标（除现有 favicon 外不再加图标资源）

### 12.10 抽离复用 CSS 的可选重构（非必需）

> v3 阶段**暂不抽离**。所有视图（包括 home 内嵌 CSS）各自保留 `:root` + 重置，代价是文件间重复 ~60 行 CSS。后续如果新增第 6 个视图再考虑抽 `views/_shared.css` 用 `<link>` 引入。**当前阶段保持现状，新增视图复制 `:root` 与重置即可。**

---

## 十三、迁移指南（v2 → v4）

> 适用于已经在 v2（无鉴权）部署基础上升级到 v3 的用户。

### 14.1 升级流程

```bash
cd /path/to/wechat_downloads

# 1. 备份现有数据（保险）
tar czf ~/wxd-backup-$(date +%Y%m%d).tar.gz data/ public/wechat/download/

# 2. 拉取新代码
git pull origin main

# 3. 安装新依赖（如有）
npm install

# 4. 重启服务
pm2 restart wechat-downloads --update-env

# 5. 首次访问 https://your.domain/admin
#    → 跳转 /admin/setup
#    → 设置用户名 + 密码（≥ 8 位）
#    → 自动登录，进入控制台
```

### 14.2 不需要做的事

- ❌ 不需要重新扫码绑定微信（`isLoggedIn()` 状态由 SDK 自己持久化在 user data 目录）
- ❌ 不需要重新抓文章（`data/md/` 和 `public/wechat/download/` 都保留）
- ❌ 不需要改 `PUBLIC_BASE_URL`

### 14.3 常见问题

| 问题 | 解决 |
|---|---|
| 升级后访问 /admin 没跳 /admin/setup | 检查 `pm2 logs`，看是否有 `WXD-AUTH-0004`（auth.json 损坏）；删 `data/auth.json` 重新走 setup |
| 升级前设过 ADMIN_PASSWORD env | env 仍生效（逃生口），可直接登录；登录后到控制台改密 |
| 多个浏览器 / 设备同时登录 | 都支持，互不干扰；改密会销毁其他设备 session（13.2） |
| 升级后控制台显示"未绑定"但之前扫过码 | 重新访问 /admin/qr 扫一次即可（v3 未引入 SDK 状态变更） |

### 14.4 运维 Runbook

| 场景 | 操作 |
|---|---|
| 改密码 | 控制台 /admin → "修改密码" → 输旧密码 + 新密码 |
| 忘记密码 | 服务器上 `ADMIN_PASSWORD=新密码 pm2 restart wechat-downloads --update-env` |
| 看当前会话 | 控制台"系统状态"卡片显示 uptime / 数据目录大小 |
| 看登录失败记录 | `cat data/auth-failures.json` 或 `data/admin.log`（13.7） |
| 备份 | `tar czf backup.tar.gz data/ public/wechat/download/` |
| 恢复 | 解压 backup.tar.gz → pm2 restart |
| 重置所有 admin 状态 | `rm data/auth.json data/sessions.json data/admin.log data/auth-failures.json` → 重启 → 重新 /admin/setup |
| 健康检查 | `curl https://your.domain/healthz` |

---



## 十四、修订记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-09-18 | 草案：把首页改成控制台 |
| v2 | 2026-09-18 | 调整：两条产品线分开，主页保留为公开下载器，控制台独立 `/admin` |
| v3 | 2026-09-18 | 定稿：8 项决策确定、密码存储细节展开（0600 + env 逃生口）、新增"数据持久化"章节 |
| v4 | 2026-09-18 | 新增 §十二 现有 UI 规范、§十三 迁移指南；显式记录必须复用 CSS 变量 / 组件类 / favicon / 标题格式 |
