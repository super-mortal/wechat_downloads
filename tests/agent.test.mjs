// tests/agent.test.mjs - agent.mjs + commands.mjs 单元测试（node:test，Node 22 内置）
//   覆盖：/help / /all / /count / /unknown / 非命令非 URL / URL 新增 / URL 重复 / URL 抓取失败
//   关键约束：mock downloadArticle，绝不真实访问 mp.weixin.qq.com

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  agent,
  _setDownloadArticleForTest,
  _resetDownloadArticleForTest,
} from "../agent.mjs";
import {
  readIndex,
  writeIndex,
  buildSlug,
  buildEntry,
  _setPathsForTest,
  _resetPathsForTest,
} from "../storage.mjs";

// 临时目录：避免污染真实 data/index.json
let tmpRoot;
let dataDir;

let indexPath;
let publicDir;
let publicIndex;
let savedRealDataIndex;

const FIXED_DATE = new Date("2026-09-17T12:00:00Z"); // 北京时间 20:00
const SAMPLE_URL = "https://mp.weixin.qq.com/s/FtWvOWI2kVVS_1sQiKNWbw";

before(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "wxd-agent-test-"));
  dataDir = path.join(tmpRoot, "data");

  indexPath = path.join(dataDir, "index.json");
  publicDir = path.join(tmpRoot, "public", "wechat", "download");
  publicIndex = path.join(publicDir, "index.json");

  await fsp.mkdir(publicDir, { recursive: true });
  // 备份真实 data/index.json
  const realPath = path.resolve("data", "index.json");
  try {
    savedRealDataIndex = await fsp.readFile(realPath, "utf8");
  } catch (_) {
    savedRealDataIndex = null;
  }
});

after(async () => {
  _resetDownloadArticleForTest();
  _resetPathsForTest();
  // 还原真实 data/index.json
  const realPath = path.resolve("data", "index.json");
  if (savedRealDataIndex !== null) {
    await fsp.writeFile(realPath, savedRealDataIndex, "utf8");
  } else {
    try { await fsp.unlink(realPath); } catch (_) {}
  }
  // 清理临时目录
  try { await fsp.rm(tmpRoot, { recursive: true, force: true }); } catch (_) {}
});

beforeEach(async () => {
  // 切 storage 路径到 tmpRoot
  _setPathsForTest({
    root: tmpRoot,
    dataDir,

    indexPath,
    publicDir,
    publicIndex,
  });
  // 清空 tmp 内的 index / md / html
  try { await fsp.unlink(indexPath); } catch (_) {}
  try { await fsp.unlink(publicIndex); } catch (_) {}

  if (await exists(publicDir)) {
    for (const f of await fsp.readdir(publicDir)) {
      try { await fsp.unlink(path.join(publicDir, f)); } catch (_) {}
    }
  }
});

async function exists(p) {
  try { await fsp.access(p); return true; } catch (_) { return false; }
}

/**
 * 构造一个 mock downloadArticle：写到 tmpRoot/mock-download/<file>.{md,html} 并返回
 * 与真实 article.mjs 一致的 shape：{ ok, url, title, author, outputs: [{format, path}, ...] }。
 * 这样 agent 的 readOutputsContent 能从磁盘读回 md / html。
 */
function makeMockDownloadFactory(opts = {}) {
  const title = opts.title || "示例文章";
  const author = opts.author || "示例作者";
  const htmlBody = opts.htmlBody || "<!doctype html><html><body><h1>" + title + "</h1></body></html>";

  return async () => {
    // 把 mock 产物写到 tmpRoot/mock-download/，避免污染真实目录
    // 注意：bot 流程只下载 HTML（formats: ["html"]），mock 也只产 html，不再产 md
    const mockDir = path.join(tmpRoot, "mock-download");
    await fsp.mkdir(mockDir, { recursive: true });
    const htmlPath = path.join(mockDir, "mock-article.html");
    await fsp.writeFile(htmlPath, htmlBody, "utf8");
    return {
      ok: true,
      url: opts.url || SAMPLE_URL,
      title,
      author,
      publishTime: "2026-09-17",
      imagesDownloaded: 0,
      imagesTotal: 0,
      split: false,
      outputs: [
        { format: "html", filename: "mock-article.html", path: htmlPath },
      ],
    };
  };
}

