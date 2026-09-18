// tests/storage.test.mjs - storage.mjs 单元测试（node:test，Node 22 内置）
//   覆盖：buildSlug 稳定 / 中文 / findByUrl / addEntry 去重 / 落盘可读回 / mirror 复制

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

import {
  buildSlug,
  readIndex,
  writeIndex,
  findByUrl,
  addEntry,
  writeMarkdown,
  writeHtml,
  mirrorIndexToPublic,
  buildEntry,
  ensureDirs,
  _setPathsForTest,
  _resetPathsForTest,
  _getPaths,
  StorageError,
} from "../storage.mjs";

// 临时目录：每个测试用独立子目录，避免互相污染
let tmpRoot;
let dataDir;
let mdDir;
let indexPath;
let publicDir;
let publicIndex;
let savedRealDataIndex; // 真实 data/index.json 的内容（测试结束后还原）

const FIXED_DATE = new Date("2026-09-17T12:00:00Z"); // 北京时间 20:00

before(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "wxd-storage-test-"));
  dataDir = path.join(tmpRoot, "data");
  mdDir = path.join(dataDir, "md");
  indexPath = path.join(dataDir, "index.json");
  publicDir = path.join(tmpRoot, "public", "wechat", "download");
  publicIndex = path.join(publicDir, "index.json");
  await fsp.mkdir(mdDir, { recursive: true });
  await fsp.mkdir(publicDir, { recursive: true });
  // 备份真实 data/index.json（避免测试过程中误改）
  const realPath = path.resolve("data", "index.json");
  try {
    savedRealDataIndex = await fsp.readFile(realPath, "utf8");
  } catch (_) {
    savedRealDataIndex = null;
  }
});

after(async () => {
  // 还原 path 模块
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
  // 每次用例：把 storage 的 path 切到 tmpRoot 子目录
  _setPathsForTest({
    root: tmpRoot,
    dataDir,
    mdDir,
    indexPath,
    publicDir,
    publicIndex,
  });
  // 清空 tmp 内的 index 与 md / html
  try { await fsp.unlink(indexPath); } catch (_) {}
  try { await fsp.unlink(publicIndex); } catch (_) {}
  if (await exists(mdDir)) {
    for (const f of await fsp.readdir(mdDir)) {
      try { await fsp.unlink(path.join(mdDir, f)); } catch (_) {}
    }
  }
  if (await exists(publicDir)) {
    for (const f of await fsp.readdir(publicDir)) {
      try { await fsp.unlink(path.join(publicDir, f)); } catch (_) {}
    }
  }
});

async function exists(p) {
  try { await fsp.access(p); return true; } catch (_) { return false; }
}

function mkUrl(slug) {
  return "https://mp.weixin.qq.com/s/" + slug;
}

// ============ buildSlug ============

test("buildSlug v3: 同一 url + 时间 → 同一 slug（仅 date+hash6）", () => {
  const url = mkUrl("FtWvOWI2kVVS_1sQiKNWbw");
  const a = buildSlug(url, "示例文章", FIXED_DATE);
  const b = buildSlug(url, "示例文章", FIXED_DATE);
  assert.equal(a, b);
  // v3 形如 <yyyy-mm-dd>-<hash6>，title 不再进 URL
  const expectedHash = crypto.createHash("md5").update(url).digest("hex").slice(0, 6);
  assert.equal(a, "2026-09-17-" + expectedHash);
});

test("buildSlug: 中文 title 不抛错（保留中文字符）", () => {
  const url = mkUrl("abc123");
  const s = buildSlug(url, "微信公众号：测试中文标题");
  assert.ok(typeof s === "string" && s.length > 0);
  // 形如 <date>-<title>-<hash6>
  assert.match(s, /^\d{4}-\d{2}-\d{2}-.+/);
});

test("buildSlug v3: title 不进 URL（仅 date+hash6）", () => {
  const url = mkUrl("zzz111");
  const s = buildSlug(url, "  hello   world  ", FIXED_DATE);
  // v3 不再处理 title → 直接 hash
  const expectedHash = crypto.createHash("md5").update(url).digest("hex").slice(0, 6);
  assert.equal(s, "2026-09-17-" + expectedHash);
});

test("buildSlug v3: 非法字符不影响 slug（title 不进 URL）", () => {
  const url = mkUrl("ccc333");
  const s = buildSlug(url, "a/b\\c:d*e?f\"g<h>i|j", FIXED_DATE);
  // 非法字符被剥除后剩 "abcdefghij"，再合并 -、去首尾 -
  const expectedHash = crypto.createHash("md5").update(url).digest("hex").slice(0, 6);
  assert.equal(s, "2026-09-17-" + expectedHash);
});

