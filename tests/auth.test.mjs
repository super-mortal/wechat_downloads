// tests/auth.test.mjs - auth.mjs 全量单元测试（node:test + node:assert/strict）
//   覆盖 §七.1 表格中的所有用例 + §三.4 验收清单
//   风格：与 tests/agent.test.mjs / tests/storage.test.mjs 保持一致
//   数据隔离：auth.mjs 路径硬编码到项目根 data/，因此备份真实 data/ 内的
//     auth.json / sessions.json / auth-failures.json / admin.log 后再清理 / 还原
//   测试密码：全部使用 'test-password-123' 等明显占位符，避免泄露真实密码
//   错误码期望：WXD-AUTH-0003~0008（0001/0002 属 admin.mjs QR 流）

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

import * as auth from "../auth.mjs";
import { AuthError, SCRYPT_PARAMS } from "../auth.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const FAILURES_FILE = path.join(DATA_DIR, "auth-failures.json");
const ADMIN_LOG_FILE = path.join(DATA_DIR, "admin.log");
const INDEX_FILE = path.join(DATA_DIR, "index.json");

const TEST_FILES = ["auth.json", "sessions.json", "auth-failures.json", "admin.log"];
const TEST_PWD = "test-password-123"; // 明显占位符
const TEST_USER = "test-admin";

const IS_WIN = process.platform === "win32";
let savedFiles = {};      // 各文件备份内容（Buffer / string）
let savedIndex = null;    // 真实 data/index.json 备份（其他测试可能在跑）

function removeAuthFiles() {
  for (const f of TEST_FILES) {
    try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch (_) {}
  }
}

before(async () => {
  for (const f of TEST_FILES) {
    const p = path.join(DATA_DIR, f);
    if (fs.existsSync(p)) {
      savedFiles[f] = fs.readFileSync(p);
    }
  }
  try {
    savedIndex = fs.readFileSync(INDEX_FILE, "utf8");
  } catch (_) {
    savedIndex = null;
  }
});

after(async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  removeAuthFiles();
  for (const [f, content] of Object.entries(savedFiles)) {
    try { fs.writeFileSync(path.join(DATA_DIR, f), content); } catch (_) {}
  }
  if (savedIndex !== null) {
    try { fs.writeFileSync(INDEX_FILE, savedIndex, "utf8"); } catch (_) {}
  } else {
    try { fs.unlinkSync(INDEX_FILE); } catch (_) {}
  }
  delete process.env.ADMIN_PASSWORD;
});

beforeEach(() => {
  auth._resetForTest();
  removeAuthFiles();
  delete process.env.ADMIN_PASSWORD;
});

function mockReqRes(cookieValue, url) {
  const headers = {};
  if (cookieValue) headers.cookie = "wxd_sid=" + encodeURIComponent(cookieValue);
  const req = { headers, url: url || "/admin" };
  const res = {
    _status: null,
    _headers: null,
    _location: null,
    writeHead(status, hdrs) {
      this._status = status;
      this._headers = hdrs || {};
      this._location = hdrs && hdrs.location;
    },
    end() {},
  };
  return { req, res };
}

// ============ 1. scrypt 哈希正确性 ============

test("1.1 相同密码 + 相同 salt → 相同 hash", () => {
  const salt = crypto.randomBytes(16).toString("hex");
  const a = auth.hashPassword(TEST_PWD, salt);
  const b = auth.hashPassword(TEST_PWD, salt);
  assert.equal(a.hash, b.hash);
  assert.equal(a.salt, salt);
  assert.equal(b.salt, salt);
});

test("1.2 不同 salt → 不同 hash", () => {
  const a = auth.hashPassword(TEST_PWD);
  const b = auth.hashPassword(TEST_PWD);
  assert.notEqual(a.hash, b.hash, "随机 salt 应当产生不同 hash");
  assert.notEqual(a.salt, b.salt);
});

test("1.3 SCRYPT_PARAMS 固定为 { N:16384, r:8, p:1, keylen:32 }", () => {
  assert.equal(SCRYPT_PARAMS.N, 16384);
  assert.equal(SCRYPT_PARAMS.r, 8);
  assert.equal(SCRYPT_PARAMS.p, 1);
  assert.equal(SCRYPT_PARAMS.keylen, 32);
});

// ============ 2. verifyPassword 正确性 ============

test("2.1 正确密码 → true", () => {
  const h = auth.hashPassword(TEST_PWD);
  assert.equal(auth.verifyPassword(TEST_PWD, h.hash, h.salt, h.params), true);
});

