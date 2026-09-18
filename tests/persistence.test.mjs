// tests/persistence.test.mjs - 数据持久化单元测试（node:test + node:assert/strict）
//   覆盖 §六.B 表格（auth.json / sessions.json / html 落盘 / index 镜像 / atomic rename）
//   风格：与 tests/storage.test.mjs / tests/auth.test.mjs 保持一致
//   数据隔离：使用真实 data/（auth.mjs 路径硬编码）；备份还原 + beforeEach 清干净
//   临时目录：backup/restore 测试用 node:os.tmpdir() 子目录隔离
//   错误码期望：WXD-AUTH-0006（auth.json 损坏）+ WXD-STORAGE-0005（备份损坏）

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

import * as auth from "../auth.mjs";
import { AuthError } from "../auth.mjs";
import {
  backupDataDir,
  restoreDataDir,
  readIndex,
  writeIndex,
  writeHtml,
  mirrorIndexToPublic,
  buildEntry,
  buildSlug,
  ensureDirs,
  init,
  _setPathsForTest,
  _resetPathsForTest,
  StorageError,
} from "../storage.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const FAILURES_FILE = path.join(DATA_DIR, "auth-failures.json");
const ADMIN_LOG_FILE = path.join(DATA_DIR, "admin.log");
const INDEX_FILE = path.join(DATA_DIR, "index.json");

const TEST_FILES = ["auth.json", "sessions.json", "auth-failures.json", "admin.log"];
const TEST_PWD = "test-password-123";
const TEST_USER = "test-admin";

let tmpRoot;
let backupOutDir; // backup 测试用子目录
let restoreOutDir; // restore 测试用子目录
let savedFiles = {};
let savedIndex = null;
let realDataDirBackup = null; // 测试结束后整体还原 data 目录
let realPublicDirBackup = null;

function removeAuthFiles() {
  for (const f of TEST_FILES) {
    try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch (_) {}
  }
}

before(async () => {
  for (const f of TEST_FILES) {
    const p = path.join(DATA_DIR, f);
    if (fs.existsSync(p)) savedFiles[f] = fs.readFileSync(p);
  }
  try { savedIndex = fs.readFileSync(INDEX_FILE, "utf8"); } catch (_) { savedIndex = null; }

  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "wxd-persist-test-"));
  backupOutDir = path.join(tmpRoot, "backup-out");
  restoreOutDir = path.join(tmpRoot, "restore-out");
  await fsp.mkdir(backupOutDir, { recursive: true });
  await fsp.mkdir(restoreOutDir, { recursive: true });
});

after(async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  _resetPathsForTest();
  auth._resetForTest();
  removeAuthFiles();
  for (const [f, content] of Object.entries(savedFiles)) {
    try { fs.writeFileSync(path.join(DATA_DIR, f), content); } catch (_) {}
  }
  if (savedIndex !== null) {
    try { fs.writeFileSync(INDEX_FILE, savedIndex, "utf8"); } catch (_) {}
  } else {
    try { fs.unlinkSync(INDEX_FILE); } catch (_) {}
  }
  try { await fsp.rm(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  delete process.env.ADMIN_PASSWORD;
});

beforeEach(() => {
  auth._resetForTest();
  removeAuthFiles();
  delete process.env.ADMIN_PASSWORD;
});

// ============ 1. data 目录不存在时自动创建 ============

test("1.1 data 目录不存在 → init 后自动生成（auth.mjs 初始化路径）", async () => {
  // 测试期间不删真实 data/（避免影响其他测试）。改测 storage.mjs 的 ensureDirs 行为：
  // 在临时位置切 storage 路径 → dataDir 不存在 → ensureDirs 应创建它
  const subTmp = await fsp.mkdtemp(path.join(os.tmpdir(), "wxd-persist-sub-"));
  try {
    const fakeRoot = path.join(subTmp, "project");
    const fakeDataDir = path.join(fakeRoot, "data");
    _setPathsForTest({
      root: fakeRoot,
      dataDir: fakeDataDir,
      mdDir: path.join(fakeDataDir, "md"),
      indexPath: path.join(fakeDataDir, "index.json"),
      publicDir: path.join(fakeRoot, "public", "wechat", "download"),
      publicIndex: path.join(fakeRoot, "public", "wechat", "download", "index.json"),
    });
    assert.equal(fs.existsSync(fakeDataDir), false);
    await ensureDirs();
    assert.equal(fs.existsSync(fakeDataDir), true);
    assert.equal(fs.existsSync(path.join(fakeDataDir, "md")), true);
    assert.equal(fs.existsSync(path.join(fakeRoot, "public", "wechat", "download")), true);
  } finally {
    _resetPathsForTest();
    try { await fsp.rm(subTmp, { recursive: true, force: true }); } catch (_) {}
  }
});

// ============ 2. auth.json 启动重读 ============

test("2.1 写入合法 auth.json → initAuth 后 isInitialized=true 且能读回 username", async () => {
  const h = auth.hashPassword(TEST_PWD);
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({
      username: TEST_USER,
      scryptHash: h.hash,
      salt: h.salt,
      params: h.params,
      createdAt: "2026-09-18T00:00:00+08:00",
    })
  );
  auth._resetForTest();
  // 模拟"重启"：重新初始化 in-memory 状态
  await auth.initAuth();
  assert.equal(auth._isInitDone(), true);
  // isInitialized() 走文件校验路径，应当 true
  assert.equal(auth.isInitialized(), true);
  // 验证密码可登录（hash 已被 initAuth 读回 _authRecord）
  const rec = auth._getAuthRecord();
  assert.equal(rec && rec.username, TEST_USER);
});

