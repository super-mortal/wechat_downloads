// domain.mjs - 域名解析与跨上下文缓存
//   * computePublicBaseUrl: 单请求精确解析（§7.1）
//   * recordPublicBaseUrl : 顶层中间件喂缓存（§7.2）
//   * getCachedPublicBaseUrl: agent 在脱离 HTTP 上下文时读取（§7.2）

import crypto from "node:crypto";

// 错误码常量（与 dev-spec.md 错误码登记保持一致）
const WXD_DOMAIN_0001 = "WXD-DOMAIN-0001"; // host / X-Forwarded-Host 解析失败
const WXD_DOMAIN_0002 = "WXD-DOMAIN-0002"; // 缓存读不到且无 env（理论上不会触发，兜底已处理）

// 模块级缓存（agent 在脱离 HTTP 上下文时使用）
let _cachedBaseUrl = "";

/**
 * 解析当前请求对应的公网域名（绝对 URL，无尾斜杠）。
 * 优先级：PUBLIC_BASE_URL env > X-Forwarded-Host (+ X-Forwarded-Proto) > host (socket.encrypted)
 * @param {import("node:http").IncomingMessage} req
 * @returns {string}
 */
export function computePublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }

  const headers = req && req.headers ? req.headers : {};
  const socket = req && req.socket ? req.socket : {};
  const isEncrypted = !!socket.encrypted;

  const xfHost = headers["x-forwarded-host"];
  if (xfHost) {
    const first = String(xfHost).split(",")[0].trim();
    if (!first) {
      throw makeDomainError(
        WXD_DOMAIN_0001,
        "X-Forwarded-Host 多值取首失败",
        "domain.computePublicBaseUrl"
      );
    }
    const xfProto = headers["x-forwarded-proto"];
    const proto = xfProto || (isEncrypted ? "https" : "http");
    return `${proto}://${first}`;
  }

  const host = headers.host;
  if (!host) {
    throw makeDomainError(
      WXD_DOMAIN_0001,
      "请求缺少 host 头，无法解析公网域名",
      "domain.computePublicBaseUrl"
    );
  }
  const proto = isEncrypted ? "https" : "http";
  return `${proto}://${host}`;
}

/**
 * 把每次 HTTP 请求的域名缓存到模块级变量，供 agent 跨上下文读取。
 * env 始终优先：env 已设置时不写缓存，让 getCachedPublicBaseUrl 直接走 env。
 * 解析失败时静默吞掉，不影响请求主链路。
 * @param {import("node:http").IncomingMessage} req
 */
export function recordPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return;
  try {
    _cachedBaseUrl = computePublicBaseUrl(req);
  } catch (_) {
    // 缓存写入失败：忽略
  }
}

/**
 * 跨上下文读取公网域名。
 * 优先级：env > 缓存 > 127.0.0.1:3915 兜底
 * @returns {string}
 */
export function getCachedPublicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  if (_cachedBaseUrl) return _cachedBaseUrl;
  return "http://127.0.0.1:3915";
}

/**
 * @internal — 仅供单测使用：清空模块级缓存。
 * 不属于公开 API，仅在 tests/domain.test.mjs 中调用。
 */
export function _clearCachedBaseUrl() {
  _cachedBaseUrl = "";
}

/**
 * 构造符合 dev-spec.md 错误响应结构的错误对象。
 * @param {string} errorCode
 * @param {string} message
 * @param {string} stage
 * @returns {Error}
 */
function makeDomainError(errorCode, message, stage) {
  const err = new Error(message);
  err.error_code = errorCode;
  err.message = message;
  err.stage = stage;
  err.request_id = crypto.randomUUID();
  err.details = {};
  return err;
}
