// auth.mjs - Administrator auth core module (single-user self-hosted)
//   scrypt hash + session CRUD + requireAuth middleware + isInitialized check + changePassword + env escape hatch
//   State files: data/auth.json (mode 0600, Unix strict) + data/sessions.json + data/auth-failures.json + data/admin.log
//   Security: scrypt N=2^14/r=8/p=1/keylen=32, salt=randomBytes(16), verify with timingSafeEqual, atomic rename
//   Error codes: WXD-AUTH-0003~0008 (WXD-AUTH-0001/0002 belong to 01 batch admin.mjs QR flow)

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.dirname(__filename);

const DATA_DIR = path.join(PROJECT_ROOT, "data");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const FAILURES_FILE = path.join(DATA_DIR, "auth-failures.json");
const ADMIN_LOG_FILE = path.join(DATA_DIR, "admin.log");

const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32 });
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ERROR_CODES = {
  "WXD-AUTH-0003": { http: 401, message: "Invalid username or password" },
  "WXD-AUTH-0004": { http: 401, message: "Session expired or missing" },
  "WXD-AUTH-0005": { http: 302, message: "Uninitialized access to protected route" },
  "WXD-AUTH-0006": { http: 500, message: "auth.json corrupted or parse failed" },
  "WXD-AUTH-0007": { http: 401, message: "Old password incorrect" },
  "WXD-AUTH-0008": { http: 400, message: "Password too short (< 8 chars)" },
};

class AuthError extends Error {
  constructor(code, stage, extra) {
    const def = ERROR_CODES[code] || { http: 500, message: code };
    super(def.message);
    this.error_code = code;
    this.message = def.message;
    this.stage = stage;
    this.request_id = crypto.randomUUID();
    this.http = def.http;
    this.details = extra || {};
  }
  toJSON() {
    return {
      error_code: this.error_code,
      message: this.message,
      stage: this.stage,
      request_id: this.request_id,
      details: this.details,
    };
  }
}

function isWindows() {
  return process.platform === "win32";
}

function mkdirSafe(dir, mode) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: mode });
  } catch (e) {
    if (e && e.code !== "EEXIST") throw e;
  }
  if (!isWindows()) {
    try { fs.chmodSync(dir, mode); } catch (_) {}
  }
}

function writeAtomicSync(targetPath, data, mode) {
  mkdirSafe(path.dirname(targetPath), 0o700);
  const tmp = targetPath + ".tmp-" + crypto.randomBytes(4).toString("hex");
  const writeOpts = { encoding: "utf8" };
  if (typeof mode === "number") writeOpts.mode = mode;
  fs.writeFileSync(tmp, data, writeOpts);
  if (typeof mode === "number" && !isWindows()) {
    try { fs.chmodSync(tmp, mode); } catch (_) {}
  }
  try {
    fs.renameSync(tmp, targetPath);
  } catch (e) {
    try {
      fs.copyFileSync(tmp, targetPath);
      try { fs.unlinkSync(tmp); } catch (_) {}
    } catch (e2) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      throw e2;
    }
  }
  if (typeof mode === "number" && !isWindows()) {
    try { fs.chmodSync(targetPath, mode); } catch (_) {}
  }
}

// atomicWriteJson: sync atomic write, reusable across modules (storage.mjs, etc.)
export function atomicWriteJson(targetPath, data, mode) {
  return writeAtomicSync(targetPath, data, mode);
}

// atomicWriteJsonAsync: async atomic write for storage.mjs (non-blocking IO)
export async function atomicWriteJsonAsync(targetPath, data, mode) {
  const dir = path.dirname(targetPath);
  try { await fsp.mkdir(dir, { recursive: true }); } catch (e) {
    if (!(e && e.code === "EEXIST")) throw e;
  }
  const tmp = targetPath + ".tmp-" + crypto.randomBytes(4).toString("hex");
  const writeOpts = {};
  if (typeof mode === "number") writeOpts.mode = mode;
  await fsp.writeFile(tmp, data, writeOpts);
  if (typeof mode === "number" && !isWindows()) {
    try { await fsp.chmod(tmp, mode); } catch (_) {}
  }
  try {
    await fsp.rename(tmp, targetPath);
  } catch (e) {
    try {
      await fsp.copyFile(tmp, targetPath);
      try { await fsp.unlink(tmp); } catch (_) {}
    } catch (e2) {
      try { await fsp.unlink(tmp); } catch (_) {}
      throw e2;
    }
  }
  if (typeof mode === "number" && !isWindows()) {
    try { await fsp.chmod(targetPath, mode); } catch (_) {}
  }
}