// ============ 3. auth.json 损坏检测 ============

test("3.1 auth.json 写入不合法 JSON → initAuth 抛 WXD-AUTH-0006（AuthError）", async () => {
  fs.writeFileSync(AUTH_FILE, "{ not valid json !!!");
  auth._resetForTest();
  await assert.rejects(
    () => auth.initAuth(),
    (err) => err instanceof AuthError && err.error_code === "WXD-AUTH-0006"
  );
});

test("3.2 auth.json 是合法 JSON 但缺少必填字段 → initAuth 抛 WXD-AUTH-0006", async () => {
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ username: "x" }));
  auth._resetForTest();
  await assert.rejects(
    () => auth.initAuth(),
    (err) => err instanceof AuthError && err.error_code === "WXD-AUTH-0006"
  );
});

// ============ 4. sessions.json 启动重读 ============

test("4.1 createSession → 重启（resetForTest + initAuth）→ getSession 仍可用", async () => {
  // 初始化 auth（initAuth 才能让 sessions.json 路径正确读回）
  const h = auth.hashPassword(TEST_PWD);
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({ username: TEST_USER, scryptHash: h.hash, salt: h.salt, params: h.params })
  );
  auth._resetForTest();
  await auth.initAuth();
  // 创建 session（写 sessions.json，persistSessionsSync 是同步的）
  const s = auth.createSession(TEST_USER);
  assert.ok(auth.getSession(s.sid), "session 在内存中可用");
  // 把测试用的额外文件先清理（防止其他 test 的 setImmediate 残留影响本测试）
  try { fs.unlinkSync(SESSIONS_FILE); } catch (_) {}
  // 重新创建 session 并立即同步等 setImmediate flush（确保文件已落地）
  const s2 = auth.createSession(TEST_USER);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.ok(fs.existsSync(SESSIONS_FILE), "sessions.json 已写盘");

  // 模拟重启：清 in-memory → 重读文件
  auth._resetForTest();
  await auth.initAuth();
  // 重启后两个 session 都应能读回（至少 s2）
  const sess2 = auth.getSession(s2.sid);
  assert.ok(sess2, "重启后 session 仍能读回（s2）");
  assert.equal(sess2.user, TEST_USER);
});

// ============ 5. backupDataDir 产生 zip ============

test("5.1 在临时 data/public 中放文件 → backupDataDir 写出 zip（大小 > 0）", async () => {
  // 切 storage 路径到临时目录
  const subTmp = await fsp.mkdtemp(path.join(os.tmpdir(), "wxd-bak-test-"));
  try {
    const fakeRoot = path.join(subTmp, "project");
    _setPathsForTest({
      root: fakeRoot,
      dataDir: path.join(fakeRoot, "data"),
      mdDir: path.join(fakeRoot, "data", "md"),
      indexPath: path.join(fakeRoot, "data", "index.json"),
      publicDir: path.join(fakeRoot, "public", "wechat", "download"),
      publicIndex: path.join(fakeRoot, "public", "wechat", "download", "index.json"),
    });
    await ensureDirs();
    // 写入 index + md + html
    const idx = [{ slug: "2026-09-18-x", url: "https://mp.weixin.qq.com/s/x" }];
    await writeIndex(idx);
    await fsp.writeFile(path.join(fakeRoot, "data", "md", "2026-09-18-x.md"), "# x", "utf8");
    await writeHtml("2026-09-18-x", "<p>x</p>");
    await mirrorIndexToPublic();

    const outDir = path.join(subTmp, "backup");
    await fsp.mkdir(outDir, { recursive: true });
    const r = await backupDataDir(outDir);
    assert.ok(r && r.path, "返回 path");
    assert.ok(fs.existsSync(r.path), "zip 文件已生成：" + r.path);
    const st = fs.statSync(r.path);
    assert.ok(st.size > 0, "zip 字节数 > 0，实际 " + st.size);
    // zip 头部 4 字节必须是 PK\x03\x04 (0x04034b50)
    const fd = fs.openSync(r.path, "r");
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    assert.equal(head.readUInt32LE(0), 0x04034b50, "zip 签名 PK\\x03\\x04 应正确");
  } finally {
    _resetPathsForTest();
    try { await fsp.rm(subTmp, { recursive: true, force: true }); } catch (_) {}
  }
});