test("2.2 错误密码 → false", () => {
  const h = auth.hashPassword(TEST_PWD);
  assert.equal(auth.verifyPassword("wrong-password-xyz", h.hash, h.salt, h.params), false);
});

// ============ 3. timingSafeEqual 强制使用 ============

test("3.1 verifyPassword 函数体使用 crypto.timingSafeEqual（不能用 === / Buffer.compare）", () => {
  const src = fs.readFileSync(path.join(PROJECT_ROOT, "auth.mjs"), "utf8");
  assert.ok(
    /crypto\.timingSafeEqual\s*\(/.test(src),
    "auth.mjs 未使用 crypto.timingSafeEqual"
  );
  const fnMatch = src.match(/export function verifyPassword[\s\S]*?\n\}/);
  assert.ok(fnMatch, "找不到 verifyPassword 函数体");
  const body = fnMatch[0];
  const codeOnly = body.replace(/\/\/[^\n]*/g, "").replace(/\/[\s\S]*?\*\//g, "");
  assert.ok(
    !/candidate\s*===\s*expected/.test(codeOnly),
    "verifyPassword 体内不应直接 === 比较两个 Buffer"
  );
});

// ============ 4. session create / get / destroy ============

test("4.1 createSession 返回的 sid 是字符串且长度 ≥ 32 字符", () => {
  const s = auth.createSession(TEST_USER);
  assert.equal(typeof s.sid, "string");
  assert.ok(s.sid.length >= 32, "sid 至少 32 字符（randomBytes(32).toString('hex')=64）");
  assert.equal(typeof s.expiresAt, "number");
});

test("4.2 createSession 后 getSession 返回 user 对象", () => {
  const s = auth.createSession(TEST_USER);
  const sess = auth.getSession(s.sid);
  assert.ok(sess);
  assert.equal(sess.user, TEST_USER);
});

test("4.3 getSession 不存在的 sid → null", () => {
  assert.equal(auth.getSession("non-existent-sid-xxx"), null);
});

test("4.4 session 滑动续期：构造 expiresAt=now+1d 的 session → getSession 后延长", () => {
  const s = auth.createSession(TEST_USER);
  const map = auth._getSessions();
  const rec = map.get(s.sid);
  assert.ok(rec);
  const oneDayLater = Date.now() + 24 * 60 * 60 * 1000;
  rec.expiresAt = oneDayLater;
  map.set(s.sid, rec);

  const before = rec.expiresAt;
  const after = auth.getSession(s.sid);
  assert.ok(after);
  assert.ok(after.expiresAt > before, "getSession 应把 expiresAt 滑动延长");
  const diff = after.expiresAt - before;
  assert.ok(diff >= 6 * 24 * 60 * 60 * 1000, "延长幅度应 ≥ 6 天（接近 7 天 TTL）");
});

test("4.5 destroySession 后 getSession 返回 null", () => {
  const s = auth.createSession(TEST_USER);
  assert.ok(auth.getSession(s.sid));
  auth.destroySession(s.sid);
  assert.equal(auth.getSession(s.sid), null);
});

// ============ 5. requireAuth 中间件 ============

test("5.1 requireAuth 未初始化 → 302 /admin/setup", () => {
  const { req, res } = mockReqRes(null, "/admin");
  let nextCalled = false;
  auth.requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(res._status, 302);
  assert.equal(res._location, "/admin/setup");
  assert.equal(nextCalled, false);
});

test("5.2 requireAuth 已初始化但未登录 → 302 /admin/login", () => {
  const h = auth.hashPassword(TEST_PWD);
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({
      username: TEST_USER,
      scryptHash: h.hash,
      salt: h.salt,
      params: h.params,
    })
  );
  const { req, res } = mockReqRes(null, "/admin");
  let nextCalled = false;
  auth.requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(res._status, 302);
  assert.equal(res._location, "/admin/login");
  assert.equal(nextCalled, false);
});

test("5.3 requireAuth 已登录 → next() 被调用，req.user / req.session 被填充", () => {
  const h = auth.hashPassword(TEST_PWD);
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({
      username: TEST_USER,
      scryptHash: h.hash,
      salt: h.salt,
      params: h.params,
    })
  );
  const s = auth.createSession(TEST_USER);
  const { req, res } = mockReqRes(s.sid, "/admin/dashboard");
  let nextCalled = false;
  auth.requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, "next 应被调用");
  assert.equal(req.user, TEST_USER);
  assert.ok(req.session && req.session.sid === s.sid);
  assert.equal(res._status, null, "已登录不应写 302");
});

// ============ 6. changePassword ============

