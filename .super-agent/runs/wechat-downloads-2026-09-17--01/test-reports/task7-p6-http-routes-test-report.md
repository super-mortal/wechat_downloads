# task7 / P6 / http-routes 测试报告

测试时间：2026-09-17  
测试者：tester 子智能体  
测试轮次：1

## 第 1 次测试

### 判定：FAIL

| # | 维度 | 位置 | 期望 | 实际 | 备注 |
|---|------|------|------|------|------|
| 1 | 文件存在 | list.html / tests/http-routes.test.mjs | 2 个 | 2 个（true） | OK |
| 2 | 三个路由 | server.mjs | /wechat/download 三路由 | 命中 `/wechat/download/index.json`、`/wechat/download/<slug>.html`（startsWith + ENOENT）、`/wechat/download`（HTML 列表） | OK |
| 3 | 单测 | node --test | pass ≥ 4 | pass 4 / fail 0（a/b/b2/c 全绿） | OK |
| 4 | E2E /wechat/download | server 起 | 200 HTML 含 已收录文章 + seed slug 链接 | STATUS=200；body 含 `已收录文章` 及 `<a href="2026-09-17-测试种子文章-7eef21.html">测试种子文章</a>` | OK |
| 5 | E2E /wechat/download/<slug>.html | server 起 | 200 HTML 含「测试」+「种子文章」 | **STATUS=404**，body=`{"error_code":"WXD-HTTP-0002","message":"/wechat/download/<slug>.html 文件不存在",...}`；不含「测试」「种子文章」 | **FAIL：buildSlug("https://mp.weixin.qq.com/s/TEST_SEED_001","测试种子文章") → `2026-09-17-测试种子文章-7eef21`，含中文；浏览器/Invoke-WebRequest 把中文 slug URL-encode 为 `%E6%B5%8B%E8%AF%95...`，但 server.mjs 用 `new URL(req.url).pathname` 直接拼路径，pathname 不自动 decode，导致 filePath = `...download/2026-09-17-%E6%B5%8B...html`，文件不存在。**ASCII slug（如用 `Test Seed Article` 标题）则 200 正常返回，证明路由机制 OK，只是中文 slug 路径处理有 bug。** |
| 6 | E2E /wechat/download/index.json | server 起 | 200 JSON 含 url | STATUS=200；body 是 JSON 数组 length=1，元素 `url="https://mp.weixin.qq.com/s/TEST_SEED_001"` | OK |
| 7 | E2E 404 | server 起 | 404 + WXD-HTTP-* | STATUS=404；body `{"error_code":"WXD-HTTP-0002","message":"/wechat/download/<slug>.html 文件不存在",...}` | OK（与 dev-spec 中规定的错误码一致） |
| 8 | 纸墨风 | list.html | `:root --paper/--ink` | `:root{--paper:#FDFBF7;--paper-deep:#F5F5F5;--ink:#1A1A1A;--pencil:#4A4A4A;...}` 命中 | OK |
| 9 | 错误码 | dev-spec.md | WXD-HTTP-0002 | 命中 `\| WXD-HTTP-0002 \| http \| 404 \| /wechat/download/<slug>.html 文件不存在 \| server.mjs#wechat/download \|` | OK（dev 用的是 0002 不是 0001，符合验收要求） |

### 失败定位（测试 #5）

- **根因**：`server.mjs` 中 `/wechat/download/<slug>.html` 路由用 `new URL(req.url, ...).pathname` 后**未对 slug 做 `decodeURIComponent`**，而浏览器/Invoke-WebRequest 等客户端会把 slug 中的非 ASCII 字符按百分号编码发送，于是服务端在 `public/wechat/download/<encoded-slug>.html` 找不到文件，回 404 + WXD-HTTP-0002。
- **复现**：
  ```js
  // 现象（最小复现，新开 debug server 验证）
  > new URL("/wechat/download/2026-09-17-%E6%B5%8B%E8%AF%95%E7%A7%8D%E5%AD%90%E6%96%87%E7%AB%A0-7eef21.html", "http://127.0.0.1:3915").pathname
  '/wechat/download/2026-09-17-%E6%B5%8B%E8%AF%95%E7%A7%8D%E5%AD%90%E6%96%87%E7%AB%A0-7eef21.html'  // 仍是编码态
  ```
