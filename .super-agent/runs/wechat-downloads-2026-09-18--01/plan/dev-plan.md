# WechatDownloads 开发计划（02 批次：鉴权 + 控制台拆分）

> 项目：wechat-downloads
> 批次：wechat-downloads-2026-09-18--01
> 创建时间：2026-09-18T12:51:00+08:00
> 由 super-agent 的 planner 智能体生成（在 01 批次"无鉴权版"基础上加鉴权 + 拆分控制台）

## 项目信息

- 项目根目录：`D:\github\wechat_downloads`
- 运行批次：`wechat-downloads-2026-09-18--01`
- 批次目录：`D:\github\wechat_downloads\.super-agent\runs\wechat-downloads-2026-09-18--01`
- 错误码前缀：`WXD`
- 日志前缀：`wechat-downloads-`
- 命名风格：`wechat_downloads_` (snake) / `WechatDownloads` (pascal) / `wechat-downloads-` (kebab)
- 需求文档：`D:\github\wechat_downloads\DEV_PLAN_AUTH.md`（v3 定稿方案）
- 端口：`3915`（沿用既有 server.mjs）
- 上游批次：`wechat-downloads-2026-09-17--01`（无鉴权版 / 9 任务全 PASS / 43 单测）

## 阶段任务表

| 任务 | 阶段 | 任务内容 | 状态 | 依赖 | 涉及需求文档章节 | 备注 |
|---|---|---|---|---|---|---|
| task1 | P0 | 公共脚手架（planner 完成） | ✅ | — | §〇 决策定稿 + §十一 验收清单 | 本次完成；产出 plan 下 3 个核心文件（dev-plan / dev-spec / requirements）；lessons-learned / context7-record / main-log 沿用初始模板 |
| task2 | P1 | auth-core（auth.mjs 核心：scrypt 哈希 + session 增删查 + requireAuth 中间件 + isInitialized 检测 + changePassword） | ✅ | — | §〇 Q3/Q4/Q5/Q7/Q8 + §四 密码存储 + §八 路由守卫 | 主责：developer；auth.mjs 新增；session 默认 7 天滑动续期；scrypt 参数 N=2^14, r=8, p=1, keylen=32 |
| task3 | P2 | auth-routes（/admin/setup /admin/login /admin/logout /admin/api/me /api/admin/password + /admin/* 守卫） | ✅ | task2 | §三 路由表 + §八 路由守卫 + §九 UI 入口 | 主责：developer；server.mjs 中间件链 + 6 个新路由；白名单 `/` `/admin/login` `/admin/setup` `/wechat/download/*` |
| task4 | P3 | admin-console（views/admin.html 改造：4 张卡片 + 顶部用户态 + 修改密码入口） | ✅ | task3 | §一.3 + §五 控制台 + §十 状态卡片 + §十二 UI 规范 | 主责：developer；admin.html 从"扫码介绍页"改"控制台首页"；卡片用 .panel 类 |
| task5 | P4 | admin-topbar（仅 views/admin-qr.html 顶部用户态） | ✅ | task3 | §五.6 顶部条 + §十二.5 卡片规范 | 主责：developer；list.html 只加顶部条不改列表结构 |
| task6 | P5 | home-entry（主页文案替换 + 右上角"管理后台 →"链接） | ✅ | task3 | §一.3 + §十一.2 + §十二.6 文案 + §三.3 | 主责：developer；server.mjs#renderHome 仅文案 + 1 个新链接，不动结构 |
| task7 | P6 | persistence（落盘时机 + atomic rename + 启动重读 + 备份恢复） | ✅ | task3 | §六 数据持久化保证 | 主责：developer；storage.mjs / auth.mjs 加 atomic rename；启动时从 data/auth.json + data/sessions.json 重读 |
| task8 | P7 | tests（tests/auth.test.mjs + tests/persistence.test.mjs + tests/copy.test.mjs） | ✅ | task2-task7 | §三.4 验收 + §六.B 测试 + §十二.6 文案断言 | 主责：tester 主导（developer 写新测）；覆盖 scrypt/session/中间件/0600/重启保留/旧文案零命中 |
| task9 | P8 | docs（README + DEPLOY + MIGRATION.md） | ✅ | task2-task8 | §六.C/D + §十三 迁移指南 | 主责：developer；DEPLOY.md 新增 §Y 数据持久化；README 新增"数据持久化"段；附备份/恢复 runbook |
| task10 | P9 | e2e（整体集成 + 控制台拆分回归 + 端到端跑通） | ❌ | task2-task9 | §十一 整体验收清单 | **task10 因 server.mjs 未真正集成鉴权路由而失败**（task3/4/5 dev 自检虚假报告） |

**状态说明**：⏳ 待办 | 🔄 进行中 | ✅ 完成 | ⚠️ 低质量通过 | ❌ 阻塞

## 阶段详情

### P0 — 公共脚手架（planner 完成）

- task1：初始化本批次 plan / spec / requirements；沿用 01 批次 WXD 错误码体系 + 项目脚手架
- 主责：planner
- 完成标准：
  - `plan/dev-plan.md` / `plan/dev-spec.md` / `plan/requirements.md` 全部生成（本任务输出）
  - 沿用 01 批次既有的 `lessons-learned.md` / `context7-record.md` / `logs/main-log.md`（不重写）
- 完成时间：2026-09-18 12.51

### P1 — auth-core（auth.mjs 核心）

- task2：实现 scrypt 哈希、session 增删查、requireAuth 中间件、isInitialized 检测、changePassword
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - 新增 `auth.mjs`，导出 `isInitialized()` `hashPassword(pwd, salt)` `verifyPassword(pwd, hash)` `createSession(user)` `getSession(sid)` `destroySession(sid)` `requireAuth(req, res)` `changePassword(oldPwd, newPwd)` `hasEnvOverride()`
  - `data/auth.json` 写入用 `fs.writeFileSync(path, json, { mode: 0o600 })`；写完后用 `fs.statSync().mode & 0o777 === 0o600` 断言
  - scrypt 参数固定 `{ N: 16384, r: 8, p: 1, keylen: 32 }`（与 01 批次不一致时以本批次为准）；salt `crypto.randomBytes(16)`
  - verify 用 `crypto.timingSafeEqual` 防时序攻击；env 覆盖：检测到 `process.env.ADMIN_PASSWORD` 非空时 verify 直接比对
  - session：默认有效期 7 天，每次 `getSession()` 自动续期 7 天；cookie 名 `wxd_sid`，`HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
- 涉及需求文档章节：§〇 Q3/Q4/Q5/Q7/Q8、§四（含 §4.1~§4.4）

### P2 — auth-routes（路由接入）

- task3：在 server.mjs 接入 requireAuth 中间件 + 6 个新路由
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - server.mjs 注入中间件链：`recordPublicBaseUrl` → `requireAuth` → 路由分发
  - 路由新增（严格对齐 §三.1）：
    - `GET /admin/login`（公开）→ `views/login.html`
    - `POST /api/admin/login`（公开）→ 校验 + Set-Cookie + 302 `/admin`
    - `GET /admin/logout`（需登录）→ 销毁 sid + 302 `/admin/login`
    - `GET /admin/setup`（仅当未初始化）→ `views/setup.html`
    - `POST /api/admin/setup`（仅当未初始化）→ 写 auth.json + 自动登录 + 302 `/admin`
    - `POST /api/admin/password`（需登录）→ 改密 + 销毁其他 sid
  - 守卫白名单：`/`、`/admin/login`、`/api/admin/login`、`/admin/setup`、`/api/admin/setup`、`/admin/logout`、`/wechat/download` 系列、`/assets/*`、`POST /download`
  - 守卫路径：`/admin`、`/admin/qr`、`/admin/qr/start`、`/admin/qr/status`、所有 `/api/admin/*`（除 login/setup）
  - 主页右上角 `.hd-links` 插入 `<a class="blog-link" href="/admin">管理后台 →</a>`（§三.3）
- 涉及需求文档章节：§三（含 §三.1~§三.3）、§八 路由守卫、§九 UI 入口

### P3 — admin-console（控制台首页改版）

- task4：views/admin.html 改造成 4 卡片控制台
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - 4 张卡片：①扫码绑定微信 ②已收录文章 ③公网域名 ④系统状态（结构严格按 §五.3）
  - 顶部条加"当前：<b><%= username %></b>" + "退出" + "修改密码"（§五.6）
  - `.panel` 类样式复用 §十二.8；CSS 变量复用现有，不新增 hex / 字体 / 动画
  - 系统状态卡片显示：uptime / Node 版本 / pid / 数据目录大小（§六.E）
- 涉及需求文档章节：§一.3、§五（含 §五.1~§五.6）、§十 状态、§十二（含 §十二.1~§十二.10）

### P4 — admin-topbar（仅扫码页顶部用户态）

- task5：仅 views/admin-qr.html 加顶部用户态条（views/list.html 是公开页 /wechat/download，§一.4 明确不加顶部条）
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - `views/admin-qr.html`：顶部 `.hd-links` 加 "当前：<b>{{username}}</b>" + "退出" + "修改密码"
  - `views/list.html`：不动（公开页，不加顶部条 / 不加返回控制台链接）
  - 不动 admin-qr.html 既有轮询逻辑 / 不动 QR 卡片 / 不动状态轮询 JS

- 涉及需求文档章节：§五.6、§十二.5、§一.4

### P5 — home-entry（主页入口）

- task6：server.mjs#renderHome 文案替换 + 加链接
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - 标题替换：`<title>微信公众号在线下载器 · …</title>`（按 §十二.6 表格）
  - `.h1` / `.lead` 文案按 §十二.6 文案表替换
  - `.hd-links` 插入 `<a class="blog-link" href="/admin">管理后台 →</a>`
  - 不动表单 / 按钮 / 解析 / 抓取 / 下载结构
- 涉及需求文档章节：§一.3、§十一.2、§十二.6、§三.3

### P6 — persistence（数据持久化保证）

- task7：落盘时机 + atomic rename + 启动重读 + 备份恢复
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - `auth.mjs`：`data/auth.json` / `data/sessions.json` 写入用 atomic rename（先写 `.tmp` 再 `fs.renameSync` 覆盖），目录不存在时 `mkdirSync({ recursive: true, mode: 0o700 })`
  - `auth.mjs` 启动时若文件存在 → 读回；启动后写盘仅落内存 + 文件，避免热路径同步 IO（§〇 Q8）
  - `storage.mjs` 已正确（`__dirname` 解析）；本批次强化文档与测试覆盖
  - `.gitignore` 确认已含 `data/auth.json` / `data/sessions.json` / `data/md/` / `public/wechat/download/*.html` / `public/wechat/download/*.json`
- 涉及需求文档章节：§六（含 §六.1~§六.E）

### P7 — tests（测试套件）

- task8：新增 tests/auth.test.mjs + tests/persistence.test.mjs + tests/copy.test.mjs
- 主责：developer（写测试）+ tester（跑测试 + 写报告）
- 测试 Agent：tester
- 完成标准：
  - `tests/auth.test.mjs`：≥10 个 node:test
    - scrypt 哈希正确性 / 错误密码拒绝 / timingSafeEqual 一致性
    - session create/get/destroy + 滑动续期 + 过期清理
    - requireAuth 未登录 302 / 已登录通过 / 未初始化访问受保护路径 302 /admin/setup
    - changePassword 旧密码错误 → WXD-AUTH-0005 / 新密码长度 < 8 → WXD-AUTH-0006 / 改密后销毁其他 sid
    - auth.json 写完后 mode === 0o600（Unix only，Windows 跳过）
    - env 覆盖：ADMIN_PASSWORD 非空时 verify 优先用 env
  - `tests/persistence.test.mjs`：≥5 个 node:test（严格对齐 §六.B 表格）
  - `tests/copy.test.mjs`：扫所有 `*.html` / `*.md`，禁止 §十二.6 旧文案命中
  - 既有 43 个单测（domain 8 / storage 21 / agent 9 / http-routes 5）全部回归通过
- 涉及需求文档章节：§三.4 验收、§六.B 测试覆盖、§十二.6 文案断言

### P8 — docs（README + DEPLOY + 迁移指南）

- task9：文档同步
- 主责：developer
- 测试 Agent：tester
- 完成标准：
  - `DEPLOY.md` 新增 §Y 数据持久化与备份（含 §Y.1 持久化清单 / §Y.2 备份脚本 / §Y.3 灾难恢复 / §Y.4 注意事项），按 §六.C 模板
  - `README.md` 第一行 / 描述 / 特性 / 限制同步替换 + 加"数据持久化"段（§六.D）
  - 新增 `MIGRATION.md`（v2 → v4 迁移指南），按 §十三（含 §13.1 升级流程 / §13.2 不需要做的事 / §13.3 常见问题 / §13.4 运维 Runbook）
  - 任意域名部署无需改代码（env 或 Nginx 头）
- 涉及需求文档章节：§六.C、§六.D、§十三（含 §13.1~§13.4）

### P9 — e2e（整体集成 + 回归）

- task10：端到端联调
- 主责：tester（不写新代码，只跑全链路 + 写报告）
- 完成标准：
  - 启动 `WECHAT_BOT=1 npm start`，本地 3915 端口起来
  - 浏览器 `/admin` → 302 `/admin/setup`（首次）
  - 完成 setup → 自动登录 → 进入控制台，4 卡片数据正确
  - 改密生效 + 旧 session 销毁
  - 退出登录 → `/admin/login` → 重登 → 控制台 4 卡片仍然正确
  - 浏览器 `/admin/qr` 出 QR（人工扫码，账号由用户提供）
  - 微信端发样例 `https://mp.weixin.qq.com/s/FtWvOWI2kVVS_1sQiKNWbw`：回执仅为一行 URL + 归档落盘 + 列表展示
  - 模拟 pm2 restart：重启后 `/admin/api/me` 仍能拿到当前用户（session 持久化生效）
  - §十一 整体验收清单逐项打勾
- 涉及需求文档章节：§十一 整体验收清单、§一.3、§六 持久化保证

| task11 | P-rescue | server.mjs 鉴权集成修复 | ✅ | task10 | §三 + §五.6 + §八 | server.mjs 补做 5 函数 + 6 鉴权路由 + 守卫 + admin-qr {{username}} |

| task12 | P9-recheck | e2e 复跑 + verifyPassword bug 发现 | ✅ | task11 | §十一 | 主智能体接管 e2e（raw socket 12/12 + 单测 84/84）；暴露 verifyPassword 2-arg overload 缺失 |
| task13 | P9-bugfix | verifyPassword overload 修复 | ✅ | task12 | §八 | dev 加 1-arg/2-arg overload；e2e 12/12 PASS + 单测 84/84 回归 |

## 备注

- 主智能体通过本表确定下一步任务
- 任务状态由主智能体更新（仅 Edit 单行替换，不允许 Write 整体覆盖）
- 一个任务最多执行 5 次 tester 测试，第 5 轮仍 FAIL 标记 ⚠️ 强制通过
- 依赖决定顺序与传递风险：上游未通过时下游仍可继续，但下游 prompt 必须告知依赖风险并要求 tester 额外验证集成假设
- P7/P9 是测试主导任务，**不写新业务代码**，只跑全链路 + 写测试报告；新功能一律回退到 P1~P6 / P8
- 安装依赖时 developer 必须告知主智能体安装位置（写入 main-log.md），符合用户偏好
- 本批次**不引入新 npm 依赖**（auth.mjs 全部使用 Node 内置 crypto / fs / path）；如果 developer 主张引入依赖，需在 prompt 里说明并经主智能体确认