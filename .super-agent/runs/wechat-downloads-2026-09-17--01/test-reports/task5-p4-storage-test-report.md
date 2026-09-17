# task5 / P4 / storage 测试报告

## 第 1 次测试

### 判定：PASS

| # | 维度 | 位置 | 期望 | 实际 | 备注 |
|---|------|------|------|------|------|
| 1 | 文件 / 目录 | storage.mjs / data / public | 5 个路径 | True / True / True / True / True | 全部存在 |
| 2 | 七个导出 | storage.mjs | build/find/add/read/write/mirror | 命中 8 个（buildSlug, readIndex, writeIndex, findByUrl, writeMarkdown, writeHtml, addEntry, mirrorIndexToPublic） | ≥7 满足 |
| 3 | 单测 | `node --test tests\storage.test.mjs` | pass ≥ 21 | pass=21 / fail=0 | 21/21 通过 |
| 4 | .gitignore | .gitignore | 3 条新规则 | 3 行全部命中（data/md/, public/wechat/download/*.html, public/wechat/download/*.json） | 满足 |
| 5 | 端到端 | `tests\_verify-storage-e2e.mjs` | slug/落盘/镜像全 OK | `[verify] storage E2E OK { slug: ''2026-09-17-验证测试文章-c8eecd'' }` | 清理已生效（index/md/html 均无残留） |
| 6 | 错误码 | dev-spec.md | WXD-STORAGE-0001~0003 | 3 个错误码全部命中 | 满足 |

## 证据

### 1. 文件 / 目录存在
```
storage.mjs                              True
tests\storage.test.mjs                   True
data                                     True
data\md                                  True
public\wechat\download                   True
```

### 2. storage.mjs 八个 export
```
export function buildSlug(url, title, now) {
export async function readIndex() {
export async function writeIndex(arr) {
export async function findByUrl(url) {
export async function writeMarkdown(slug, md) {
export async function writeHtml(slug, html) {
export async function addEntry(entry) {
export async function mirrorIndexToPublic() {
```

### 3. 单测输出（`node --test tests\storage.test.mjs`）
```
✔ buildSlug: 同一 url + title + 时间 → 同一 slug（含稳定 hash6）
✔ buildSlug: 中文 title 不抛错（保留中文字符）
✔ buildSlug: 空白转 -，连续 - 合并，首尾 - 去掉
✔ buildSlug: 非法字符（/ \ : * ? " < > |）被剥除
✔ buildSlug: 空 url 抛 StorageError WXD-STORAGE-0002
✔ readIndex: 不存在时返回 []
✔ writeIndex: 原子写（writeIndex 后能 readIndex 拿到）
✔ writeIndex: 非数组抛 WXD-STORAGE-0001
✔ readIndex: 非法 JSON 内容抛 WXD-STORAGE-0001
✔ findByUrl: 在 index 中找到相同 url 的条目
✔ findByUrl: 找不到时返回 null
✔ addEntry: 新 url 追加并 writeIndex（落盘可读回）
✔ addEntry: 同 url 已存在则跳过（不重复写入）
✔ addEntry: 同 slug 不同 url 抛 WXD-STORAGE-0002（slug 冲突）
✔ addEntry: 非法 entry（缺 slug / url）抛 WXD-STORAGE-0001
✔ writeMarkdown: 落盘后能读回（自动建目录）
✔ writeHtml: 落盘后能读回（自动建目录）
✔ writeMarkdown: 空 slug 抛 WXD-STORAGE-0003
✔ writeHtml: 空 slug 抛 WXD-STORAGE-0003
✔ mirrorIndexToPublic: 复制 data/index.json 到 public/wechat/download/index.json
✔ buildEntry: 字段齐全且 created_at 是 +08:00
ℹ tests 21
ℹ pass 21
ℹ fail 0
```

### 4. .gitignore 新条目
```
data/md/
public/wechat/download/*.html
public/wechat/download/*.json
```

### 5. 端到端（`tests\_verify-storage-e2e.mjs`）
```
[verify] slug: 2026-09-17-验证测试文章-c8eecd
[verify] storage E2E OK { slug: '2026-09-17-验证测试文章-c8eecd' }
```
清理验证：
- `data\index.json` 中无 `VERIFY_TEST_001`（已清理）
- `public\wechat\download\index.json` 中无 `VERIFY_TEST_001`（已清理）
- `data\md\2026-09-17-验证测试文章-c8eecd.md` 不存在
- `public\wechat\download\2026-09-17-验证测试文章-c8eecd.html` 不存在

### 6. 错误码（dev-spec.md）
```
| WXD-STORAGE-0001 | storage | 500 | 读 / 写 `data/index.json` 失败 | storage.mjs#readIndex / writeIndex |
| WXD-STORAGE-0002 | storage | 500 | slug 冲突且 MD5 不一致 | storage.mjs#addEntry |
| WXD-STORAGE-0003 | storage | 500 | Markdown / HTML 写盘失败 | storage.mjs#writeMarkdown / writeHtml |
```

## 总结

6 个维度全部 PASS。
- 单测 21/21 通过，覆盖 buildSlug/readIndex/writeIndex/findByUrl/addEntry/writeMarkdown/writeHtml/mirrorIndexToPublic 全部分支。
- 独立 E2E 脚本独立验证了 buildSlug hash6 规则、addEntry 新增+去重、writeMarkdown/writeHtml 落盘、mirrorIndexToPublic 镜像、findByUrl 读回、清理回收，全程无残留。
- 错误码 0001/0002/0003 全部在 dev-spec 中定义。