- **影响**：`buildSlug(url, "中文标题")` 会保留中文（storage.mjs `slugifyTitle` 注释："中文保留（不强求 kebab）"），所以**任何中文标题的文章单篇页都会被这个 bug 打到 404**。这条对生产环境的中文归档是 P1 级别问题。
- **建议修复**：在 server.mjs 中拿到 rest/slug 后做 `decodeURIComponent(rest)`（或对 slug 单独 decode），另外把 HTML 里的 `<a href="...">` 用同样的方式生成（或者改用 buildSlug 直接输出 ASCII），与 URL 解码方向对齐。

### 其他说明

- 单测 `tests/http-routes.test.mjs` 用 ASCII slug `2026-09-17-test-article-test01`，所以单元测试 4/4 通过，但**没有覆盖中文 slug 这条 path**，漏掉了这个 bug。
- 列表页（#4）/index.json（#6）/404（#7）都正常，说明 server 读 `public/wechat/download/index.json` 和 ENOENT 分支本身没问题，问题只在 slug→filePath 的解码。
- seed/cleanup 已成对跑过：
  - seed：`tests/tmp/_seed-test.mjs`（写入 slug `2026-09-17-测试种子文章-7eef21`，HTML 内容 `<h1>测试</h1><p>种子文章</p>`，并 mirrorIndexToPublic）。
  - cleanup：`tests/tmp/_cleanup-test.mjs`（删除两份 seed md/html，把 index.json 写回 `[]`）。
  - 当前 `public/wechat/download/` 仅剩 `index.json`（内容 `[]`），`data/md/` 没有遗留 seed 文件。

## 证据

### 1) 文件存在
```
> Test-Path "D:\github\wechat_downloads\views\list.html"; Test-Path "D:\github\wechat_downloads\tests\http-routes.test.mjs"
True
True
```

### 2) 三个路由（server.mjs grep）
```
> Get-Content "D:\github\wechat_downloads\server.mjs" | Select-String "/wechat/download"
      ? "/wechat/download/<slug>.html 文件不存在"
// 读取 public/wechat/download/index.json（mirrorIndexToPublic 产物）
// 渲染 /wechat/download 列表页 HTML
    // /wechat/download 系列路由（P6 / task7）
    if (u.pathname === "/wechat/download/index.json") { ... }
    if (u.pathname.indexOf("/wechat/download/") === 0 && u.pathname.slice(...).length > 0) { ... <slug>.html 分支 ... }
    if (u.pathname === "/wechat/download" || u.pathname === "/wechat/download/") { ... }
```

### 3) node --test
```
✔ a. GET /wechat/download 返回 200 HTML（列表页路由注册） (585.2152ms)
✔ b. GET /wechat/download/<slug>.html 返回 200 HTML（单篇路由注册） (6.332ms)
✔ b2. GET /wechat/download/<slug>.html 不存在 → 404 + WXD-HTTP-0002 (2.6782ms)
✔ c. GET /wechat/download/index.json 返回 200 JSON（数据源路由注册） (2.4756ms)
ℹ tests 4   ℹ pass 4   ℹ fail 0
```

### 4) E2E /wechat/download（列表页）
```
STATUS=200
BODY-LEN=4956
TITLE? True   (含 "已收录文章")
SLUG-LINK? True   (含 "2026-09-17-测试种子文章-7eef21")
```
列表页 HTML 片段：
```html
<h1>已收录<mark>文章</mark></h1>
<div class="list"><div class="entry"><span class="t"><a href="2026-09-17-测试种子文章-7eef21.html">测试种子文章</a></span>...</div></div>
```

