# 需求摘要（requirements.md）

> 由 super-agent 的 planner 智能体生成（02 批次）
> 用途：每阶段的需求摘要 + 在原需求文档里的章节定位，主智能体通过此文件告诉子智能体"读 §X.Y"
> 需求文档：`D:\github\wechat_downloads\DEV_PLAN_AUTH.md`（v3 定稿方案）

## 阶段摘要

每个阶段一段，包含：阶段目标、可量化验收标准、需求文档章节定位。

### P0 — 公共脚手架（planner 完成）

- 阶段目标：初始化本批次 plan / spec / requirements；沿用 01 批次 WXD 错误码体系与项目脚手架
- 子任务：
  - task1：写 plan/dev-plan.md + plan/dev-spec.md + plan/requirements.md
- 验收标准：
  - 三份核心规划文件全部生成且内容对齐 DEV_PLAN_AUTH §〇 + §三 + §四 + §六 + §十一 + §十二 + §十三
  - 沿用 01 批次既有的 `lessons-learned.md` / `context7-record.md` / `logs/main-log.md`（不重写）
- 涉及需求文档章节：§〇 决策定稿 + §十一 整体验收清单
- 完成时间：2026-09-18 12.51

### P1 — auth-core（auth.mjs 核心）

- 阶段目标：实现 scrypt 密码哈希 + session 增删查 + requireAuth 中间件 + isInitialized 检测 + changePassword + env 逃生口
- 子任务：
  - task2：auth.mjs 全功能实现