function beijingIsoString(d) {
  const ms = d.getTime() + 8 * 3600 * 1000;
  const b = new Date(ms);
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return b.getUTCFullYear() + "-" + pad(b.getUTCMonth() + 1) + "-" + pad(b.getUTCDate()) +
    "T" + pad(b.getUTCHours()) + ":" + pad(b.getUTCMinutes()) + ":" + pad(b.getUTCSeconds()) + "+08:00";
}

let _authRecord = null;
let _sessions = new Map();
let _initialized = false;

export function _getPaths() {
  return {
    dataDir: DATA_DIR,
    authFile: AUTH_FILE,
    sessionsFile: SESSIONS_FILE,
    failuresFile: FAILURES_FILE,
    adminLogFile: ADMIN_LOG_FILE,
  };
}

export function isInitialized() {
  let stat;
  try {
    stat = fs.statSync(AUTH_FILE);
  } catch (e) {
    if (e && e.code === "ENOENT") return false;
    throw new AuthError("WXD-AUTH-0006", "auth.mjs#isInitialized", { reason: e && e.message });
  }
  if (!stat.isFile()) return false;
  let parsed;
  try {
    const raw = fs.readFileSync(AUTH_FILE, "utf8");
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new AuthError("WXD-AUTH-0006", "auth.mjs#isInitialized", { reason: e && e.message });
  }
  if (!parsed || typeof parsed !== "object" || !parsed.scryptHash || !parsed.salt) {
    throw new AuthError("WXD-AUTH-0006", "auth.mjs#isInitialized", { reason: "auth.json missing required fields" });
  }
  return true;
}

