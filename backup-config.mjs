// backup-config.mjs - 自动备份配置 + 调度
//   配置文件：data/backup-config.json
//   调度的"立即备份"通过 storage.mjs#backupDataDir() 实现
//
// 字段：
//   intervalHours: 0 / 6 / 24 / 168（0 = 关闭）
//   lastBackupAt:  number | null  （ms 时间戳；运行时通过 _getLastBackupInfo() 读 backups/ 目录 mtime，不持久化）
//   lastResult:    'ok' | 'failed' | null
//   lastError:     string
//
// API：
//   getBackupConfig()                    -> { intervalHours, lastBackupAt, lastResult, lastError, lastBackupFile, lastBackupSize }
//   setBackupConfig(intervalHours)       -> { ok, error_code? }
//   startBackupScheduler()                -> void（启动时调一次；server 周期触发 + 启动时补跑）
//   runBackupNow()                        -> Promise<{ ok, path?, bytes?, error_code?, message? }>
//   stopBackupScheduler()                 -> void（SIGTERM 优雅关闭）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as storage from "./storage.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname);
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const CONFIG_FILE = path.join(DATA_DIR, "backup-config.json");
const BACKUP_DIR = path.join(PROJECT_ROOT, "backups");

const WXD_SYS_0002 = "WXD-SYS-0002";
const WXD_SYS_0003 = "WXD-SYS-0003";

const VALID_INTERVALS = [0, 6, 24, 168];

let _cfg = null;
let _timer = null;
let _running = false;

function mkdirSafe(dir, mode) {
  try { fs.mkdirSync(dir, { recursive: true, mode: mode || 0o700 }); } catch (_) {}
}

function readConfigFromDisk() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch (_) { return null; }
}

function writeConfigToDisk(obj) {
  mkdirSafe(DATA_DIR, 0o700);
  const tmp = CONFIG_FILE + ".tmp-" + Math.random().toString(36).slice(2, 8);
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, CONFIG_FILE);
    try { fs.chmodSync(CONFIG_FILE, 0o600); } catch (_) {}
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    const err = new Error("write backup-config.json failed: " + (e && e.message));
    err.error_code = WXD_SYS_0003;
    err.stage = "backup-config.mjs#writeConfigToDisk";
    throw err;
  }
}

export function getBackupConfig() {
  if (!_cfg) _cfg = readConfigFromDisk() || { intervalHours: 24, lastResult: null, lastError: "" };
  // 永远从 backups/ 目录 mtime 重算 lastBackupAt，避免持久化数据过期
  const info = getLastBackupInfo();
  return Object.assign({}, _cfg, info);
}

export function setBackupConfig(intervalHours) {
  if (!VALID_INTERVALS.includes(Number(intervalHours))) {
    return { ok: false, error_code: WXD_SYS_0003, message: "intervalHours 必须 ∈ [0, 6, 24, 168]" };
  }
  _cfg = Object.assign({}, _cfg || {}, { intervalHours: Number(intervalHours) });
  try { writeConfigToDisk(_cfg); }
  catch (e) {
    return { ok: false, error_code: e.error_code || WXD_SYS_0003, message: e.message, stage: e.stage };
  }
  restartScheduler();
  return { ok: true, config: getBackupConfig() };
}

export function getLastBackupInfo() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return { lastBackupAt: null, lastBackupFile: null, lastBackupSize: 0 };
    const names = fs.readdirSync(BACKUP_DIR).filter(function (n) {
      return typeof n === "string" && n.startsWith("wxd-backup-") && n.endsWith(".zip");
    });
    if (!names.length) return { lastBackupAt: null, lastBackupFile: null, lastBackupSize: 0 };
    let bestMtime = 0, bestFile = null, bestSize = 0;
    for (const n of names) {
      const abs = path.join(BACKUP_DIR, n);
      try {
        const st = fs.statSync(abs);
        if (st.isFile() && st.mtimeMs > bestMtime) {
          bestMtime = st.mtimeMs;
          bestFile = n;
          bestSize = st.size;
        }
      } catch (_) {}
    }
    return bestFile
      ? { lastBackupAt: bestMtime, lastBackupFile: bestFile, lastBackupSize: bestSize }
      : { lastBackupAt: null, lastBackupFile: null, lastBackupSize: 0 };
  } catch (_) {
    return { lastBackupAt: null, lastBackupFile: null, lastBackupSize: 0 };
  }
}

export async function runBackupNow() {
  if (_running) return { ok: false, error_code: WXD_SYS_0002, message: "已有备份任务在执行" };
  _running = true;
  try {
    const res = await storage.backupDataDir(BACKUP_DIR);
    const now = Date.now();
    _cfg = Object.assign({}, _cfg || {}, {
      intervalHours: (_cfg && _cfg.intervalHours) || 24,
      lastResult: "ok",
      lastError: "",
      lastRunAt: now,
    });
    try { writeConfigToDisk(_cfg); } catch (_) {}
    return { ok: true, path: res.path, bytes: res.bytes, count: res.count, lastBackupAt: now };
  } catch (e) {
    _cfg = Object.assign({}, _cfg || {}, {
      lastResult: "failed",
      lastError: (e && e.message) || String(e),
      lastRunAt: Date.now(),
    });
    try { writeConfigToDisk(_cfg); } catch (_) {}
    return {
      ok: false,
      error_code: (e && e.error_code) || WXD_SYS_0002,
      message: (e && e.message) || "备份失败",
      stage: (e && e.stage) || "backup-config.mjs#runBackupNow",
    };
  } finally {
    _running = false;
  }
}

function scheduleNextRun() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (!_cfg) _cfg = readConfigFromDisk() || { intervalHours: 24 };
  const hours = Number(_cfg.intervalHours || 0);
  if (!hours) return; // 关闭
  const ms = hours * 3600 * 1000;
  _timer = setTimeout(async function () {
    try { await runBackupNow(); } catch (_) {}
    scheduleNextRun(); // 排下一次
  }, ms);
  if (_timer.unref) _timer.unref(); // 不阻塞 server 退出
}

export function startBackupScheduler() {
  if (!_cfg) _cfg = readConfigFromDisk() || { intervalHours: 24 };
  scheduleNextRun();
}

export function stopBackupScheduler() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

export function restartScheduler() {
  stopBackupScheduler();
  startBackupScheduler();
}