test("buildSlug: 空 url 抛 StorageError WXD-STORAGE-0002", () => {
  assert.throws(
    () => buildSlug("", "title"),
    (err) => err instanceof StorageError && err.error_code === "WXD-STORAGE-0002"
  );
});

// ============ readIndex / writeIndex ============

test("readIndex: 不存在时返回 []", async () => {
  const idx = await readIndex();
  assert.deepEqual(idx, []);
});

test("writeIndex: 原子写（writeIndex 后能 readIndex 拿到）", async () => {
  const arr = [{ slug: "a-123456", url: mkUrl("a") }];
  await writeIndex(arr);
  const idx = await readIndex();
  assert.equal(idx.length, 1);
  assert.equal(idx[0].slug, "a-123456");
});

test("writeIndex: 非数组抛 WXD-STORAGE-0001", async () => {
  await assert.rejects(
    () => writeIndex({ not: "array" }),
    (err) => err instanceof StorageError && err.error_code === "WXD-STORAGE-0001"
  );
});

test("readIndex: 非法 JSON 内容抛 WXD-STORAGE-0001", async () => {
  await fsp.writeFile(indexPath, "not json {", "utf8");
  await assert.rejects(
    () => readIndex(),
    (err) => err instanceof StorageError && err.error_code === "WXD-STORAGE-0001"
  );
});

// ============ findByUrl ============

test("findByUrl: 在 index 中找到相同 url 的条目", async () => {
  const url = mkUrl("findme");
  const entry = { slug: "s-x1y2z3", url, title: "t" };
  await writeIndex([entry, { slug: "other-aaaaaa", url: mkUrl("other"), title: "o" }]);
  const found = await findByUrl(url);
  assert.ok(found);
  assert.equal(found.slug, "s-x1y2z3");
  assert.equal(found.title, "t");
});

test("findByUrl: 找不到时返回 null", async () => {
  await writeIndex([{ slug: "s-aaaaaa", url: mkUrl("a"), title: "t" }]);
  const found = await findByUrl(mkUrl("nothere"));
  assert.equal(found, null);
});

// ============ addEntry ============

test("addEntry: 新 url 追加并 writeIndex（落盘可读回）", async () => {
  const url = mkUrl("newurl");
  const slug = buildSlug(url, "new title", FIXED_DATE);
  const entry = buildEntry({ url, title: "new title", author: "作者", slug, sizeBytes: 1024, now: FIXED_DATE });
  const ret = await addEntry(entry);
  assert.equal(ret.slug, entry.slug);
  assert.equal(ret.url, entry.url);
  assert.equal(ret.html_url, "/wechat/download/" + slug + ".html");
  // 落盘验证
  const idx = await readIndex();
  assert.equal(idx.length, 1);
  assert.equal(idx[0].url, url);
  assert.equal(idx[0].slug, slug);
  assert.equal(idx[0].created_at, "2026-09-17T20:00:00+08:00");
});

test("addEntry: 同 url 已存在则跳过（不重复写入）", async () => {
  const url = mkUrl("dupurl");
  const slug = buildSlug(url, "dup title", FIXED_DATE);
  const entry1 = buildEntry({ url, title: "dup title", slug, sizeBytes: 1, now: FIXED_DATE });
  await addEntry(entry1);
  // 第二次 addEntry 同一个 url（不同 size）
  const entry2 = buildEntry({ url, title: "dup title", slug, sizeBytes: 999, now: FIXED_DATE });
  const ret = await addEntry(entry2);
  // 应返回原 entry（即 size=1）
  assert.equal(ret.size_bytes, 1);
  // 索引里仍只有 1 条
  const idx = await readIndex();
  assert.equal(idx.length, 1);
  assert.equal(idx[0].size_bytes, 1);
});

test("addEntry: 同 slug 不同 url 抛 WXD-STORAGE-0002（slug 冲突）", async () => {
  // 旧 entry：slug = "2026-09-17-same-slug-aaaaaa" / url = U1（hash6=aaaaaa）
  // 新 entry：slug 同上 / url = U2（hash6 应为 U2 的 hash6）
  // 模拟外部把同一个 slug 塞给两个不同 URL 的情况 → 抛 0002
  const oldUrl = mkUrl("conflict-old");
  const newUrl = mkUrl("conflict-new");
  // 手动构造两个 entry，让它们的 slug 字符串完全相同但 url 不同
  const sharedSlug = "2026-09-17-shared-collision-zzzzzz";
  const oldEntry = {
    slug: sharedSlug,
    url: oldUrl,
    title: "old",
    md_path: "data/md/old.md",
    html_url: "/wechat/download/old.html",
    created_at: "2026-09-17T20:00:00+08:00",
    size_bytes: 0,
  };
  await writeIndex([oldEntry]);
  const newEntry = buildEntry({
    url: newUrl,
    title: "new",
    slug: sharedSlug,
    sizeBytes: 1,
    now: FIXED_DATE,
  });
  await assert.rejects(
    () => addEntry(newEntry),
    (err) => err instanceof StorageError && err.error_code === "WXD-STORAGE-0002"
  );
});;

