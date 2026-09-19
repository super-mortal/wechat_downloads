// tls-cert.mjs - TLS 证书管理（自签名 + 自动生成 + 缓存到 data/tls/）
//   * 默认：第一次启动时自动生成 ECDSA P-256 自签名证书（10 年有效）到 data/tls/
//   * 覆盖：环境变量 TLS_CERT / TLS_KEY 指向外部 PEM 文件（生产环境使用真证书）
//   * HTTP_MODE=1 时此模块不参与（server.mjs 会跳过 TLS 直接走 http.createServer）
//
// 错误码：WXD-SYS-0004（证书读取失败）/ WXD-SYS-0005（自签名生成失败）

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import selfsigned from "selfsigned";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = dirname(__filename);

const TLS_DIR = join(PROJECT_ROOT, "data", "tls");
const CERT_PATH = join(TLS_DIR, "cert.pem");
const KEY_PATH = join(TLS_DIR, "key.pem");

const WXD_SYS_0004 = "WXD-SYS-0004";
const WXD_SYS_0005 = "WXD-SYS-0005";

function logInfo(msg) {
  try { console.log("[tls-cert] " + msg); } catch (_) {}
}

// 把主机名/IP 列表转成 selfsigned 扩展需要的 altNames 数组
// selfsigned 期望 node-forge 兼容格式：{ type: 2, value: 'host' } 或 { type: 7, ip: '1.2.3.4' }
function toAltNames(hosts) {
  return hosts.map(function (h) {
    if (/^[\d.]+$/.test(h)) return { type: 7, ip: h };
    return { type: 2, value: h };
  });
}

// 读取磁盘上的证书 / 私钥
function readPemFiles(certPath, keyPath) {
  try {
    if (!existsSync(certPath)) throw new Error("cert file not found: " + certPath);
    if (!existsSync(keyPath)) throw new Error("key file not found: " + keyPath);
    const cert = readFileSync(certPath);
    const key = readFileSync(keyPath);
    if (!cert || cert.length < 100) throw new Error("cert file too small / empty: " + certPath);
    if (!key || key.length < 100) throw new Error("key file too small / empty: " + keyPath);
    return { cert, key, source: "external", certPath, keyPath };
  } catch (e) {
    const err = new Error("read TLS cert/key failed: " + (e && e.message));
    err.error_code = WXD_SYS_0004;
    err.stage = "tls-cert.mjs#readPemFiles";
    throw err;
  }
}

// 生成自签名证书（RSA 2048，10 年有效，SAN 覆盖 localhost + 127.0.0.1）
async function generateSelfSigned(hosts) {
  try {
    const san = (hosts && hosts.length) ? hosts : ["localhost", "127.0.0.1"];
    const altNames = toAltNames(san);
    // attrs = Subject DN（注意：subjectAltName 不进 attrs，只在 extensions 里出现）
    const attrs = [{ name: "commonName", value: san[0] }];
    const pems = await selfsigned.generate(attrs, {
      algorithm: "sha256",
      days: 3650,
      keySize: 2048,
      extensions: [
        { name: "basicConstraints", cA: true, critical: true },
        { name: "keyUsage", digitalSignature: true, keyCertSign: true, critical: true },
        { name: "subjectAltName", altNames: altNames }
      ]
    });
    return { cert: pems.cert || pems.public, key: pems.private };
  } catch (e) {
    const err = new Error("self-signed cert generation failed: " + (e && e.message));
    err.error_code = WXD_SYS_0005;
    err.stage = "tls-cert.mjs#generateSelfSigned";
    throw err;
  }
}

// 写到 data/tls/，0o600 权限
function writePemFiles(cert, key) {
  try {
    mkdirSync(TLS_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CERT_PATH, cert, { mode: 0o600 });
    writeFileSync(KEY_PATH, key, { mode: 0o600 });
  } catch (e) {
    const err = new Error("write TLS cert/key failed: " + (e && e.message));
    err.error_code = WXD_SYS_0004;
    err.stage = "tls-cert.mjs#writePemFiles";
    throw err;
  }
}

// 检查证书是否即将过期（30 天内）；过期或不存在则重新生成
function certExpiringSoon(certPath) {
  try {
    const raw = readFileSync(certPath, "utf8");
    const m = raw.match(/Not After\s*:\s*(.+)/);
    if (!m) return false; // 解析不到就不重生成（避免误删）
    const expiry = Date.parse(m[1]);
    if (isNaN(expiry)) return false;
    const thirtyDays = 30 * 24 * 3600 * 1000;
    return (expiry - Date.now()) < thirtyDays;
  } catch (_) {
    return true;
  }
}

/**
 * 拿一对 cert / key：
 *   1) 环境变量 TLS_CERT / TLS_KEY 指向外部 PEM 文件 → 直接用（生产场景）
 *   2) data/tls/cert.pem + data/tls/key.pem 存在且未过期 → 用之
 *   3) 都不满足 → 自动生成自签名证书，写到 data/tls/
 *
 * @param {{ hosts?: string[] }} [opts]
 * @returns {Promise<{ cert: Buffer, key: Buffer, source: string, certPath?: string, keyPath?: string }>}
 */
export async function getTlsCert(opts) {
  opts = opts || {};
  const hosts = Array.isArray(opts.hosts) ? opts.hosts : null;

  // 1) 外部 PEM 覆盖（生产场景，用户提供真实证书）
  const envCert = process.env.TLS_CERT;
  const envKey = process.env.TLS_KEY;
  if (envCert && envKey) {
    logInfo("using external TLS cert from TLS_CERT/TLS_KEY env");
    return readPemFiles(resolve(envCert), resolve(envKey));
  }

  // 2) 缓存有效
  if (existsSync(CERT_PATH) && existsSync(KEY_PATH) && !certExpiringSoon(CERT_PATH)) {
    logInfo("using cached self-signed cert: " + CERT_PATH);
    return Object.assign(readPemFiles(CERT_PATH, KEY_PATH), { source: "cached" });
  }

  // 3) 生成新的
  logInfo("generating self-signed cert (this only happens on first start or 30 days before expiry)");
  const generated = await generateSelfSigned(hosts);
  writePemFiles(generated.cert, generated.key);
  logInfo("self-signed cert written to " + CERT_PATH);
  return { cert: Buffer.from(generated.cert), key: Buffer.from(generated.key), source: "self-signed", certPath: CERT_PATH, keyPath: KEY_PATH };
}

export function isHttpMode() {
  return process.env.HTTP_MODE === "1" || process.env.HTTP_MODE === "true";
}

export function getTlsCertPath() {
  return { certPath: CERT_PATH, keyPath: KEY_PATH, dir: TLS_DIR };
}