// ============ a. /help ============

test("a. /help 回执包含「可用命令」", async () => {
  _setDownloadArticleForTest(null); // 命令路径不调 downloadArticle
  const reply = await agent.chat({ text: "/help", conversationId: "c1" });
  assert.equal(typeof reply.text, "string");
  assert.ok(reply.text.includes("可用命令"), "/help 应包含「可用命令」");
  assert.ok(reply.text.includes("/all"));
  assert.ok(reply.text.includes("/count"));
});

// ============ b. /all ============

test("b. /all 回执包含「/wechat/download」", async () => {
  _setDownloadArticleForTest(null);
  const reply = await agent.chat({ text: "/all", conversationId: "c1" });
  assert.equal(typeof reply.text, "string");
  assert.ok(reply.text.includes("/wechat/download"), "/all 应返回列表页 URL");
  // 应包含 baseUrl（baseUrl 在测试里使用兜底 127.0.0.1:3915，因 env/缓存均空）
  assert.match(reply.text, /^https?:\/\/.+\/wechat\/download$/);
});

// ============ c. /count ============

test("c. /count 回执包含「已收录」与数字", async () => {
  _setDownloadArticleForTest(null);
  // 先注入 2 条索引，让 count 有非零数字
  const u1 = "https://mp.weixin.qq.com/s/countU1xxxxxxxxx";
  const u2 = "https://mp.weixin.qq.com/s/countU2xxxxxxxxx";
  await writeIndex([
    buildEntry({ url: u1, title: "t1", author: "a1", slug: buildSlug(u1, "t1", FIXED_DATE), sizeBytes: 1, now: FIXED_DATE }),
    buildEntry({ url: u2, title: "t2", author: "a2", slug: buildSlug(u2, "t2", FIXED_DATE), sizeBytes: 1, now: FIXED_DATE }),
  ]);
  const reply = await agent.chat({ text: "/count", conversationId: "c1" });
  assert.equal(typeof reply.text, "string");
  assert.ok(reply.text.includes("已收录"), "/count 应包含「已收录」");
  assert.match(reply.text, /已收录\s*\d+\s*篇/, "/count 应包含数字");
  assert.ok(reply.text.includes("2"), "索引 2 条时 count 文案应含数字 2");
});

// ============ d. /unknown ============

test("d. /unknown 返回未知命令文案", async () => {
  _setDownloadArticleForTest(null);
  const reply = await agent.chat({ text: "/random", conversationId: "c1" });
  assert.equal(typeof reply.text, "string");
  assert.ok(reply.text.includes("未知命令"), "/unknown 应包含「未知命令」");
  assert.ok(reply.text.includes("/help"), "应提示用户看 /help");
});

// ============ e. 非命令非 URL ============

test("e. 非命令非 URL 返回「请发 mp.weixin.qq.com/s/...」", async () => {
  _setDownloadArticleForTest(null);
  const reply = await agent.chat({ text: "你好，帮我看看天气", conversationId: "c1" });
  assert.equal(typeof reply.text, "string");
  assert.ok(reply.text.includes("mp.weixin.qq.com"), "应提示 mp.weixin.qq.com");
  assert.ok(reply.text.includes("/help"), "应提示 /help");
});

// ============ f. URL 命中 + 新增 ============

