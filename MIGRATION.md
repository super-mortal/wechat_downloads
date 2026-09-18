# 迁移指南：无鉴权版（v2）→ 带鉴权版（v4）

> 适用于已经在 v2 部署基础上升级到 v4 的用户。

## 升级流程

```bash
cd /path/to/wechat_downloads

# 1. 备份现有数据
tar czf ~/wxd-backup-$(date +%Y%m%d).tar.gz data/ public/wechat/download/

# 2. 拉取新代码
git pull origin main

# 3. 安装新依赖（如有）
npm install

# 4. 重启服务
pm2 restart wechat-downloads --update-env

# 5. 首次访问 https://your.domain/admin
#    → 自动跳转 /admin/setup
#    → 设置用户名 + 密码（≥ 8 位）
#    → 自动登录，进入控制台
```

## 不需要做的事

- ❌ 不需要重新扫码绑定微信（`isLoggedIn()` 状态由 SDK 自己持久化在 user data 目录）
- ❌ 不需要重新抓文章（`data/md/` 和 `public/wechat/download/` 都保留）
- ❌ 不需要改 `PUBLIC_BASE_URL`

## 常见问题

| 问题 | 解决 |
|---|---|
| 升级后访问 /admin 没跳 /admin/setup | 检查 `pm2 logs`，看是否有 `WXD-AUTH-0006`（auth.json 损坏）；删 `data/auth.json` 重新走 setup |
| 升级前设过 ADMIN_PASSWORD env | env 仍生效（逃生口），可直接登录；登录后到控制台改密 |
| 多个浏览器 / 设备同时登录 | 都支持，互不干扰；改密会销毁其他设备 session |
| 升级后控制台显示"未绑定"但之前扫过码 | 重新访问 /admin/qr 扫一次即可（v4 未引入 SDK 状态变更） |

## 运维 Runbook

| 场景 | 操作 |
|---|---|
| 改密码 | 控制台 /admin → "修改密码" → 输旧密码 + 新密码 |
| 忘记密码 | 服务器上 `ADMIN_PASSWORD=新密码 pm2 restart wechat-downloads --update-env` |
| 看当前会话 | 控制台"系统状态"卡片显示 uptime / 数据目录大小 |
| 看登录失败记录 | `cat data/auth-failures.json` 或 `data/admin.log` |
| 备份 | `node -e "import('./storage.mjs').then(m => m.backupDataDir('./backups/$(date +%Y%m%d)'))"` |
| 恢复 | `node -e "import('./storage.mjs').then(m => m.restoreDataDir('./backups/20260101/wxd-backup.zip'))"` |
| 重置所有 admin 状态 | `rm data/auth.json data/sessions.json data/admin.log data/auth-failures.json` → 重启 → 重新 /admin/setup |
| 健康检查 | `curl https://your.domain/healthz` |

## 修订记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v4 | 2026-09-18 | 新增管理员鉴权 + 控制台拆分 + 数据持久化保证 + 迁移指南 |
