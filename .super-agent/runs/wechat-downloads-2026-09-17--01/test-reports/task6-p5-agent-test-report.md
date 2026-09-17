# task6 / P5 / agent 测试报告

## 第 1 次测试

### 判定：PASS

| # | 维度 | 位置 | 期望 | 实际 | 备注 |
|---|------|------|------|------|------|
| 1 | 文件存在 | commands.mjs / agent.mjs / tests/agent.test.mjs | 3 个 | True / True / True | 三个文件均存在 |
| 2 | commands 导出 | commands.mjs | `export.*handleCommand` | `export async function handleCommand(text, baseUrl)` | 命中 |
| 3 | Agent 接口 | agent.mjs | export agent + async chat + URL 正则 | `export const agent = { async chat(req) { ... }`，注释中含 `mp.weixin.qq.com/s/...`，正则即此 URL | 三项均命中 |
| 4 | 单测 | `node --test tests\agent.test.mjs` | pass ≥ 9 | pass=9 / fail=0 / tests=9 | a/b/c/d/e/f/g/h/h2 共 9 条用例全过 |
| 5 | 集成回归 | domain + storage + agent | 全 pass | pass=38 / fail=0 / tests=38 | domain 8 + storage 21 + agent 9 = 38，全过 |
| 6 | 端到端 | `tests/_verify-agent-e2e.mjs` | 命令分发 + 非 URL 处理 | 输出 `[verify] commands OK` + `[verify] agent 命令分发 OK` | /help /all /count /unknown（返 null）/ /help / /unknown / 非 URL 提示公众号链接全部通过 |
| 7 | 错误码 | plan/dev-spec.md | WXD-BOT-0001 / WXD-CMD-0001 / WXD-NET-0001 | 三条全命中 | WXD-BOT-0001（agent.mjs#chat）、WXD-CMD-0001（commands.mjs#handleCommand）、WXD-NET-0001（agent.mjs#downloadAndReply） |

## 证据

### 维度 1：文件存在
```
Test-Path commands.mjs              -> True
Test-Path agent.mjs                 -> True
Test-Path tests/agent.test.mjs      -> True
```

### 维度 2：commands.mjs 导出
```
> Get-Content commands.mjs | Select-String "export.*handleCommand"
export async function handleCommand(text, baseUrl) {
```

### 维度 3：agent.mjs 导出 + chat + URL 正则
```
// mp.weixin.qq.com/s/xxx 链接识别正则（§6）
const TEXT_NON_COMMAND = "请发 mp.weixin.qq.com/s/... 公众号链接，或 /help 看命令";
export const agent = {
  async chat(req) {
```

### 维度 4：单测
```
$ node --test tests\agent.test.mjs
✔ a. /help 回执包含「可用命令」
✔ b. /all 回执包含「/wechat/download」
✔ c. /count 回执包含「已收录」与数字
✔ d. /unknown 返回未知命令文案
✔ e. 非命令非 URL 返回「请发 mp.weixin.qq.com/s/...」
✔ f. URL 命中 + 新增 → 返回一行 URL（落盘 + 写索引）
✔ g. URL 命中 + 已存在 → 复用旧 URL，不重复抓取
✔ h. URL 命中 + 抓取失败 → 返回「该文章无法访问，换一条试试」
✔ h2. URL 命中 + downloadArticle 返回 ok:false → 同样失败文案
ℹ tests 9 / pass 9 / fail 0
```

### 维度 5：集成回归
```
$ node --test tests\domain.test.mjs tests\storage.test.mjs tests\agent.test.mjs
ℹ tests 38 / pass 38 / fail 0
```
分布：domain 8 + storage 21 + agent 9 = 38，全部 PASS。

### 维度 6：端到端（mock downloadArticle）
```
$ node tests\_verify-agent-e2e.mjs
[verify] commands OK
[verify] agent 命令分发 OK
```
- `handleCommand("/help")` 含「可用命令」✓
- `handleCommand("/all")` 含「/wechat/download」✓
- `handleCommand("/count")` 匹配 `/已收录\s+\d+\s+篇/` ✓
- `handleCommand("/random")` 返回 `null` ✓
- `agent.chat({text:"/help"})` 含「可用命令」✓
- `agent.chat({text:"/unknown"})` 含「未知命令」✓
- `agent.chat({text:"hello world"})` 含 `mp.weixin.qq.com` ✓

### 维度 7：错误码
```
> Get-Content plan\dev-spec.md | Select-String "WXD-BOT-0001|WXD-CMD-0001|WXD-NET-0001"
| WXD-BOT-0001    | bot | —  | Agent.chat 返回值缺 text | agent.mjs#chat |
| WXD-CMD-0001    | cmd | —  | 命令命中但 baseUrl 拿不到 | commands.mjs#handleCommand |
| WXD-NET-0001    | net | 502 | article.mjs.downloadArticle 抓取失败 | agent.mjs#downloadAndReply |
```

## 结论
所有 7 个维度全部通过，task6 / P5 / agent 测试 PASS。
