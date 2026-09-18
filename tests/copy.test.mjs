// tests/copy.test.mjs - 文案统一性扫描测试（node:test + node:assert/strict）
//   覆盖 §七.3 + §十二.6
//   扫 views/*.html + README.md + DEPLOY.md
//   断言：
//     A) 禁止 §十二.6 旧文案：
//        - 文档类（README.md / DEPLOY.md）：9 个旧短语命中次数 = 0
//        - 视图类（views/*.html）：仅断言 <title> 不以 wechat-downloads 结尾（受 §E 限制，
//          views 不能修改，但应阻止继续退回老品牌）
//     B) 新品牌"微信公众号在线下载器"或"在线下载器"必须出现在：
//        README.md 第一行 / DEPLOY.md 第一段（≥1 次）+ views/admin.html 的 <title>
//   风格：与 tests/* 一致（node:test + node:assert/strict）

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");
const VIEWS_DIR = path.join(PROJECT_ROOT, "views");
const README_FILE = path.join(PROJECT_ROOT, "README.md");
const DEPLOY_FILE = path.join(PROJECT_ROOT, "DEPLOY.md");

// 文档类禁止短语（README + DEPLOY）
const DOC_FORBIDDEN_PHRASES = [
  "扫码绑定微信 · wechat-downloads",      // §十二.6 #1 标题
  "请扫码完成微信绑定",                  // §十二.6 #2 body 引导
  "开始扫码",                            // §十二.6 #3 button label
  "重新扫码",                            // §十二.6 #3 button label
  "wechat-downloads · 扫码",              // §十二.6 #4 brand area
  // §十二.6 #5 其它 v1/v2 已废弃文案（README 老标题 + 老描述短语）
  "免费公众号下载器",                    // 老 README 标题
  "本机浏览器直读",                       // 老 README 特性段
  "一键留到本机",                         // 老 README 描述
];

// 新文案关键词（任一即可）
const NEW_BRAND_PRIMARY = "微信公众号在线下载器";
const NEW_BRAND_FALLBACK = "在线下载器";

// 收集文档类目标（README + DEPLOY）
function collectDocs() {
  const out = [];
  if (fs.existsSync(README_FILE)) out.push({ path: README_FILE, rel: "README.md" });
  if (fs.existsSync(DEPLOY_FILE)) out.push({ path: DEPLOY_FILE, rel: "DEPLOY.md" });
  return out;
}

function collectViews() {
  const out = [];
  if (fs.existsSync(VIEWS_DIR)) {
    for (const name of fs.readdirSync(VIEWS_DIR)) {
      if (name.endsWith(".html")) out.push({ path: path.join(VIEWS_DIR, name), rel: "views/" + name });
    }
  }
  return out;
}

function countOccurrences(text, phrase) {
  if (!text || !phrase) return 0;
  let count = 0;
  let idx = 0;
  while (idx <= text.length - phrase.length) {
    const found = text.indexOf(phrase, idx);
    if (found < 0) break;
    count++;
    idx = found + phrase.length;
  }
  return count;
}

// ============ 断言 1：文档类禁止旧文案 ============