test("addEntry: 非法 entry（缺 slug / url）抛 WXD-STORAGE-0001", async () => {
  await assert.rejects(
    () => addEntry({ url: mkUrl("x") }), // 缺 slug
    (err) => err instanceof StorageError && err.error_code === "WXD-STORAGE-0001"
  );
  await assert.rejects(
    () => addEntry({ slug: "s-zzzzzz" }), // 缺 url
    (err) => err instanceof StorageError && err.error_code === "WXD-STORAGE-0001"
  );
});

// ============ writeMarkdown / writeHtml ============

test("writeMarkdown: 落盘后能读回（自动建目录）", async () => {
  const slug = "2026-09-17-md-test-aaaaaa";
  const ret = await writeMarkdown(slug, "# 标题\n\n正文");
  assert.equal(ret.relPath, "data/md/" + slug + ".md");
  // 验证文件存在
  const realPath = path.join(mdDir, slug + ".md");
  const got = await fsp.readFile(realPath, "utf8");
  assert.equal(got, "# 标题\n\n正文");
});

test("writeHtml: 落盘后能读回（自动建目录）", async () => {
  const slug = "2026-09-17-html-test-bbbbbb";
  const ret = await writeHtml(slug, "<!doctype html><html><body>hi</body></html>");
  assert.equal(ret.relPath, "/wechat/download/" + slug + ".html");
  const realPath = path.join(publicDir, slug + ".html");
  const got = await fsp.readFile(realPath, "utf8");
  assert.equal(got, "<!doctype html><html><body>hi</body></html>");
});

test("writeMarkdown: 空 slug 抛 WXD-STORAGE-0003", async () => {
  await assert.rejects(
    () => writeMarkdown("", "x"),
    (err) => err instanceof StorageError && err.error_code === "WXD-STORAGE-0003"
  );
});

test("writeHtml: 空 slug 抛 WXD-STORAGE-0003", async () => {
  await assert.rejects(
    () => writeHtml("", "x"),
    (err) => err instanceof StorageError && err.error_code === "WXD-STORAGE-0003"
  );
});

// ============ mirrorIndexToPublic ============

test("mirrorIndexToPublic: 复制 data/index.json 到 public/wechat/download/index.json", async () => {
  const url1 = mkUrl("m1");
  const url2 = mkUrl("m2");
  const slug1 = buildSlug(url1, "m1 title", FIXED_DATE);
  const slug2 = buildSlug(url2, "m2 title", FIXED_DATE);
  await addEntry(buildEntry({ url: url1, title: "m1 title", slug: slug1, sizeBytes: 11, now: FIXED_DATE }));
  await addEntry(buildEntry({ url: url2, title: "m2 title", slug: slug2, sizeBytes: 22, now: FIXED_DATE }));

  const ret = await mirrorIndexToPublic();
  assert.equal(ret.count, 2);
  // 公共 index 存在且内容一致
  const publicData = JSON.parse(await fsp.readFile(publicIndex, "utf8"));
  const privateData = await readIndex();
  assert.equal(publicData.length, privateData.length);
  assert.equal(publicData[0].slug, privateData[0].slug);
  assert.equal(publicData[1].slug, privateData[1].slug);
});

// ============ buildEntry 形状 ============

test("buildEntry: 字段齐全且 created_at 是 +08:00", () => {
  const url = mkUrl("shape");
  const slug = buildSlug(url, "形状", FIXED_DATE);
  const e = buildEntry({ url, title: "形状", author: "作者", slug, sizeBytes: 100, now: FIXED_DATE });
  assert.deepEqual(Object.keys(e).sort(), [
    "author", "created_at", "html_url", "md_path", "size_bytes", "slug", "title", "url"
  ]);
  assert.equal(e.created_at, "2026-09-17T20:00:00+08:00");
  assert.equal(e.html_url, "/wechat/download/" + slug + ".html");
  assert.equal(e.md_path, "data/md/" + slug + ".md");
});

// 占位引用 before 以触发其注册
before(() => {});