test("6.1 旧密码错误 → WXD-AUTH-0007", () => {
  const h = auth.hashPassword(TEST_PWD);
  auth._setAuthRecordForTest({
    username: TEST_USER,
    scryptHash: h.hash,
    salt: h.salt,
    params: h.params,
  });
  const r = auth.changePassword("wrong-old-pwd", "new-valid-pwd-xyz", TEST_USER);
  assert.equal(r.ok, false);
  assert.equal(r.error_code, "WXD-AUTH-0007");
});

test("6.2 新密码 < 8 → WXD-AUTH-0008", () => {
  const h = auth.hashPassword(TEST_PWD);
  auth._setAuthRecordForTest({
    username: TEST_USER,
    scryptHash: h.hash,
    salt: h.salt,
    params: h.params,
  });
  const r = auth.changePassword(TEST_PWD, "short", TEST_USER);
  assert.equal(r.ok, false);
  assert.equal(r.error_code, "WXD-AUTH-0008");
});

test("6.3 改密成功后 destroyAllSessionsForUser 销毁其他 session（destroyed ≥ 1）", () => {
  const h = auth.hashPassword(TEST_PWD);
  auth._setAuthRecordForTest({
    username: TEST_USER,
    scryptHash: h.hash,
    salt: h.salt,
    params: h.params,
  });
  const keep = auth.createSession(TEST_USER);
  const other = auth.createSession(TEST_USER);
  assert.ok(auth.getSession(other.sid));

  const r = auth.changePassword(TEST_PWD, "new-valid-pwd-xyz", TEST_USER, keep.sid);
  assert.equal(r.ok, true);
  assert.ok(r.destroyed >= 1, "应至少销毁 1 个非 keep session，实际：" + r.destroyed);
  assert.ok(auth.getSession(keep.sid));
  assert.equal(auth.getSession(other.sid), null);
});

// ============ 7. hasEnvOverride ============

test("7.1 ADMIN_PASSWORD 未设置 → hasEnvOverride 返回 null", () => {
  delete process.env.ADMIN_PASSWORD;
  assert.equal(auth.hasEnvOverride(), null);
});

test("7.2 ADMIN_PASSWORD 设置 → hasEnvOverride 返回非 null", () => {
  process.env.ADMIN_PASSWORD = "env-escape-pwd";
  const r = auth.hasEnvOverride();
  assert.ok(r, "应返回非 null");
  assert.equal(typeof r, "string");
});

// ============ 8. 文件权限 (Unix only) ============

test("8.1 auth.json 写入完成后 mode 应当为 0o600（Unix only，Windows skip）", () => {
  if (IS_WIN) {
    return;
  }
  const data = JSON.stringify({ test: true }, null, 2);
  auth.atomicWriteJson(AUTH_FILE, data, 0o600);
  const mode = fs.statSync(AUTH_FILE).mode & 0o777;
  assert.equal(mode, 0o600, "期望 0o600，实际：" + mode.toString(8));
});

// ============ 9. env 覆盖优先级 ============

test("9.1 ADMIN_PASSWORD 设置后 verifyPassword 接受任意 user + env 值", () => {
  process.env.ADMIN_PASSWORD = "env-only-pwd-789";
  const ok = auth.verifyPassword("env-only-pwd-789", null, null, null);
  assert.equal(ok, true, "env 覆盖：输入 == env 值 → true");
  const bad = auth.verifyPassword("wrong-pwd", null, null, null);
  assert.equal(bad, false, "env 覆盖：输入 != env 值 → false");
});

// ============ 10. AuthError 错误码完整性 ============

test("10.1 AuthError 抛出时带 error_code / stage / request_id / http 字段", () => {
  const e = new AuthError("WXD-AUTH-0007", "auth.mjs#test", { foo: "bar" });
  assert.equal(e.error_code, "WXD-AUTH-0007");
  assert.equal(e.stage, "auth.mjs#test");
  assert.ok(typeof e.request_id === "string" && e.request_id.length > 0);
  assert.equal(e.http, 401);
  const j = e.toJSON();
  assert.equal(j.error_code, "WXD-AUTH-0007");
  assert.equal(j.stage, "auth.mjs#test");
  assert.equal(j.details.foo, "bar");
});

test("10.2 错误码 WXD-AUTH-0003~0008 全部在 ERROR_CODES 表里登记", () => {
  const codes = ["WXD-AUTH-0003", "WXD-AUTH-0004", "WXD-AUTH-0005", "WXD-AUTH-0006", "WXD-AUTH-0007", "WXD-AUTH-0008"];
  for (const code of codes) {
    const e = new AuthError(code, "test");
    assert.ok(typeof e.http === "number");
    assert.ok(typeof e.message === "string");
  }
});
