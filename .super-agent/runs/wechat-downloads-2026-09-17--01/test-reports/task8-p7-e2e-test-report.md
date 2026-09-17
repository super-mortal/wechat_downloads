# task8 / P7 / e2e 测试报告

## 第 1 次测试

### 判定：PASS

| # | 维度 | 期望 | 实际 | 备注 |
|---|------|------|------|------|
| 1 | 工具可用 | exec_command 可用 | 0 | node 进程计数返回 0，工具可用 |
| 2 | WECHAT_BOT=1 启动 | ready + 3915 监听 | ready · http://127.0.0.1:3915 | Test-NetConnection 返回 True |
| 3 | /admin | 200 | 200 | OK |
| 4 | /admin/qr | 200 | 200 | OK |
| 5 | POST /admin/qr/start | 200 含 qrcodeUrl | 200, {"qrcodeUrl":"https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=<redacted>&bot_type=3","sessionKey":"<redacted>"","requestId":"9d50cd61-82c2-40d7-a0bd-2be0b3cbdb48"} | 含 qrcodeUrl |
| 6 | /wechat/download | 200 | 200 | OK |
| 7 | /wechat/download/index.json | 200 JSON | 200, [] | OK |
| 8 | agent /help | "可用命令" | "可用命令：\n/all · 所有文章列表\n/count · 文章数量\n/help · 本帮助\n\n直接发 mp.weixin.qq.com/s/... 也可收录" | OK |
| 9 | agent /all | 含域名 | "https://e2e.example.com/wechat/download" | OK |
| 10 | agent /count | 含数字 | "已收录 0 篇" | OK |
| 11 | agent /unknown | "未知命令" | "未知命令。发送 /help 查看用法。" | OK |
| 12 | agent URL 新增 | 单行 URL + 落盘 | "https://e2e.example.com/wechat/download/2026-09-17-端到端测试文章-b028d0.html" | slug1 = 2026-09-17-端到端测试文章-b028d0 |
| 13 | agent URL 重复 | 复用旧 URL | "https://e2e.example.com/wechat/download/2026-09-17-端到端测试文章-b028d0.html" | 与 URL 新增一致，命中 findByUrl |
| 14 | agent URL 抓取失败 | "该文章无法访问" | "该文章无法访问，换一条试试" | OK |
| 15 | 单篇 HTTP | 200 | 200 | GET /wechat/download/2026-09-17-端到端测试文章-b028d0.html 返回 200 |
| 16 | 错误码 | ≥ 4 个 | 5 个 | WXD-NET-0002 / WXD-BOT-0001 / WXD-CMD-0001 / WXD-NET-0001 / WXD-HTTP-0003 全部登记 |

## 证据

### 第 1 步：工具可用
`
Get-Process node -ErrorAction SilentlyContinue | Measure-Object | Select-Object Count
> Count
> -----
>     0
`

### 第 2 步：清环境
- 备份 data/index.json -> data/index.json.bak.task8
- data/index.json 清空为 []
- public/wechat/download 下无 .html 文件（原本只有 index.json）

### 第 3 步：WECHAT_BOT=1 启动 server
`
> ready · http://127.0.0.1:3915
Test-NetConnection 127.0.0.1:3915 -> True
`

### 第 4 步：HTTP 路由联调
`
/admin                                        -> 200
/admin/qr                                     -> 200
POST /admin/qr/start                          -> 200
  {"qrcodeUrl":"https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=<redacted>&bot_type=3",
   "sessionKey":"<redacted>"",
   "requestId":"9d50cd61-82c2-40d7-a0bd-2be0b3cbdb48"}
/wechat/download                              -> 200
/wechat/download/index.json                   -> 200, []
`

### 第 5 步：agent.chat() 直接联调（tests/_verify-task8-e2e.mjs）
`
[step /help]     "可用命令：\n/all · 所有文章列表\n/count · 文章数量\n/help · 本帮助\n\n直接发 mp.weixin.qq.com/s/... 也可收录"
[step /all]      "https://e2e.example.com/wechat/download"
[step /count]    "已收录 0 篇"
[step /unknown]  "未知命令。发送 /help 查看用法。"
[step URL新增]   "https://e2e.example.com/wechat/download/2026-09-17-端到端测试文章-b028d0.html"
[slug1]          2026-09-17-端到端测试文章-b028d0
[step URL重复]   "https://e2e.example.com/wechat/download/2026-09-17-端到端测试文章-b028d0.html"
[step 抓取失败]  "该文章无法访问，换一条试试"
[e2e] OK ALL
`

### 第 6 步：HTTP 单篇回放
`
GET /wechat/download/2026-09-17-端到端测试文章-b028d0.html   -> 200
GET /wechat/download/index.json                              -> 200
  [{"slug":"2026-09-17-端到端测试文章-b028d0",
    "title":"端到端测试文章","author":"tester",
    "url":"https://mp.weixin.qq.com/s/E2E_TEST_001",
    "md_path":"data/md/2026-09-17-端到端测试文章-b028d0.md",
    "html_url":"/wechat/download/2026-09-17-端到端测试文章-b028d0.html",
    "created_at":"2026-09-17T23:42:18+08:00","size_bytes":45}]
`

### 第 7 步：清理
- node 进程全部 Stop-Process
- 删除 public/wechat/download/2026-09-17-端到端测试文章-b028d0.html
- data/index.json.bak.task8 -> data/index.json（已还原）
- 删除 server-task8.log / server-task8.err / tests/_verify-task8-e2e.mjs
- 清除 WECHAT_BOT 环境变量

### 第 8 步：错误码验证
dev-spec.md 登记：
`
| WXD-HTTP-0003 | http | 400 | URL 路径解码失败 | server.mjs#/wechat/download/<slug>.html |
| WXD-BOT-0001  | bot  | —   | Agent.chat 返回值缺 text | agent.mjs#chat |
| WXD-CMD-0001  | cmd  | —   | 命令命中但 baseUrl 拿不到 | commands.mjs#handleCommand |
| WXD-NET-0001  | net  | 502 | article.mjs.downloadArticle 抓取失败 | agent.mjs#downloadAndReply |
| WXD-NET-0002  | net  | 502 | weixin-agent-sdk 长轮询断开 | server.mjs 启动钩子 |
`
命中 5 / 期望 ≥ 4 ✔