### 5) E2E /wechat/download/<slug>.html（中文 slug）— FAIL
```
STATUS: NotFound
BODY:
{
  "error_code": "WXD-HTTP-0002",
  "message": "/wechat/download/<slug>.html 文件不存在",
  "stage": "server.mjs#/wechat/download/<slug>.html",
  "request_id": "n/a"
}
```
对照：同文件用 ASCII slug（如 `2026-09-17-Test-Seed-Article-59249d`）可正常 200：
```
STATUS=200
BODY: <h1>测试</h1><p>种子文章</p>
HAS-测试? True
HAS-种子文章? True
```

### 6) E2E /wechat/download/index.json
```
STATUS=200
COUNT: 1
URL-contains-seed? True   (https://mp.weixin.qq.com/s/TEST_SEED_001)
SLUG: 2026-09-17-测试种子文章-7eef21
```

### 7) E2E 404
```
STATUS: NotFound
BODY:
{
  "error_code": "WXD-HTTP-0002",
  "message": "/wechat/download/<slug>.html 文件不存在",
  "stage": "server.mjs#/wechat/download/<slug>.html",
  "request_id": "n/a"
}
```

### 8) 纸墨风（list.html）
```
> Get-Content "D:\github\wechat_downloads\views\list.html" | Select-String ":root|--paper|--ink"
:root{--paper:#FDFBF7;--paper-deep:#F5F5F5;--ink:#1A1A1A;--pencil:#4A4A4A;...
html,body{...background:var(--paper);color:var(--ink);...}
... (大量 var(--ink) / var(--paper) 使用)
```

### 9) 错误码（dev-spec.md）
```
> Get-Content "...\plan\dev-spec.md" | Select-String "WXD-HTTP-0002"
| WXD-HTTP-0002 | http | 404 | /wechat/download/<slug>.html 文件不存在 | server.mjs#wechat/download |
```
（与 server.mjs 实际发送的错误码一致；且 dev 用的是 0002，不是 0001，符合验收要求。）

---

## 第 2 次测试（重测）

测试时间：2026-09-17  
测试轮次：2  
测试重点：developer 修复 `decodeURIComponent` + 新增中文 slug 单测 + 登记 WXD-HTTP-0003 的重测

### 判定：PASS

| # | 上次问题 | 当前状态 |
|---|---------|---------|
| 1 | 中文 slug 404 | ✅ 已修复（server.mjs 对 rest 做 `decodeURIComponent`，含 try/catch → 错误走 WXD-HTTP-0003） |
| 2 | ASCII slug 没破坏 | ✅ 仍 200（`2026-09-17-ASCII-Test-Article-352099` 正常返回） |
| 3 | 单测新增中文用例 | ✅ pass 5 / fail 0（含新加的 `b-cn. GET /wechat/download/<中文-slug>.html 返回 200`） |
| 4 | dev-spec WXD-HTTP-0003 | ✅ 已登记 `\| WXD-HTTP-0003 \| http \| 400 \| URL 路径解码失败 \| server.mjs#/wechat/download/<slug>.html \|` |

### 1) 单测结果（`node --test tests\http-routes.test.mjs`）

```
✔ a. GET /wechat/download 返回 200 HTML（列表页路由注册） (536.1313ms)
✔ b. GET /wechat/download/<slug>.html 返回 200 HTML（单篇路由注册） (4.4552ms)
✔ b-cn. GET /wechat/download/<中文-slug>.html 返回 200（验证 decodeURIComponent） (2.6377ms)
✔ b2. GET /wechat/download/<slug>.html 不存在 → 404 + WXD-HTTP-0002 (3.576ms)
✔ c. GET /wechat/download/index.json 返回 200 JSON（数据源路由注册） (2.643ms)
ℹ tests 5   ℹ pass 5   ℹ fail 0
```

新增的 `b-cn` 用例显式把 `CN_SLUG = "2026-09-17-测试种子文章-7eef21"` 用 `encodeURIComponent` 后发请求，断言 200 + content-type=text/html + body 匹配 `/测试/` —— 正是上次漏覆盖的中文 path。

### 2) 端到端 E2E（中文 slug）

seed 脚本：`tests/tmp/_seed-cn.mjs`，`buildSlug("https://mp.weixin.qq.com/s/TEST_SEED_001","测试种子文章")` → `2026-09-17-测试种子文章-7eef21`（含中文），HTML 内容 `<h1>测试</h1><p>种子文章</p>`。