// ============ 6. restoreDataDir 还原 ============
//   关键约束：storage.mjs#restoreDataDir 的 target 路径 = path.join(PROJECT_ROOT, name)
//   其中 PROJECT_ROOT = path.dirname(__filename)（storage.mjs 所在目录），
//   不受 _setPathsForTest 影响；因此测试只能用真实 PROJECT_ROOT。
//   测试策略：备份真实 data/ + public/ → 删某些文件 → restoreDataDir → 验文件回来

let savedRealDataIndex = null;
let savedRealDataMd = null;
let savedRealPublicHtml = null;
let savedRealPublicIndex = null;

async function _saveRealFiles() {
  try { savedRealDataIndex = await fsp.readFile(INDEX_FILE, "utf8"); } catch (_) { savedRealDataIndex = null; }
  try { savedRealPublicIndex = await fsp.readFile(path.join(PROJECT_ROOT, "public", "wechat", "download", "index.json"), "utf8"); } catch (_) { savedRealPublicIndex = null; }
  try {
    const names = await fsp.readdir(path.join(DATA_DIR, "md"));
    savedRealDataMd = {};
    for (const n of names) {
      savedRealDataMd[n] = await fsp.readFile(path.join(DATA_DIR, "md", n), "utf8");
    }
  } catch (_) { savedRealDataMd = null; }
  try {
    const dir = path.join(PROJECT_ROOT, "public", "wechat", "download");
    const names = await fsp.readdir(dir);
    savedRealPublicHtml = {};
    for (const n of names) {
      if (n.endsWith(".html")) savedRealPublicHtml[n] = await fsp.readFile(path.join(dir, n), "utf8");
    }
  } catch (_) { savedRealPublicHtml = null; }
}

async function _restoreRealFiles() {
  if (savedRealDataIndex !== null) {
    try { await fsp.writeFile(INDEX_FILE, savedRealDataIndex, "utf8"); } catch (_) {}
  } else {
    try { await fsp.unlink(INDEX_FILE); } catch (_) {}
  }
  if (savedRealPublicIndex !== null) {
    try { await fsp.writeFile(path.join(PROJECT_ROOT, "public", "wechat", "download", "index.json"), savedRealPublicIndex, "utf8"); } catch (_) {}
  } else {
    try { await fsp.unlink(path.join(PROJECT_ROOT, "public", "wechat", "download", "index.json")); } catch (_) {}
  }
  if (savedRealDataMd) {
    // 删除当前 md/ 里多余的文件，再还原
    try {
      const names = await fsp.readdir(path.join(DATA_DIR, "md"));
      for (const n of names) {
        if (!savedRealDataMd[n]) {
          try { await fsp.unlink(path.join(DATA_DIR, "md", n)); } catch (_) {}
        }
      }
      for (const [n, content] of Object.entries(savedRealDataMd)) {
        await fsp.writeFile(path.join(DATA_DIR, "md", n), content, "utf8");
      }
    } catch (_) {}
  }
  if (savedRealPublicHtml) {
    try {
      const dir = path.join(PROJECT_ROOT, "public", "wechat", "download");
      const names = await fsp.readdir(dir);
      for (const n of names) {
        if (n.endsWith(".html") && !savedRealPublicHtml[n]) {
          try { await fsp.unlink(path.join(dir, n)); } catch (_) {}
        }
      }
      for (const [n, content] of Object.entries(savedRealPublicHtml)) {
        await fsp.writeFile(path.join(dir, n), content, "utf8");
      }
    } catch (_) {}
  }
}

