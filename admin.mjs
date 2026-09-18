// admin.mjs - 管理面板 / 二维码前端化
// 把 weixin-agent-sdk 的 login() 从终端搬到网页 /admin/qr
// see context7-record.md - 2026-09-17 - weixin-agent-sdk - login API

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { login, isLoggedIn } from "weixin-agent-sdk";

// re-export: dashboard 绑定状态卡片需要 (server.mjs renderAdminDashboard)
export { isLoggedIn };
import { randomUUID } from "node:crypto";

const STAGE = {
  startQrSession: "admin.mjs#startQrSession",
  pollQrStatus: "admin.mjs#pollQrStatus",
  getQrStatus: "admin.mjs#getQrStatus",
};

// 错误码：与 .super-agent/.../plan/dev-spec.md 的登记保持一致
const ERROR_CODES = {
  "WXD-AUTH-0001": { http: 401, message: "startWeixinLoginWithQr 返回非 QR 数据" },
  "WXD-AUTH-0002": { http: 401, message: "waitForWeixinLogin timeout（>300s）" },
  "WXD-ADMIN-0001": { http: 404, message: "/admin/qr/status 的 session 不存在 / 过期" },
  "WXD-BOT-0001": { http: 503, message: "服务未以 WECHAT_BOT=1 启动，无法扫码绑定" },
};

class AdminError extends Error {
  constructor(code, stage, requestId, extra) {
    const def = ERROR_CODES[code];
    super((def && def.message) || code);
    this.error_code = code;
    this.message = (def && def.message) || code;
    this.stage = stage;
    this.request_id = requestId;
    this.http = (def && def.http) || 500;
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

// 内存会话状态；sessionKey 为对外标识（crypto.randomUUID）
// SDK 内部另有 activeLogins Map 维护自己的轮询，本模块不直接复用
const sessions = new Map();

// 抓 QR 的等待上限；超过即判定 SDK 拿不到 QR（→ WXD-AUTH-0001）
const QR_RACE_TIMEOUT_MS = 5000;

// 单 session 的有效等待时长；超过视为超时（→ WXD-AUTH-0002）
// SDK 内部默认 480_000ms，这里给前端 5 分钟可感知阈值
const POLL_TIMEOUT_MS = 300000;

// weixin-agent-sdk 内部 logger 把 "二维码链接: <url>" 写到本地日志文件
// 见 node_modules/weixin-agent-sdk/dist/index.mjs writeLog → MAIN_LOG_DIR = os.tmpdir()/openclaw
// 这里直接 tail 该文件，作为 user log 回调的兜底通道
function sdkLogPath() {
  var d = new Date();
  var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  var key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  return path.join(os.tmpdir(), "openclaw", "openclaw-" + key + ".log");
}

// 从 SDK 日志里抓最近的 QR 链接；起始 offset 由调用方决定（避免抓到上一次的）
function readLatestQrFromSdkLog(startBytes) {
  var p = sdkLogPath();
  var stat;
  try { stat = fs.statSync(p); } catch (_) { return null; }
  if (!stat || !stat.size || stat.size <= (startBytes || 0)) return null;
  var fd = fs.openSync(p, "r");
  try {
    var len = stat.size - (startBytes || 0);
    var buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, startBytes || 0);
    var text = buf.toString("utf8");
    // 日志行形如：{"0":"gateway/channels/openclaw-weixin","1":"二维码链接: https://..."}
    // 倒序找最近的「二维码链接」后跟非空白非引号字符
    var re = /二维码链接["\s,:]+([^\s"',}]+)/;
    var lines = text.split("\n");
    for (var i = lines.length - 1; i >= 0; i--) {
      var m = re.exec(lines[i]);
      if (m) return m[1];
    }
    return null;
  } catch (_) {
    return null;
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
  }
}

// 从 user log 回调抓 QR（仅在 qrcode-terminal 加载失败时 SDK 才会走这条路径）
function parseQrFromLogMessage(msg) {
  if (typeof msg !== "string") return null;
  var re = /二维码链接[:\s]+([^\s"',}]+)/;
  var m = re.exec(msg);
  return m ? m[1] : null;
}

export function isBotEnabled() {
  return process.env.WECHAT_BOT === "1" || process.env.WECHAT_BOT === "true";
}

export async function startQrSession() {
  if (!isBotEnabled()) {
    const rid = randomUUID();
    throw new AdminError("WXD-BOT-0001", STAGE.startQrSession, rid, { hint: "请用 WECHAT_BOT=1 npm start 启动服务" });
  }
  const requestId = randomUUID();
  const sessionKey = randomUUID();

  // 用 log 回调 + SDK 日志文件双通道抓 QR
  let capturedQrcodeUrl = null;
  const log = function (msg) {
    if (capturedQrcodeUrl) return;
    var fromMsg = parseQrFromLogMessage(String(msg));
    if (fromMsg) capturedQrcodeUrl = fromMsg;
  };

  // 记录 log 文件起始 offset；之后只看增量
  var startBytes = 0;
  try { startBytes = fs.statSync(sdkLogPath()).size; } catch (_) {}

  // 不 await：login() 在后台长轮询直到 confirmed/timeout/expired
  var loginPromise = login({ log: log }).catch(function (err) {
    var m = (err && err.message) || String(err);
    process.stderr.write(
      "[admin] login() rejected request_id=" + requestId +
      " session=" + sessionKey + " err=" + m + "\n"
    );
  });

  // 抓 QR：最多等 5s
  var t0 = Date.now();
  while (Date.now() - t0 < QR_RACE_TIMEOUT_MS && !capturedQrcodeUrl) {
    if (!capturedQrcodeUrl) {
      var fromFile = readLatestQrFromSdkLog(startBytes);
      if (fromFile) capturedQrcodeUrl = fromFile;
    }
    await new Promise(function (r) { setTimeout(r, 80); });
  }
  if (!capturedQrcodeUrl) {
    throw new AdminError("WXD-AUTH-0001", STAGE.startQrSession, requestId);
  }

  var session = {
    qrcodeUrl: capturedQrcodeUrl,
    status: "wait",
    startedAt: Date.now(),
    loginPromise: loginPromise,
  };
  sessions.set(sessionKey, session);

  // 监听后台 login() 完成：成功 → confirmed；失败 → expired
  loginPromise.then(function () {
    if (sessions.get(sessionKey) === session) session.status = "confirmed";
  }, function () {
    if (sessions.get(sessionKey) === session) session.status = "expired";
  });

  return {
    qrcodeUrl: capturedQrcodeUrl,
    sessionKey: sessionKey,
    requestId: requestId,
  };
}

export async function pollQrStatus(sessionKey) {
  var requestId = randomUUID();
  var session = sessions.get(sessionKey);
  if (!session) {
    throw new AdminError("WXD-ADMIN-0001", STAGE.pollQrStatus, requestId);
  }
  var elapsedMs = Date.now() - session.startedAt;
  if (elapsedMs > POLL_TIMEOUT_MS && session.status === "wait") {
    session.status = "expired";
    throw new AdminError("WXD-AUTH-0002", STAGE.pollQrStatus, requestId, { elapsedMs: elapsedMs });
  }
  // SDK 成功后会把账号落本地存储，isLoggedIn() 转 true → 标记当前 session confirmed
  if (session.status === "wait" && isLoggedIn()) {
    session.status = "confirmed";
  }
  return session.status;
}

export async function getQrStatus(sessionKey) {
  var status = await pollQrStatus(sessionKey);
  return { status: status };
}

// 仅供测试或运维导出，谨慎使用
export var _internal = { sessions: sessions, ERROR_CODES: ERROR_CODES };