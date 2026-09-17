import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");
const SERVER_ENTRY = path.join(PROJECT_ROOT, "server.mjs");
const PORT = 3915;
const BASE = "http://127.0.0.1:" + PORT;

const TEST_SLUG = "2026-09-17-test-article-test01";
const TEST_URL = "https://mp.weixin.qq.com/s/FakeTest0001";
const TEST_HTML_FILE = path.join(PROJECT_ROOT, "public", "wechat", "download", TEST_SLUG + ".html");
const TEST_PUB_INDEX = path.join(PROJECT_ROOT, "public", "wechat", "download", "index.json");

// 中文 slug（hash6 = '7eef21'，与测试报告保持一致）—— 验证服务端 decodeURIComponent
const CN_SLUG = "2026-09-17-测试种子文章-7eef21";
const CN_URL = "https://mp.weixin.qq.com/s/TEST_SEED_001";
const CN_HTML_FILE = path.join(PROJECT_ROOT, "public", "wechat", "download", CN_SLUG + ".html");

let serverProc;
let cleanup = [];

function get(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + urlPath, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        })
      );
    });
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("timeout")));
  });
}

before(async () => {
  // 1) 预填充测试数据
  const storage = await import("../storage.mjs");
  const entry = storage.buildEntry({
    url: TEST_URL,
    title: "测试文章标题",
    author: "测试公众号",
    slug: TEST_SLUG,
    mdPath: "data/md/" + TEST_SLUG + ".md",
    sizeBytes: 0,
    now: new Date("2026-09-17T22:00:00+08:00"),
  });
  await storage.addEntry(entry);
  await storage.writeHtml(TEST_SLUG, "<!doctype html><title>test</title><p>hello-test</p>");

  // 中文 slug 入口：验证服务端 decodeURIComponent（task7 修复）
  const cnEntry = storage.buildEntry({
    url: CN_URL,
    title: "测试种子文章",
    author: "测试公众号",
    slug: CN_SLUG,
    mdPath: "data/md/" + CN_SLUG + ".md",
    sizeBytes: 0,
    now: new Date("2026-09-17T22:00:00+08:00"),
  });
  await storage.addEntry(cnEntry);
  await storage.writeHtml(CN_SLUG, "<!doctype html><title>测试</title><p>种子文章</p>");
  await storage.mirrorIndexToPublic();
  cleanup.push(async () => {
    try { await fsp.unlink(TEST_HTML_FILE); } catch (_) {}
    try { await fsp.unlink(CN_HTML_FILE); } catch (_) {}
    try { await fsp.unlink(TEST_PUB_INDEX); } catch (_) {}
  });
  const idx = await storage.readIndex();
  const filtered = idx.filter((e) => e && e.slug !== TEST_SLUG && e.slug !== CN_SLUG);
  cleanup.push(async () => {
    await storage.writeIndex(filtered);
  });

  // 2) spawn server
  serverProc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, WECHAT_BOT: "" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("server start timeout: " + buf)), 8000);
    serverProc.stdout.on("data", (d) => {
      buf += d.toString();
      if (buf.includes("ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProc.stderr.on("data", (d) => { buf += d.toString(); });
  });
});

after(async () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (!serverProc.killed) serverProc.kill("SIGKILL");
  }
  for (let i = cleanup.length - 1; i >= 0; i--) {
    try { await cleanup[i](); } catch (_) {}
  }
});

test("a. GET /wechat/download 返回 200 HTML（列表页路由注册）", async () => {
  const r = await get("/wechat/download");
  assert.equal(r.status, 200, "应当 200；body 前 200 字节：" + r.body.slice(0, 200));
  assert.match(r.headers["content-type"], /text\/html/);
  assert.match(r.body, /已收录/);
  assert.match(r.body, /test-article-test01\.html/);
});

test("b. GET /wechat/download/<slug>.html 返回 200 HTML（单篇路由注册）", async () => {
  // 在请求前确认文件在磁盘上
  assert.ok(fs.existsSync(TEST_HTML_FILE), "测试前应当存在文件: " + TEST_HTML_FILE);
  const r = await get("/wechat/download/" + TEST_SLUG + ".html");
  assert.equal(r.status, 200, "应当 200；body 前 200 字节：" + r.body.slice(0, 200));
  assert.match(r.headers["content-type"], /text\/html/);
  assert.match(r.body, /hello-test/);
});

test("b-cn. GET /wechat/download/<中文-slug>.html 返回 200（验证 decodeURIComponent）", async () => {
  // 文件名在磁盘上是含中文的；客户端需要把它 URL-encode 后发请求，服务端必须 decode
  assert.ok(fs.existsSync(CN_HTML_FILE), "测试前应当存在中文文件: " + CN_HTML_FILE);
  const encodedPath = "/wechat/download/" + encodeURIComponent(CN_SLUG) + ".html";
  const r = await get(encodedPath);
  assert.equal(r.status, 200, "应当 200；body 前 200 字节：" + r.body.slice(0, 200));
  assert.match(r.headers["content-type"], /text\/html/);
  assert.match(r.body, /测试/);
  assert.match(r.body, /种子文章/);
});

test("b2. GET /wechat/download/<slug>.html 不存在 → 404 + WXD-HTTP-0002", async () => {
  const r = await get("/wechat/download/notfound-slug-test01.html");
  assert.equal(r.status, 404);
  assert.match(r.headers["content-type"], /application\/json/);
  assert.match(r.body, /WXD-HTTP-0002/);
});

test("c. GET /wechat/download/index.json 返回 200 JSON（数据源路由注册）", async () => {
  const r = await get("/wechat/download/index.json");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /application\/json/);
  const data = JSON.parse(r.body);
  assert.ok(Array.isArray(data));
  const ours = data.find((e) => e && e.slug === TEST_SLUG);
  assert.ok(ours);
  assert.equal(ours.html_url, "/wechat/download/" + TEST_SLUG + ".html");
});