export function hashPassword(password, salt) {
  if (typeof password !== "string" || !password) {
    throw new AuthError("WXD-AUTH-0008", "auth.mjs#hashPassword", { reason: "password empty" });
  }
  const useSalt = salt && typeof salt === "string"
    ? salt
    : crypto.randomBytes(16).toString("hex");
  const buf = crypto.scryptSync(password, useSalt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return {
    hash: buf.toString("base64"),
    salt: useSalt,
    params: { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, keylen: SCRYPT_PARAMS.keylen },
  };
}

export function verifyPassword(password, hash, salt, params) {
  if (typeof password !== "string" || !password) return false;
  const envPwd = process.env.ADMIN_PASSWORD;
  if (typeof envPwd === "string" && envPwd.length > 0) {
    return timingSafeEqualStr(password, envPwd);
  }
  // overload:
  //   - 1-arg form verifyPassword(pwd): auto-fill hash/salt/params from _authRecord
  //   - 2-arg form verifyPassword(username, pwd): if 1st arg matches _authRecord.username,
  //     treat 2nd arg as password (matches server.mjs /admin/login call shape)
  if (hash === undefined || salt === undefined) {
    if (!_authRecord) return false;
    if (typeof hash === "string" && password === _authRecord.username) {
      password = hash;
    }
    hash = _authRecord.scryptHash;
    salt = _authRecord.salt;
    params = _authRecord.params;
    if (typeof password !== "string" || !password) return false;
  }
  if (typeof hash !== "string" || !hash) return false;
  if (typeof salt !== "string" || !salt) return false;
  try {
    const useParams = params && typeof params === "object" ? params : SCRYPT_PARAMS;
    const candidate = crypto.scryptSync(password, salt, useParams.keylen || SCRYPT_PARAMS.keylen, {
      N: useParams.N || SCRYPT_PARAMS.N,
      r: useParams.r || SCRYPT_PARAMS.r,
      p: useParams.p || SCRYPT_PARAMS.p,
    });
    const expected = Buffer.from(hash, "base64");
    if (expected.length !== candidate.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  } catch (_) {
    return false;
  }
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function createSession(user) {
  if (typeof user !== "string" || !user) {
    throw new AuthError("WXD-AUTH-0004", "auth.mjs#createSession", { reason: "user empty" });
  }
  const sid = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  _sessions.set(sid, { user: user, createdAt: now, expiresAt: expiresAt });
  persistSessionsSync();
  return { sid: sid, expiresAt: expiresAt };
}

export function getSession(sid) {
  if (typeof sid !== "string" || !sid) return null;
  const rec = _sessions.get(sid);
  if (!rec) return null;
  const now = Date.now();
  if (now >= rec.expiresAt) {
    _sessions.delete(sid);
    persistSessionsAsync();
    return null;
  }
  rec.expiresAt = now + SESSION_TTL_MS;
  _sessions.set(sid, rec);
  persistSessionsAsync();
  return { user: rec.user, createdAt: rec.createdAt, expiresAt: rec.expiresAt };
}

export function destroySession(sid) {
  if (typeof sid !== "string" || !sid) return;
  if (_sessions.has(sid)) {
    _sessions.delete(sid);
    persistSessionsSync();
  }
}

export function destroyAllSessionsForUser(user) {
  if (typeof user !== "string" || !user) return 0;
  let count = 0;
  for (const [sid, rec] of _sessions.entries()) {
    if (rec && rec.user === user) {
      _sessions.delete(sid);
      count++;
    }
  }
  if (count > 0) persistSessionsSync();
  return count;
}

function persistSessionsSync() {
  try {
    mkdirSafe(DATA_DIR, 0o700);
    const obj = {};
    for (const [sid, rec] of _sessions.entries()) obj[sid] = rec;
    writeAtomicSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 0o600);
  } catch (e) {
    try {
      appendAuditInternal({ ip: "127.0.0.1", action: "persist_sessions_failed", ok: false, error_code: "WXD-AUTH-0004", details: { message: e && e.message } });
    } catch (_) {}
  }
}

function persistSessionsAsync() {
  setImmediate(function () { persistSessionsSync(); });
}

export function hasEnvOverride() {
  const env = process.env.ADMIN_PASSWORD;
  if (typeof env === "string" && env.length > 0) return "env:****";
  return null;
}

export function requireAuth(req, res, next) {
  let init = false;
  try {
    init = isInitialized();
  } catch (e) {
    if (e instanceof AuthError) {
      sendAuthError(res, e);
    } else if (typeof next === "function") {
      next(e);
    }
    return;
  }
  if (!init) {
    redirectOrError(res, next, "/admin/setup", new AuthError("WXD-AUTH-0005", "auth.mjs#requireAuth"));
    return;
  }
  const sid = parseCookies(req).wxd_sid;
  const sess = getSession(sid);
  if (!sess) {
    redirectOrError(res, next, "/admin/login", new AuthError("WXD-AUTH-0004", "auth.mjs#requireAuth"));
    return;
  }
  if (req) {
    req.user = sess.user;
    req.session = { sid: sid, user: sess.user, createdAt: sess.createdAt, expiresAt: sess.expiresAt };
  }
  if (typeof next === "function") next();
}

function redirectOrError(res, next, location, fallbackErr) {
  if (res && typeof res.writeHead === "function") {
    try {
      res.writeHead(302, { location: location });
      res.end();
      return;
    } catch (_) {}
  }
  if (typeof next === "function") next(fallbackErr);
}

function sendAuthError(res, err) {
  if (res && typeof res.writeHead === "function") {
    try {
      res.writeHead(err.http || 500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(err.toJSON()));
      return;
    } catch (_) {}
  }
}

function parseCookies(req) {
  const out = {};
  const h = req && req.headers ? req.headers.cookie : null;
  if (!h || typeof h !== "string") return out;
  const parts = h.split(";");
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    const k = p.slice(0, i).trim();
    if (!k) continue;
    const v = p.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch (_) {
      out[k] = v;
    }
  }
  return out;
}

export function changePassword(oldPwd, newPwd, actorUser, keepSid) {
  if (!_authRecord) {
    return { ok: false, error_code: "WXD-AUTH-0006", message: "auth not initialized" };
  }
  if (typeof oldPwd !== "string" || !oldPwd) {
    return { ok: false, error_code: "WXD-AUTH-0007" };
  }
  if (typeof newPwd !== "string" || newPwd.length < 8) {
    return { ok: false, error_code: "WXD-AUTH-0008" };
  }
  const oldOk = verifyPassword(oldPwd, _authRecord.scryptHash, _authRecord.salt, _authRecord.params);
  if (!oldOk) {
    return { ok: false, error_code: "WXD-AUTH-0007" };
  }
  const next = hashPassword(newPwd);
  const nowIso = beijingIsoString(new Date());
  _authRecord.scryptHash = next.hash;
  _authRecord.salt = next.salt;
  _authRecord.params = next.params;
  _authRecord.updatedAt = nowIso;
  if (!_authRecord.createdAt) _authRecord.createdAt = nowIso;
  try {
    writeAtomicSync(AUTH_FILE, JSON.stringify(_authRecord, null, 2), 0o600);
  } catch (e) {
    return { ok: false, error_code: "WXD-AUTH-0006", message: "write failed: " + (e && e.message) };
  }
  const user = actorUser || _authRecord.username;
  let count = 0;
  for (const [sid, rec] of _sessions.entries()) {
    if (rec && rec.user === user && sid !== keepSid) {
      _sessions.delete(sid);
      count++;
    }
  }
  if (count > 0) persistSessionsSync();
  return { ok: true, destroyed: count };
}

// initAuth: load data/auth.json + data/sessions.json into memory on startup.
// Behavior:
//   * auth.json exists but corrupted (JSON.parse fails / missing fields) -> audit + throw WXD-AUTH-0006
//     (server.mjs startup hook catches and process.exit(1), see section 6.C)
//   * auth.json missing -> empty in-memory state (first start / no password yet)
//   * sessions.json corrupted -> audit only, no throw (sessions rebuildable)
export async function initAuth() {
  mkdirSafe(DATA_DIR, 0o700);
  if (fs.existsSync(AUTH_FILE)) {
    let parsed;
    try {
      const raw = fs.readFileSync(AUTH_FILE, "utf8");
      parsed = JSON.parse(raw);
    } catch (e) {
      appendAuditInternal({ ip: "127.0.0.1", action: "init_load_auth_failed", ok: false, error_code: "WXD-AUTH-0006", details: { message: e && e.message } });
      throw new AuthError("WXD-AUTH-0006", "auth.mjs#initAuth", { reason: e && e.message });
    }
    if (!parsed || typeof parsed !== "object" || !parsed.scryptHash || !parsed.salt) {
      appendAuditInternal({ ip: "127.0.0.1", action: "init_load_auth_failed", ok: false, error_code: "WXD-AUTH-0006", details: { reason: "auth.json missing required fields" } });
      throw new AuthError("WXD-AUTH-0006", "auth.mjs#initAuth", { reason: "auth.json missing required fields" });
    }
    _authRecord = parsed;
  }
  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      const raw = fs.readFileSync(SESSIONS_FILE, "utf8");
      const parsed = JSON.parse(raw);
      const now = Date.now();
      if (parsed && typeof parsed === "object") {
        for (const sid of Object.keys(parsed)) {
          const r = parsed[sid];
          if (r && typeof r === "object" && r.user && r.expiresAt && now < r.expiresAt) {
            _sessions.set(sid, { user: r.user, createdAt: r.createdAt || now, expiresAt: r.expiresAt });
          }
        }
      }
    } catch (e) {
      appendAuditInternal({ ip: "127.0.0.1", action: "init_load_sessions_failed", ok: false, error_code: "WXD-AUTH-0004", details: { message: e && e.message } });
    }
  }
  _initialized = true;
}