- **TEST1 raw 中文（浏览器样式直接发 UTF-8 字节）**
  ```
  URL: http://127.0.0.1:3915/wechat/download/2026-09-17-测试种子文章-7eef21.html
  STATUS=200
  BODY=<h1>测试</h1><p>种子文章</p>
  HAS-测试? True
  HAS-种子文章? True
  ```

- **TEST2 URL-encoded 中文（Invoke-WebRequest 走百分号编码）**
  ```
  URL: http://127.0.0.1:3915/wechat/download/2026-09-17-%E6%B5%8B%E8%AF%95%E7%A7%8D%E5%AD%90%E6%96%87%E7%AB%A0-7eef21.html
  STATUS=200
  BODY=<h1>测试</h1><p>种子文章</p>
  HAS-测试? True
  HAS-种子文章? True
  ```
  （这就是上次直接 404 的 URL，现在 200，修复确认。）

### 3) 端到端 E2E（ASCII slug 回归）

seed `https://mp.weixin.qq.com/s/TEST_SEED_ASCII` → `2026-09-17-ASCII-Test-Article-352099`：
```
URL: http://127.0.0.1:3915/wechat/download/2026-09-17-ASCII-Test-Article-352099.html
STATUS=200
BODY=<h1>ASCII</h1><p>hello ascii</p>
```
ASCII 路径未回归。

### 4) 错误码回归（顺手验）

- 不存在 slug → 404 + WXD-HTTP-0002（保持原行为）：
  ```
  STATUS=NotFound
  BODY={"error_code":"WXD-HTTP-0002","message":"/wechat/download/<slug>.html 文件不存在",...}
  ```
- 非法 UTF-8 百分号编码（`%E0%A4%A`） → 400 + WXD-HTTP-0003（新增的 URIError 分支）：
  ```
  STATUS=BadRequest
  BODY={"error_code":"WXD-HTTP-0003","message":"URL 路径解码失败","stage":"server.mjs#/wechat/download/<slug>.html",...}
  ```

### 5) server.mjs 修复片段（证据）

```js
// 错误响应（WXD-HTTP-0002：单篇 slug HTML 不存在；WXD-HTTP-0003：URL 路径解码失败）
var HTTP_ERROR_META = {
  "WXD-HTTP-0002": { http: 404, message: "/wechat/download/<slug>.html 文件不存在" },
  "WXD-HTTP-0003": { http: 400, message: "URL 路径解码失败" },
};
...
if (rest !== "index.json" && /\.html$/.test(rest) && !rest.includes("/")) {
  // 浏览器 / Invoke-WebRequest 客户端会把 slug 中的非 ASCII 字符按百分号编码发送；
  // new URL().pathname 不会自动 decode，因此必须显式 decodeURIComponent，否则中文 slug 会找不到文件。
  var slug;
  try {
    slug = decodeURIComponent(rest.slice(0, -5)); // 去掉 ".html" 再解码
  } catch (decodeErr) {
    sendHttpError(res, "WXD-HTTP-0003", "server.mjs#/wechat/download/<slug>.html");
    return;
  }
  var filePath = path.join(process.cwd(), "public", "wechat", "download", slug + ".html");
```

修复思路正确：用 try/catch 把 `URIError` 兜成 400 + WXD-HTTP-0003，恶意/残缺的百分号编码不会让请求打到不该打到的文件，也不会泄漏系统错误。

### 6) dev-spec.md WXD-HTTP-0003

```
> Get-Content "...\plan\dev-spec.md" | Select-String "WXD-HTTP-0003"
| WXD-HTTP-0003 | http | 400 | URL 路径解码失败 | server.mjs#/wechat/download/<slug>.html |
```

### 清理

- 关 server：`Get-Process node | Stop-Process -Force`
- 清理 seed：`tests/tmp/_cleanup-test.mjs`，同时移除中文 / ASCII 两个 seed 条目、对应 md/html 文件；`public/wechat/download/index.json` 已恢复为 `[]`；`data/md/` 无遗留 seed 文件。
