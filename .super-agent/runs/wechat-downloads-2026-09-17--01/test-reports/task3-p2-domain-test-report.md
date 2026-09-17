# task3 / P2 / domain 测试报告

## 第 1 次测试

### 判定：PASS

| # | 维度 | 位置 | 期望 | 实际 | 备注 |
|---|------|------|------|------|------|
| 1 | 文件存在 | domain.mjs / tests/domain.test.mjs / server.mjs | true / true / true | true / true / true | 三文件均在位 |
| 2 | 三个导出 | domain.mjs | computePublicBaseUrl / recordPublicBaseUrl / getCachedPublicBaseUrl | L21 / L63 / L77 | export function 均存在 |
| 3 | 单测全过 | node --test tests/domain.test.mjs | pass ≥ 8 | pass 8 / fail 0 | 8 用例全部 ✔ |
| 4 | 中间件注入 | server.mjs | recordPublicBaseUrl/domainMiddleware 出现且在路由前 | import L12；middleware 定义 L16；调用 L327（http.createServer 在 L325, 首个路由响应 L330+） | 位于 chain 最前 |
| 5 | 三个优先级 | tests/_verify-domain-priority.mjs | env > xfh > fallback | `[verify] domain priority OK { a: "https://env.example.com", b: "http://xfh.com", c: "http://127.0.0.1:3915" }` | OK |
| 6 | 错误码登记 | dev-spec.md | WXD-DOMAIN-0001 / WXD-DOMAIN-0002 存在 | L52(0001, 内嵌 JSON), L68(0001), L68(0002) | 两码均登记 |

## 证据

### 1. 文件存在性
```
Test-Path D:\github\wechat_downloads\domain.mjs            -> True
Test-Path D:\github\wechat_downloads\tests\domain.test.mjs -> True
Test-Path D:\github\wechat_downloads\server.mjs            -> True
```

### 2. 三个导出
```
domain.mjs:21:export function computePublicBaseUrl(req) {
domain.mjs:63:export function recordPublicBaseUrl(req) {
domain.mjs:77:export function getCachedPublicBaseUrl() {
```

### 3. 单测结果（前 20 行）
```
✔ computePublicBaseUrl: env 优先（PUBLIC_BASE_URL 直接命中） (1.1903ms)
✔ computePublicBaseUrl: X-Forwarded-Host 命中（多值取首 + X-Forwarded-Proto） (0.3422ms)
✔ computePublicBaseUrl: X-Forwarded-Host 命中但无 X-Forwarded-Proto 时回退 socket.encrypted (0.2794ms)
✔ computePublicBaseUrl: 裸 host 命中 (http) (1.2731ms)
✔ computePublicBaseUrl: 裸 host 命中 (https via socket.encrypted) (0.3773ms)
✔ recordPublicBaseUrl: 写入模块级缓存 (0.2519ms)
✔ getCachedPublicBaseUrl: 兜底 127.0.0.1:3915（清空缓存 + 清空 env） (0.2407ms)
✔ 三个优先级严格生效：env > 缓存 > 兜底 (0.3883ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 130.7149
```

### 4. server.mjs 注入顺序
```
server.mjs:12 : import { recordPublicBaseUrl } from "./domain.mjs";
server.mjs:16 : function domainMiddleware(req, res, next) {
server.mjs:17 :   try { recordPublicBaseUrl(req); } catch (_) { /* cache miss is non-fatal */ }
server.mjs:325: var server = http.createServer(async function(req, res) {
server.mjs:327:   domainMiddleware(req, res);      <-- 在所有路由前调用
server.mjs:330:   res.writeHead(200, ...renderHome)  <-- 第一个具体路由
```
domainMiddleware 在 http.createServer 回调入口立刻执行，先于任何 res.writeHead / renderHome / 业务分支。

### 5. 三个优先级独立验证
脚本：`tests/_verify-domain-priority.mjs`
运行结果（最后一行）：
```
[verify] domain priority OK {
  a: 'https://env.example.com',
  b: 'http://xfh.com',
  c: 'http://127.0.0.1:3915'
}
```
- Case A (env 优先)：返回 https://env.example.com ✔
- Case B (清 env 后 XFH 命中)：返回 http://xfh.com ✔
- Case C (兜底)：返回 string 类型的 http://127.0.0.1:3915 ✔

### 6. 错误码登记
```
dev-spec.md:52: "error_code": "WXD-DOMAIN-0001",
dev-spec.md:67: | WXD-DOMAIN-0001 | domain | 500 | X-Forwarded-Host 多值取首失败 | domain.mjs#computePublicBaseUrl |
dev-spec.md:68: | WXD-DOMAIN-0002 | domain | 500 | 缓存读不到且无 env（理论上不会触发，因为兜底 127.0.0.1） | domain.mjs#getCachedPublicBaseUrl |
```

## 结论
六项验收维度全部通过，task3（P2 / domain）**PASS**。
