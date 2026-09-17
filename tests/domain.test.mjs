// tests/domain.test.mjs - domain.mjs 单元测试（node:test，Node 22 内置）
//   覆盖：env 优先 / X-Forwarded-Host 命中 / 裸 host 命中 / 写入缓存 / 兜底 127.0.0.1:3915 / 三优先级

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  computePublicBaseUrl,
  recordPublicBaseUrl,
  getCachedPublicBaseUrl,
  _clearCachedBaseUrl,
} from "../domain.mjs";

const SAVED_PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

/**
 * 构造一个最小化的 mock req 对象，只保留 domain.mjs 关心的字段。
 */
function makeReq({ host, xfHost, xfProto, encrypted = false } = {}) {
  const headers = {};
  if (host !== undefined) headers.host = host;
  if (xfHost !== undefined) headers["x-forwarded-host"] = xfHost;
  if (xfProto !== undefined) headers["x-forwarded-proto"] = xfProto;
  return {
    headers,
    socket: { encrypted: !!encrypted },
  };
}

// 每个用例前都重置 env + 缓存，避免前一个用例污染下一个
beforeEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  _clearCachedBaseUrl();
});

// 测试后还原进程级 env
after(() => {
  if (SAVED_PUBLIC_BASE_URL !== undefined) {
    process.env.PUBLIC_BASE_URL = SAVED_PUBLIC_BASE_URL;
  } else {
    delete process.env.PUBLIC_BASE_URL;
  }
});

// 引用 before 以触发其注册（占位）
before(() => {});

test("computePublicBaseUrl: env 优先（PUBLIC_BASE_URL 直接命中）", () => {
  process.env.PUBLIC_BASE_URL = "https://example.com/env/";
  const r = computePublicBaseUrl(
    makeReq({ host: "ignored.example.com", xfHost: "also.ignored", xfProto: "https" })
  );
  assert.equal(r, "https://example.com/env"); // 末尾斜杠被裁
});

test("computePublicBaseUrl: X-Forwarded-Host 命中（多值取首 + X-Forwarded-Proto）", () => {
  const r = computePublicBaseUrl(
    makeReq({
      host: "internal.local",
      xfHost: "real.example.com, proxy.example.com",
      xfProto: "https",
    })
  );
  assert.equal(r, "https://real.example.com");
});

test("computePublicBaseUrl: X-Forwarded-Host 命中但无 X-Forwarded-Proto 时回退 socket.encrypted", () => {
  const r = computePublicBaseUrl(
    makeReq({
      host: "internal.local",
      xfHost: "real.example.com",
      encrypted: true,
    })
  );
  assert.equal(r, "https://real.example.com");
});

test("computePublicBaseUrl: 裸 host 命中 (http)", () => {
  const r = computePublicBaseUrl(
    makeReq({ host: "plain.example.com", encrypted: false })
  );
  assert.equal(r, "http://plain.example.com");
});

test("computePublicBaseUrl: 裸 host 命中 (https via socket.encrypted)", () => {
  const r = computePublicBaseUrl(
    makeReq({ host: "tls.example.com", encrypted: true })
  );
  assert.equal(r, "https://tls.example.com");
});

test("recordPublicBaseUrl: 写入模块级缓存", () => {
  recordPublicBaseUrl(makeReq({ host: "first.example.com" }));
  assert.equal(getCachedPublicBaseUrl(), "http://first.example.com");
});

test("getCachedPublicBaseUrl: 兜底 127.0.0.1:3915（清空缓存 + 清空 env）", () => {
  // beforeEach 已清空缓存 + env，直接断言兜底
  const r = getCachedPublicBaseUrl();
  assert.equal(r, "http://127.0.0.1:3915");
});

test("三个优先级严格生效：env > 缓存 > 兜底", () => {
  // 1) 缓存空 + env 空 → 兜底 127.0.0.1:3915
  assert.equal(getCachedPublicBaseUrl(), "http://127.0.0.1:3915");

  // 2) 写入缓存后读 → 命中缓存
  recordPublicBaseUrl(makeReq({ host: "cached.example.com" }));
  assert.equal(getCachedPublicBaseUrl(), "http://cached.example.com");

  // 3) env 永远优先（即便已有缓存也忽略）
  process.env.PUBLIC_BASE_URL = "https://env.example.com";
  assert.equal(getCachedPublicBaseUrl(), "https://env.example.com");
});