export function appendAudit(event) {
  appendAuditInternal(event);
}

function appendAuditInternal(event) {
  const evt = event || {};
  const now = new Date();
  const stamp = beijingIsoString(now);
  try {
    mkdirSafe(DATA_DIR, 0o700);
    fs.appendFileSync(ADMIN_LOG_FILE, JSON.stringify(Object.assign({ time: stamp }, evt)) + "\n", { encoding: "utf8", mode: 0o600 });
    if (!isWindows()) {
      try { fs.chmodSync(ADMIN_LOG_FILE, 0o600); } catch (_) {}
    }
  } catch (_) {}
  if (evt.ok === false) {
    try {
      let arr = [];
      if (fs.existsSync(FAILURES_FILE)) {
        try {
          const raw = fs.readFileSync(FAILURES_FILE, "utf8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) arr = parsed;
        } catch (_) {}
      }
      arr.push(Object.assign({ time: stamp }, evt));
      if (arr.length > 1000) arr = arr.slice(arr.length - 1000);
      writeAtomicSync(FAILURES_FILE, JSON.stringify(arr, null, 2), 0o600);
    } catch (_) {}
  }
}

export function _getAuthRecord() { return _authRecord; }
export function _setAuthRecordForTest(rec) { _authRecord = rec; }
export function _getSessions() { return _sessions; }
export function _isInitDone() { return _initialized; }
export function _resetForTest() {
  _authRecord = null;
  _sessions = new Map();
  _initialized = false;
}

export { AuthError, SCRYPT_PARAMS };

// reloadAfterSetup: re-read data/auth.json into _authRecord after server.mjs#/admin/setup POST
//   writes the file. Used so the next isInitialized()/verifyPassword() call sees the new admin.
//   Idempotent: safe to call multiple times. Returns ok=true if _authRecord was populated.
export function reloadAfterSetup() {
  _authRecord = null;
  if (!fs.existsSync(AUTH_FILE)) {
    return { ok: false, error_code: "WXD-AUTH-0005", message: "auth.json not found" };
  }
  let parsed;
  try {
    const raw = fs.readFileSync(AUTH_FILE, "utf8");
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error_code: "WXD-AUTH-0006", message: e && e.message };
  }
  if (!parsed || typeof parsed !== "object" || !parsed.scryptHash || !parsed.salt) {
    return { ok: false, error_code: "WXD-AUTH-0006", message: "auth.json missing required fields" };
  }
  _authRecord = parsed;
  _initialized = true;
  return { ok: true, username: parsed.username };
}
