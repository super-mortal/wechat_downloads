# wechat-downloads-2026-09-17--01 批次最终报告

> 批次：wechat-downloads-2026-09-17--01
> 项目：wechat-downloads
> 完成时间：2026-09-17T23:46:55+08:00

## 总览

| 总任务 | PASS | 低质量通过 (⚠️) | 阻塞 (❌) |
|---|---|---|---|
| 9 | 9 | 0 | 0 |

## 任务清单

| # | 阶段 | 模块 | 结果 | 测试轮次 | 测试报告 |
|---|---|---|---|---|---|
| task1 | P0 | 公共基础设施（planner） | ✅ | N/A | — |
| task2 | P1 | deps-weixin-login | ✅ | 1 轮 | task2-p1-deps-weixin-login-test-report.md |
| task3 | P2 | domain | ✅ | 1 轮 | task3-p2-domain-test-report.md |
| task4 | P3 | admin-qr | ✅ | 1 轮 | task4-p3-admin-qr-test-report.md |
| task5 | P4 | storage | ✅ | 1 轮 | task5-p4-storage-test-report.md |
| task6 | P5 | agent | ✅ | 1 轮 | task6-p5-agent-test-report.md |
| task7 | P6 | http-routes | ✅ | 2 轮（含 1 轮修正循环）| task7-p6-http-routes-test-report.md |
| task8 | P7 | e2e | ✅ | 1 轮 | task8-p7-e2e-test-report.md |
| task9 | P8 | deploy-doc | ✅ | 1 轮 | task9-p8-deploy-doc-test-report.md |

## 修正循环记录

### task7（P6 http-routes）— 第 2 轮重测通过

- 第 1 轮失败摘要：/wechat/download/<slug>.html 对含中文的 slug 返回 404（server.mjs 用 
ew URL(...).pathname 后未对 slug 做 decodeURIComponent，客户端自动 URL-encode 后服务端按编码路径找文件找不到；ASCII slug 200 正常；单测 4/4 通过是因为单测的 TEST_SLUG 是纯 ASCII）
- 修复内容：在路由对 rest 做 decodeURIComponent（含 try/catch 兜底 URIError → WXD-HTTP-0003）；新增中文 slug 单测；经验已追加到 lessons-learned.md
- 错误码新增：WXD-HTTP-0003

## 主要文件交付

| 文件 | 说明 |
|---|---|
| D:\github\wechat_downloads\domain.mjs | 域名状态桥接（task3） |
| D:\github\wechat_downloads\admin.mjs | 二维码 / 扫码会话管理（task4） |
| D:\github\wechat_downloads\storage.mjs | 索引 + slug + 落盘（task5） |
| D:\github\wechat_downloads\commands.mjs | 斜杠命令分发（task6） |
| D:\github\wechat_downloads\agent.mjs | Agent 接口 + URL 抓取回执（task6） |
| D:\github\wechat_downloads\views\admin.html | 管理说明页（task4） |
| D:\github\wechat_downloads\views\admin-qr.html | 二维码页 + 状态轮询（task4） |
| D:\github\wechat_downloads\views\list.html | 文章列表页（task7） |
| D:\github\wechat_downloads\DEPLOY.md | 部署文档（task9） |
| D:\github\wechat_downloads\tests\domain.test.mjs | 8 个 node:test（task3） |
| D:\github\wechat_downloads\tests\storage.test.mjs | 21 个 node:test（task5） |
| D:\github\wechat_downloads\tests\agent.test.mjs | 9 个 node:test（task6） |
| D:\github\wechat_downloads\tests\http-routes.test.mjs | 5 个 node:test（task7） |

## 单测统计

| 套件 | 用例数 |
|---|---|
| domain.test.mjs | 8 |
| storage.test.mjs | 21 |
| agent.test.mjs | 9 |
| http-routes.test.mjs | 5 |
| **合计** | **43** |

## 错误码登记

- 18 条 WXD-* 错误码（覆盖 AUTH/CFG/DOMAIN/STORAGE/BOT/CMD/HTTP/ADMIN/NET/SYS 模块）
- 详见 dev-spec.md

## 经验沉淀

lessons-learned.md 已追加 2 条经验：

1. 2026-09-17 22.26 [developer] DEV_PLAN.md 中第三方库的 API 描述必须以本地 node_modules 实测为准，不要照搬文档章节
2. 2026-09-17 23.18 [developer] Node HTTP server 解析 URL 后必须 decodeURIComponent 含中文 path，否则浏览器/客户端自动 URL-encode 后服务端找不到文件

## 协议记录

context7-record.md 已记录 weixin-agent-sdk@0.5.0 真实 API（与 DEV_PLAN §A.3 描述不符的修正）。

## 风险与说明

1. 真微信扫码只能在用户实际部署后由用户本人完成；测试 Agent 用 mock downloadArticle 模拟
2. @tencent-weixin/openclaw-weixin@2.4.9 依赖已安装但本项目未使用（其真实 API 是 OpenClaw 插件，非 QR 登录；QR 登录走 weixin-agent-sdk 的 login()）
3. 单测过程中如留下测试文件（_verify-*.mjs），不影响生产代码