- 验收标准：
  - 新增 `auth.mjs`，至少导出 `isInitialized()` `hashPassword(pwd, salt)` `verifyPassword(pwd, hash)` `createSession(user)` `getSession(sid)` `destroySession(sid)` `requireAuth(req, res)` `changePassword(oldPwd, newPwd)` `hasEnvOverride()`
  - scrypt 参数固定 `{ N: 16384, r: 8, p: 1, keylen: 32 }`；salt `crypto.randomBytes(16)`；verify 用 `timingSafeEqual`
  - `data/auth.json` 写入用 `mode: 0o600`；写完断言 `fs.statSync().mode & 0o777 === 0o600`
  - session 默认 7 天滑动续期；cookie 名 `wxd_sid`，属性 `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
- 涉及需求文档章节：§〇 Q3/Q4/Q5/Q7/Q8、§四（含 §4.1~§4.4 密码存储细节）、§八 路由守卫

### P2 — auth-routes（路由接入）

- 阶段目标：在 server.mjs 注入 requireAuth 中间件 + 6 个新路由 + 主页右上角入口链接
- 子任务：
  - task3：server.mjs 路由与中间件改造
- 验收标准：
  - 路由新增：`GET /admin/login` `POST /api/admin/login` `GET /admin/logout` `GET /admin/setup` `POST /api/admin/setup` `POST /api/admin/password`
  - 守卫白名单（公开）：`/`、`/admin/login`、`/api/admin/login`、`/admin/setup`、`/api/admin/setup`、`/admin/logout`、`/wechat/download` 系列、`/assets/*`、`POST /download`
  - 守卫路径（需登录）：`/admin`、`/admin/qr`、`/admin/qr/start`、`/admin/qr/status`、所有 `/api/admin/*`（除 login/setup）
  - 主页 `.hd-links` 插入 `<a class="blog-link" href="/admin">管理后台 →</a>`
- 涉及需求文档章节：§三（含 §3.1 路由表 + §3.2 中间件顺序 + §3.3 主页入口）、§八 路由守卫、§九 UI 入口

### P3 — admin-console（控制台首页改版）

- 阶段目标：views/admin.html 从"扫码介绍页"改"控制台首页"，加 4 卡片 + 顶部用户态 + 修改密码入口
- 子任务：
  - task4：admin.html 改造
- 验收标准：
  - 4 张卡片：①扫码绑定微信 ②已收录文章 ③公网域名 ④系统状态（uptime / Node 版本 / pid / 数据目录大小）
  - 顶部条加"当前：<b><%= username %></b>" + "退出" + "修改密码"
  - `.panel` 类样式严格按 §十二.8 复用；CSS 变量复用现有
- 涉及需求文档章节：§一.3、§五（含 §5.1~§5.6 控制台结构）、§十 状态卡片、§十二（含 §12.1~§12.10 UI 规范）

### P4 — admin-topbar（扫码页 + 列表页顶部条）

- 阶段目标：admin-qr.html 与 list.html 加顶部用户态条（保持列表结构不变）
- 子任务：
  - task5：admin-qr.html + list.html 顶部条
- 验收标准：
  - admin-qr.html 加"当前：<b><%= username %></b>" + "退出" + "修改密码"
  - list.html 加同款顶部条（仅"返回控制台"链接，避免暴露 username）
  - 不动 list.html 列表结构、不动 admin-qr.html 既有轮询逻辑
- 涉及需求文档章节：§五.6 顶部条、§十二.5 卡片规范、§一.4

### P5 — home-entry（主页入口）

- 阶段目标：主页文案替换 + 加"管理后台 →"链接
- 子任务：
  - task6：server.mjs#renderHome 改造
- 验收标准：
  - 标题替换：`<title>微信公众号在线下载器 · …</title>`
  - `.h1` / `.lead` 文案按 §十二.6 文案表替换
  - `.hd-links` 插入 `<a class="blog-link" href="/admin">管理后台 →</a>`
  - 不动表单 / 按钮 / 解析 / 抓取 / 下载结构
- 涉及需求文档章节：§一.3、§十一.2、§十二.6 文案、§三.3

### P6 — persistence（数据持久化保证）

- 阶段目标：落盘时机 + atomic rename + 启动重读 + 备份恢复策略文档
- 子任务：
  - task7：auth.mjs / storage.mjs 落盘强化 + DEPLOY.md §Y 草案
- 验收标准：
  - `auth.mjs`：`data/auth.json` / `data/sessions.json` 写入用 atomic rename；目录不存在时 `mkdirSync({ recursive: true, mode: 0o700 })`
  - `auth.mjs` 启动时若文件存在 → 读回 session 进内存 Map
  - 启动后写盘仅落内存 + 文件，避免热路径同步 IO
  - `.gitignore` 确认已含 `data/auth.json` / `data/sessions.json` / `data/md/` / `public/wechat/download/*.html` / `public/wechat/download/*.json`
- 涉及需求文档章节：§六（含 §6.1~§6.3 保证机制 + §6.C DEPLOY §Y + §6.D README 段 + §6.E 控制台状态卡片）

### P7 — tests（测试套件）

- 阶段目标：新增 auth.test.mjs + persistence.test.mjs + copy.test.mjs + 整合既有 43 单测回归
- 子任务：
  - task8：测试开发与执行
- 验收标准：
  - `tests/auth.test.mjs` ≥ 10 个 node:test
    - scrypt 哈希正确性 / 错误密码拒绝 / timingSafeEqual 一致性
    - session create/get/destroy + 滑动续期 + 过期清理
    - requireAuth 未登录 302 / 已登录通过 / 未初始化访问受保护路径 302 /admin/setup
    - changePassword 旧密码错误 → WXD-AUTH-0005 / 新密码长度 < 8 → WXD-AUTH-0006 / 改密后销毁其他 sid
    - auth.json 写完后 mode === 0o600（Unix only）
    - env 覆盖：ADMIN_PASSWORD 非空时 verify 优先用 env
  - `tests/persistence.test.mjs` ≥ 5 个 node:test（对齐 §六.B 表格）
  - `tests/copy.test.mjs` 扫所有 `*.html` / `*.md`，禁止 §十二.6 旧文案命中
  - 既有 43 个单测（domain 8 / storage 21 / agent 9 / http-routes 5）全部回归通过
- 涉及需求文档章节：§三.4 验收、§六.B 测试覆盖、§十二.6 文案断言

### P8 — docs（README + DEPLOY + 迁移指南）

- 阶段目标：README + DEPLOY 同步 + 新增 MIGRATION.md（v2 → v4 迁移指南）
- 子任务：
  - task9：文档同步
- 验收标准：
  - `DEPLOY.md` 新增 §Y 数据持久化与备份（含 §Y.1 持久化清单 / §Y.2 备份脚本 / §Y.3 灾难恢复 / §Y.4 注意事项）
  - `README.md` 第一行 / 描述 / 特性 / 限制同步替换 + 加"数据持久化"段
  - 新增 `MIGRATION.md`（v2 → v4 迁移指南，含 §13.1 升级流程 / §13.2 不需要做的事 / §13.3 常见问题 / §13.4 运维 Runbook）
  - 任意域名部署无需改代码（env 或 Nginx 头）
- 涉及需求文档章节：§六.C、§六.D、§十三（含 §13.1~§13.4）

### P9 — e2e（整体集成 + 控制台拆分回归）

- 阶段目标：整体集成 + 控制台拆分回归测试 + 端到端跑通
- 子任务：
  - task10：tester 主导，不写新业务代码
- 验收标准：
  - 启动 `WECHAT_BOT=1 npm start`，本地 3915 端口起来
  - 浏览器 `/admin` → 302 `/admin/setup`（首次）
  - 完成 setup → 自动登录 → 控制台 4 卡片数据正确
  - 改密生效 + 旧 session 销毁
  - 退出登录 → `/admin/login` → 重登 → 控制台 4 卡片仍然正确
  - 浏览器 `/admin/qr` 出 QR（人工扫码）
  - 微信端发样例 `https://mp.weixin.qq.com/s/FtWvOWI2kVVS_1sQiKNWbw`：回执仅为一行 URL + 归档落盘 + 列表展示
  - 模拟 pm2 restart：重启后 `/api/admin/me` 仍能拿到当前用户
  - §十一 整体验收清单逐项打勾
- 涉及需求文档章节：§十一 整体验收清单、§一.3、§六 持久化保证、§十二 UI 规范

## 主智能体使用方式

主智能体在调度子智能体时，从本表查"涉及需求文档章节"字段，把它和必读文件路径一起传给子智能体。子智能体按章节定位读需求文档，**避免读全文污染上下文**。

## 完整需求文档路径

`D:\github\wechat_downloads\DEV_PLAN_AUTH.md`（v3 定稿方案；主智能体持有完整路径，不读全文）