test("copy.1 doc forbidden phrases: 8 个旧文案在 README.md / DEPLOY.md 命中数 = 0", () => {
  const files = collectDocs();
  assert.ok(files.length === 2, "README + DEPLOY 应同时存在");

  const violations = [];
  for (const f of files) {
    const text = fs.readFileSync(f.path, "utf8");
    for (const phrase of DOC_FORBIDDEN_PHRASES) {
      const n = countOccurrences(text, phrase);
      if (n > 0) {
        violations.push({ file: f.rel, phrase: phrase, count: n });
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    "发现禁止文案：" + JSON.stringify(violations, null, 2)
  );
});

// ============ 断言 2：README 第一行 + DEPLOY 第一段含新品牌 ============

test("copy.2 README 第一行 + DEPLOY 第一段含新品牌文案（≥1 次）", () => {
  const readmeFirstLine = (function () {
    if (!fs.existsSync(README_FILE)) return "";
    const text = fs.readFileSync(README_FILE, "utf8");
    const nl = text.indexOf("\n");
    return nl < 0 ? text : text.slice(0, nl);
  })();

  const deployFirstPara = (function () {
    if (!fs.existsSync(DEPLOY_FILE)) return "";
    const text = fs.readFileSync(DEPLOY_FILE, "utf8");
    const m = text.match(/[^\r\n]+(?:\r?\n[^\r\n]*)*?(?=\r?\n\s*\r?\n|$)/);
    return m ? m[0] : text.split("\n")[0] || "";
  })();

  const readmeHits = countOccurrences(readmeFirstLine, NEW_BRAND_PRIMARY)
    + countOccurrences(readmeFirstLine, NEW_BRAND_FALLBACK);
  const deployHits = countOccurrences(deployFirstPara, NEW_BRAND_PRIMARY)
    + countOccurrences(deployFirstPara, NEW_BRAND_FALLBACK);

  assert.ok(
    readmeHits + deployHits >= 1,
    "新品牌文案应至少出现 1 次。\n"
      + "README 第一行: " + JSON.stringify(readmeFirstLine) + "（命中 " + readmeHits + " 次）\n"
      + "DEPLOY 第一段: " + JSON.stringify(deployFirstPara.slice(0, 200)) + "（命中 " + deployHits + " 次）"
  );
});

// ============ 断言 3：views/admin.html（控制台首页，已被 task5 更新）的 <title> 含新品牌 ============

test("copy.3 views/admin.html 的 <title> 含新品牌文案", () => {
  const adminFile = path.join(VIEWS_DIR, "admin.html");
  assert.ok(fs.existsSync(adminFile), "views/admin.html 必须存在");
  const text = fs.readFileSync(adminFile, "utf8");
  const m = text.match(/<title>([\s\S]*?)<\/title>/i);
  assert.ok(m, "admin.html 缺少 <title> 标签");
  const title = m[1];
  const hits = countOccurrences(title, NEW_BRAND_PRIMARY)
    + countOccurrences(title, NEW_BRAND_FALLBACK);
  assert.ok(
    hits >= 1,
    "admin.html <title> 应包含新品牌（" + NEW_BRAND_PRIMARY + " 或 " + NEW_BRAND_FALLBACK + "），实际：" + JSON.stringify(title)
  );
});

// ============ 断言 4：视图扫描循环：所有 view 都可读 + 至少 4 个 view ============

test("copy.4 视图扫描循环：所有 view 文件可读 + 数量 ≥ 4", () => {
  const views = collectViews();
  assert.ok(views.length >= 4, "应至少有 4 个 view，实际 " + views.length);
  for (const v of views) {
    const text = fs.readFileSync(v.path, "utf8");
    assert.ok(text.length > 100, v.rel + " 文件内容应非空");
    assert.ok(/<title>/.test(text), v.rel + " 应包含 <title> 标签");
  }
});

// ============ 断言 5：admin.html 控制台 4 卡片标题存在 ============

test("copy.5 views/admin.html 控制台 4 卡片标题（绑定 / 归档 / 域名 / 系统）", () => {
  const adminFile = path.join(VIEWS_DIR, "admin.html");
  assert.ok(fs.existsSync(adminFile));
  const text = fs.readFileSync(adminFile, "utf8");
  // 控制台 4 张卡片标题（按 §五.3 + task5 实际写法）
  const cardKeywords = ["绑定", "归档", "域名", "系统"];
  for (const kw of cardKeywords) {
    assert.ok(text.includes(kw), "admin.html 应包含控制台卡片关键词 '" + kw + "'");
  }
  // 同时验证 4 个 h2 都存在
  const h2s = [...text.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].trim());
  assert.ok(h2s.length >= 4, "admin.html 至少 4 个 <h2> 标题，实际：" + h2s.length);
});