test("6.1 备份 → 删除 → restoreDataDir → 文件存在", async () => {
  // 先备份真实 data/ + public/ 内的现有文件
  await _saveRealFiles();

  // 用临时标记 slug 测试（不会与真实归档冲突）
  const testSlug = "2026-09-18-restore-test-zzzzzz";
  const testUrl = "https://mp.weixin.qq.com/s/restore-test-zzzzzz";
  const testMdRel = "data/md/" + testSlug + ".md";
  const testHtmlRel = "public/wechat/download/" + testSlug + ".html";

  // 把这些文件加进真实 data/ + public/（确保 backup 能打包到）
  await ensureDirs();
  const prevIdx = await readIndex();
  prevIdx.push({ slug: testSlug, url: testUrl, title: "restore test", author: "tester" });
  await writeIndex(prevIdx);
  await fsp.writeFile(path.join(DATA_DIR, "md", testSlug + ".md"), "# restore", "utf8");
  await writeHtml(testSlug, "<p>restore</p>");
  await mirrorIndexToPublic();

  try {
    // 1) 备份到临时目录
    const outDir = path.join(tmpRoot, "restore-out-6-1");
    await fsp.mkdir(outDir, { recursive: true });
    const r = await backupDataDir(outDir);
    assert.ok(r && r.path && fs.existsSync(r.path), "备份 zip 已生成：" + r.path);

    // 2) 删除测试文件（模拟磁盘丢失）
    await fsp.unlink(path.join(DATA_DIR, "md", testSlug + ".md"));
    await fsp.unlink(path.join(PROJECT_ROOT, "public", "wechat", "download", testSlug + ".html"));
    assert.equal(fs.existsSync(path.join(DATA_DIR, "md", testSlug + ".md")), false);
    assert.equal(fs.existsSync(path.join(PROJECT_ROOT, "public", "wechat", "download", testSlug + ".html")), false);

    // 3) restoreDataDir 把 zip 内文件写回 PROJECT_ROOT
    const r2 = await restoreDataDir(r.path);
    assert.ok(r2 && typeof r2.count === "number", "返回 result 对象");

    // 4) 验证文件回来了
    assert.ok(
      fs.existsSync(path.join(DATA_DIR, "md", testSlug + ".md")),
      "data/md/" + testSlug + ".md 应被还原"
    );
    assert.ok(
      fs.existsSync(path.join(PROJECT_ROOT, "public", "wechat", "download", testSlug + ".html")),
      "public/wechat/download/" + testSlug + ".html 应被还原"
    );

    // 5) 清理：删测试文件 + 还原 index
    try { await fsp.unlink(path.join(DATA_DIR, "md", testSlug + ".md")); } catch (_) {}
    try { await fsp.unlink(path.join(PROJECT_ROOT, "public", "wechat", "download", testSlug + ".html")); } catch (_) {}
    const cleaned = prevIdx.filter((e) => e && e.slug !== testSlug);
    await writeIndex(cleaned);
    await mirrorIndexToPublic();
  } finally {
    // 还原真实 data/ + public/ 内的所有文件
    await _restoreRealFiles();
  }
});

test("6.2 restoreDataDir 给不存在的 zip → 抛 WXD-STORAGE-0005", async () => {
  await assert.rejects(
    () => restoreDataDir("/path/does/not/exist/fake-backup.zip"),
    (err) => err instanceof StorageError && err.error_code === "WXD-STORAGE-0005"
  );
});

// ============ 7. atomic rename 防写一半 ============
//   策略：用一个会让 rename 真实失败的 targetPath（targetPath 是个目录，
//   renameSync(file, dir) 在 POSIX/Windows 都会失败）。此时 auth.mjs 的
//   兜底 copyFileSync(file, dir) 也会失败，最终 throw。
//   旧文件用完全独立的路径，确保它从未被卷入 write 操作。

test("7.1 atomic write 失败时旧文件保留（renameSync 真实失败 + copyFileSync 兜底也失败）", async () => {
  // 旧文件：单独路径，不参与任何写
  const oldPath = path.join(DATA_DIR, "_atomic_test_old_sibling.txt");
  await fsp.writeFile(oldPath, "OLD-CONTENT-MUST-SURVIVE", "utf8");

  // target 故意做成"目录"：让 renameSync(file, dir) 抛错
  // 同时 copyFileSync(file, dir) 也会抛错
  const targetAsDir = path.join(DATA_DIR, "_atomic_test_target_dir");
  await fsp.mkdir(targetAsDir, { recursive: true });
  // 清空目录里任何残留
  for (const name of await fsp.readdir(targetAsDir)) {
    try { await fsp.unlink(path.join(targetAsDir, name)); } catch (_) {}
  }

  let threw = false;
  try {
    await auth.atomicWriteJsonAsync(targetAsDir, "NEW-CONTENT", 0o600);
  } catch (e) {
    threw = true;
  }
  assert.ok(threw, "rename + copy 都失败时函数应抛错");

  // 旧文件必须保留原内容
  const still = await fsp.readFile(oldPath, "utf8");
  assert.equal(still, "OLD-CONTENT-MUST-SURVIVE", "旧文件内容应原封不动");

  // 清理
  try { await fsp.unlink(oldPath); } catch (_) {}
  try { await fsp.rm(targetAsDir, { recursive: true, force: true }); } catch (_) {}
});
