import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const WXD_DOMAIN_0001 = "WXD-DOMAIN-0001";
const WXD_DOMAIN_0002 = "WXD-DOMAIN-0002";

let _cachedBaseUrl = "";
let _cacheFile = null;
let _writeDebounce = null;

function getCacheFilePath() {
  if (!_cacheFile) { _cacheFile = path.join(process.cwd(), ".domain-cache.json"); }
  return _cacheFile;
}

function loadCacheFromFile() {
  if (_cachedBaseUrl) return _cachedBaseUrl;
  try {
    const s = fs.readFileSync(getCacheFilePath(), "utf8");
    const obj = JSON.parse(s);
    if (obj && typeof obj.baseUrl === "string" && obj.baseUrl) {
      _cachedBaseUrl = obj.baseUrl;
    }
  } catch (_) {}
  return _cachedBaseUrl;
}

function writeCacheToFile(baseUrl) {
  if (_writeDebounce) clearTimeout(_writeDebounce);
  _writeDebounce = setTimeout(() => {
    try {
      fs.writeFileSync(getCacheFilePath(), JSON.stringify({ baseUrl: baseUrl, savedAt: new Date().toISOString() }, null, 2));
    } catch (_) {}
    _writeDebounce = null;
  }, 100);
}

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
      throw makeDomainError(WXD_DOMAIN_0001, "X-Forwarded-Host 多值取首失败", "domain.computePublicBaseUrl");
    }
    const xfProto = headers["x-forwarded-proto"];
    const proto = xfProto || (isEncrypted ? "https" : "http");
    return `${proto}://${first}`;
  }
  const host = headers.host;
  if (!host) {
    throw makeDomainError(WXD_DOMAIN_0001, "请求缺少 host 头，无法解析公网域名", "domain.computePublicBaseUrl");
  }
  const proto = isEncrypted ? "https" : "http";
  return `${proto}://${host}`;
}

export function recordPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return;
  try {
    const url = computePublicBaseUrl(req);
    _cachedBaseUrl = url;
    writeCacheToFile(url);
  } catch (_) {}
}

export function getCachedPublicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  if (_cachedBaseUrl) return _cachedBaseUrl;
  const fromFile = loadCacheFromFile();
  if (fromFile) return fromFile;
  return "http://127.0.0.1:3915";
}

export function _clearCachedBaseUrl() {
  _cachedBaseUrl = "";
}

function makeDomainError(errorCode, message, stage) {
  const err = new Error(message);
  err.error_code = errorCode;
  err.message = message;
  err.stage = stage;
  err.request_id = crypto.randomUUID();
  err.details = {};
  return err;
}