test("f. URL 命中 + 新增 → 返回一行 URL（落盘 + 写索引）", async () => {
  const mockDownload = makeMockDownloadFactory({ title: "新增文章标题", author: "新增作者" });
  _setDownloadArticleForTest(mockDownload);

  const reply = await agent.chat({ text: SAMPLE_URL, conversationId: "c1" });
  assert.equal(typeof reply.text, "string");
  // 一行 URL：以 http(s):// 开头，含 /wechat/download/<slug>.html，不带换行 / 不带 emoji
  // v3：回执两行（标题在上，URL 在下）
  const lines = reply.text.split("\n");
  assert.ok(lines.length === 2, "回执应为两行（标题 + URL），实际：" + reply.text);
  assert.match(lines[0], /新增文章标题/, "第一行应为标题");
  assert.match(lines[1], /^https?:\/\/.+\/wechat\/download\/.+\.html$/, "第二行必须是 URL");
  assert.ok(!lines[1].includes("data/md"), "URL 行不应含本地路径 data/md");
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(reply.text), "回执不应含 emoji");

  // 验证落盘：bot 流程现在只落 HTML 到 public/wechat/download/，不再写 data/md/<slug>.md
  // （Markdown 仅由首页下载时按需生成，不入 data/md，也不参与备份/恢复）
  const idx = await readIndex();
  assert.equal(idx.length, 1);
  const slug = idx[0].slug;
  assert.equal(idx[0].url, SAMPLE_URL);
  const htmlFile = path.join(publicDir, slug + ".html");
  assert.ok(await exists(htmlFile), "html 文件应落盘到 public/wechat/download/");
  // data/md/<slug>.md 必须不存在
  const mdFile = path.join(dataDir, "md", slug + ".md");
  assert.ok(!(await exists(mdFile)), "bot 流程不应再写 data/md/<slug>.md");
  const htmlContent = await fsp.readFile(htmlFile, "utf8");
  assert.ok(htmlContent.includes("新增文章标题"), "html 文件应包含标题");
  assert.equal(idx[0].html_url, "/wechat/download/" + slug + ".html");
});

// ============ g. URL 命中 + 已存在 ============

test("g. URL 命中 + 已存在 → 复用旧 URL，不重复抓取", async () => {
  // 先种一条索引（slug 固定）
  const oldSlug = buildSlug(SAMPLE_URL, "旧标题", FIXED_DATE);
  await writeIndex([
    buildEntry({ url: SAMPLE_URL, title: "旧标题", author: "旧作者", slug: oldSlug, sizeBytes: 10, now: FIXED_DATE }),
  ]);

  // mock downloadArticle：若被调用就抛错（确认不应被触发）
  let called = 0;
  _setDownloadArticleForTest(async () => { called++; throw new Error("downloadArticle 不应被调用"); });

  const reply = await agent.chat({ text: SAMPLE_URL, conversationId: "c1" });
  assert.equal(typeof reply.text, "string");
  assert.equal(called, 0, "重复 URL 时不应调用 downloadArticle");
  // 回执 URL 应包含旧 slug
  // v3：两行回执，最后一行是 URL
  const gLines = reply.text.split("\n");
  assert.ok(gLines.length === 2, "回执应为两行");
  assert.match(gLines[0], /旧标题/, "第一行应为旧标题");
  assert.ok(gLines[1].endsWith("/wechat/download/" + oldSlug + ".html"), "应复用旧 slug 的 URL");

  // 索引仍只有一条
  const idx = await readIndex();
  assert.equal(idx.length, 1);
  assert.equal(idx[0].slug, oldSlug);
});

// ============ h. URL 命中 + 抓取失败 ============

test("h. URL 命中 + 抓取失败 → 返回「该文章无法访问，换一条试试」", async () => {
  _setDownloadArticleForTest(async () => { throw new Error("网络超时"); });

  const reply = await agent.chat({ text: SAMPLE_URL, conversationId: "c1" });
  assert.equal(typeof reply.text, "string");
  assert.equal(reply.text, "该文章无法访问，换一条试试");

  // 不应写索引
  const idx = await readIndex();
  assert.equal(idx.length, 0, "抓取失败时不应写索引");
});

test("h2. URL 命中 + downloadArticle 返回 ok:false → 同样失败文案", async () => {
  _setDownloadArticleForTest(async () => ({ ok: false }));

  const reply = await agent.chat({ text: SAMPLE_URL, conversationId: "c1" });
  assert.equal(reply.text, "该文章无法访问，换一条试试");
  const idx = await readIndex();
  assert.equal(idx.length, 0);
});

// 占位引用 before 以触发其注册
before(() => {});
