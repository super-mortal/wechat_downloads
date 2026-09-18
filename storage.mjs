// storage.mjs - 存储与索引（slug、index.json、Markdown / HTML 落盘）
//   对应 DEV_PLAN.md §9.1 / §9.2 / §9.3（M4：存储与索引）
//   错误码：WXD-STORAGE-0001 / 0002 / 0003
//   写入：单进程串行，原子写（tmp + rename），无需锁

import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { atomicWriteJsonAsync } from "./auth.mjs";
import { makeZip } from "./zip.mjs";

// ---- 路径解析（相对本文件即项目根） ----
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.dirname(__filename);

// 所有路径集中在一个对象里，方便测试覆盖
const paths = {
  root: PROJECT_ROOT,
  dataDir: path.join(PROJECT_ROOT, "data"),
  mdDir: path.join(PROJECT_ROOT, "data", "md"),
  indexPath: path.join(PROJECT_ROOT, "data", "index.json"),
  publicDir: path.join(PROJECT_ROOT, "public", "wechat", "download"),
  publicIndex: path.join(PROJECT_ROOT, "public", "wechat", "download", "index.json"),
};

// ---- 错误码登记（与 dev-spec.md 保持一致） ----
const ERROR_CODES = {
  "WXD-STORAGE-0001": { http: 500, message: "读 / 写 data/index.json 失败" },
  "WXD-STORAGE-0002": { http: 500, message: "slug 冲突且 MD5 不一致" },
  "WXD-STORAGE-0003": { http: 500, message: "Markdown / HTML 写盘失败" },
  "WXD-STORAGE-0004": { http: 500, message: "data 目录不可写（备份 / 恢复失败）" },
  "WXD-STORAGE-0005": { http: 500, message: "备份文件不存在或损坏" },
  "WXD-STORAGE-0006": { http: 500, message: "atomic rename 失败（磁盘满 / 权限不足）" },
};

class StorageError extends Error {
  constructor(code, stage, details) {
    const def = ERROR_CODES[code];
    super((def && def.message) || code);
    this.error_code = code;
    this.message = (def && def.message) || code;
    this.stage = stage;
    this.http = (def && def.http) || 500;
    this.details = details || {};
  }
  toJSON() {
    return {
      error_code: this.error_code,
      message: this.message,
      stage: this.stage,
      details: this.details,
    };
  }
}

// ---- 工具：北京时间 YYYY-MM-DD 与 ISO 8601 +08:00 ----
function beijingDateParts(d) {
  // 把任意 Date 转成北京时间（UTC+8）的 {y, m, dd, hh, mi, ss}
  const beijingMs = d.getTime() + 8 * 3600 * 1000;
  const b = new Date(beijingMs);
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return {
    y: b.getUTCFullYear(),
    m: pad(b.getUTCMonth() + 1),
    dd: pad(b.getUTCDate()),
    hh: pad(b.getUTCHours()),
    mi: pad(b.getUTCMinutes()),
    ss: pad(b.getUTCSeconds()),
  };
}

function beijingDateString(d) {
  const p = beijingDateParts(d);
  return p.y + "-" + p.m + "-" + p.dd;
}

function beijingIsoString(d) {
  const p = beijingDateParts(d);
  return p.y + "-" + p.m + "-" + p.dd + "T" + p.hh + ":" + p.mi + ":" + p.ss + "+08:00";
}

// ---- slug 规则：v3 = <yyyy-mm-dd>-<hash6>（title 不进 URL） ----
//   title-kebab 思路：去掉控制字符、空白替换为 -、去掉连续 -、首尾 -
//   中文保留（不强求 kebab），遇到 ASCII 之外字符直接保留
function slugifyTitle(title) {
  if (title == null) return "untitled";
  const s = String(title)
    .replace(/[\u0000-\u001f\u007f]/g, "") // 控制字符
    .replace(/\s+/g, "-")                  // 空白 → -
    .replace(/[\\/:*?"<>|]+/g, "")         // 文件系统非法字符
    .replace(/-+/g, "-")                   // 连续 - 合并
    .replace(/^-+|-+$/g, "")               // 首尾 -
    .slice(0, 80);                         // 截断防过长
  return s || "untitled";
}

export function buildSlug(url, title, now) {
  if (typeof url !== "string" || !url) {
    throw new StorageError("WXD-STORAGE-0002", "storage.mjs#buildSlug", { reason: "url is empty" });
  }
  const d = now instanceof Date ? now : new Date();
  const dateStr = beijingDateString(d);
  const hash6 = crypto.createHash("md5").update(url).digest("hex").slice(0, 6);
  return dateStr + "-" + hash6;
}

// ---- 原子写（tmp + rename） ----
//   委托给 auth.mjs#atomicWriteJsonAsync，行为一致；抛出时由调用方包装 WXD-STORAGE-0003 / 0006
async function atomicWriteFile(targetPath, data) {
  try {
    await atomicWriteJsonAsync(targetPath, data, undefined);
  } catch (e) {
    if (e && e.code === "EACCES") {
      throw new StorageError("WXD-STORAGE-0004", "storage.mjs#atomicWriteFile", { reason: e.message, targetPath });
    }
    if (e && e.code === "ENOSPC") {
      throw new StorageError("WXD-STORAGE-0006", "storage.mjs#atomicWriteFile", { reason: e.message, targetPath });
    }
    throw new StorageError("WXD-STORAGE-0006", "storage.mjs#atomicWriteFile", { reason: e && e.message, targetPath });
  }
}

// ---- 索引读写 ----
export async function readIndex() {
  let raw;
  try {
    raw = await fsp.readFile(paths.indexPath, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw new StorageError("WXD-STORAGE-0001", "storage.mjs#readIndex", { cause: e && e.message });
  }
  try {
    const text = String(raw || "").trim();
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    throw new StorageError("WXD-STORAGE-0001", "storage.mjs#readIndex", { cause: e && e.message });
  }
}

export async function writeIndex(arr) {
  if (!Array.isArray(arr)) {
    throw new StorageError("WXD-STORAGE-0001", "storage.mjs#writeIndex", { reason: "arr is not array" });
  }
  try {
    const data = JSON.stringify(arr, null, 2);
    await atomicWriteFile(paths.indexPath, data);
  } catch (e) {
    if (e instanceof StorageError) throw e;
    throw new StorageError("WXD-STORAGE-0001", "storage.mjs#writeIndex", { cause: e && e.message });
  }
}

export async function findByUrl(url) {
  if (typeof url !== "string" || !url) return null;
  const idx = await readIndex();
  for (const e of idx) {
    if (e && typeof e === "object" && e.url === url) return e;
  }
  return null;
}

function isValidEntry(e) {
  return e && typeof e === "object" && typeof e.slug === "string" && typeof e.url === "string";
}

// ---- 落盘 ----
export async function writeMarkdown(slug, md) {
  if (typeof slug !== "string" || !slug) {
    throw new StorageError("WXD-STORAGE-0003", "storage.mjs#writeMarkdown", { reason: "slug is empty" });
  }
  try {
    const target = path.join(paths.mdDir, slug + ".md");
    await atomicWriteFile(target, md == null ? "" : String(md));
    return { path: target, relPath: "data/md/" + slug + ".md" };
  } catch (e) {
    if (e instanceof StorageError) throw e;
    throw new StorageError("WXD-STORAGE-0003", "storage.mjs#writeMarkdown", { cause: e && e.message, slug });
  }
}

export async function writeHtml(slug, html) {
  if (typeof slug !== "string" || !slug) {
    throw new StorageError("WXD-STORAGE-0003", "storage.mjs#writeHtml", { reason: "slug is empty" });
  }
  try {
    const target = path.join(paths.publicDir, slug + ".html");
    await atomicWriteFile(target, html == null ? "" : String(html));
    return { path: target, relPath: "/wechat/download/" + slug + ".html" };
  } catch (e) {
    if (e instanceof StorageError) throw e;
    throw new StorageError("WXD-STORAGE-0003", "storage.mjs#writeHtml", { cause: e && e.message, slug });
  }
}

// ---- 索引写入（去重） ----
export async function addEntry(entry) {
  if (!isValidEntry(entry)) {
    throw new StorageError("WXD-STORAGE-0001", "storage.mjs#addEntry", { reason: "entry invalid" });
  }
  const idx = await readIndex();
  // 1) 同 url 直接返回旧 entry（去重）
  for (const e of idx) {
    if (e && e.url === entry.url) {
      return e;
    }
  }
  // 2) slug 冲突：同 slug 但 url 不同 → MD5 hash6 应不同，理论上不应发生
  //    若发生则说明 slug 算错或外部数据被篡改，抛 WXD-STORAGE-0002
  for (const e of idx) {
    if (e && e.slug === entry.slug && e.url !== entry.url) {
      const entryHash = crypto.createHash("md5").update(entry.url).digest("hex").slice(0, 6);
      const oldHash = crypto.createHash("md5").update(e.url).digest("hex").slice(0, 6);
      throw new StorageError("WXD-STORAGE-0002", "storage.mjs#addEntry", {
        slug: entry.slug,
        oldUrl: e.url,
        newUrl: entry.url,
        oldHash,
        newHash: entryHash,
      });
    }
  }
  idx.push(entry);
  await writeIndex(idx);
  return entry;
}

// ---- 镜像到 public/wechat/download/index.json ----
export async function mirrorIndexToPublic() {
  try {
    const idx = await readIndex();
    const data = JSON.stringify(idx, null, 2);
    await atomicWriteFile(paths.publicIndex, data);
    return { path: paths.publicIndex, count: idx.length };
  } catch (e) {
    if (e instanceof StorageError) throw e;
    throw new StorageError("WXD-STORAGE-0001", "storage.mjs#mirrorIndexToPublic", { cause: e && e.message });
  }
}

// ---- 给上层调用的便捷构造器 ----
export function buildEntry({ url, title, author, slug, mdPath, sizeBytes, now }) {
  if (typeof url !== "string" || !url) {
    throw new StorageError("WXD-STORAGE-0001", "storage.mjs#buildEntry", { reason: "url missing" });
  }
  if (typeof slug !== "string" || !slug) {
    throw new StorageError("WXD-STORAGE-0001", "storage.mjs#buildEntry", { reason: "slug missing" });
  }
  const d = now instanceof Date ? now : new Date();
  return {
    slug,
    title: title == null ? "" : String(title),
    author: author == null ? "" : String(author),
    url,
    md_path: mdPath || ("data/md/" + slug + ".md"),
    html_url: "/wechat/download/" + slug + ".html",
    created_at: beijingIsoString(d),
    size_bytes: typeof sizeBytes === "number" && sizeBytes >= 0 ? Math.floor(sizeBytes) : 0,
  };
}

// ---- 目录初始化（被 server 启动钩子调用） ----
export async function ensureDirs() {
  await fsp.mkdir(paths.dataDir, { recursive: true });
  await fsp.mkdir(paths.mdDir, { recursive: true });
  await fsp.mkdir(paths.publicDir, { recursive: true });
}

// ---- init：启动钩子 ----
//   1) ensureDirs：创建 data/ data/md/ public/wechat/download/（已存在则跳过）
//   2) 从 data/index.json 预热读取 → 如果文件不存在 / 损坏则返回空数组（不影响首次启动）
//   3) 同步 mirrorIndexToPublic：保证 public 端 index 跟 data 端一致
//   调用方：server.mjs 在 listen 之前 await storage.init()
export async function init() {
  await ensureDirs();
  // 预读 index（损坏不抛：startup 启动钩子对读写错误返回 500 但不退出；这里只是 warm-up）
  try {
    const idx = await readIndex();
    if (Array.isArray(idx) && idx.length > 0) {
      try { await mirrorIndexToPublic(); } catch (_) {}
    }
  } catch (e) {
    // 损坏：写一条审计日志（如果 auth 模块已加载则用 appendAudit，否则吞掉）
    try {
      const { appendAudit } = await import("./auth.mjs");
      appendAudit({ action: "init_load_index_failed", ok: false, details: { message: e && e.message } });
    } catch (_) {}
  }
}

// ---- 备份 / 恢复（§六.D. 备份恢复） ----
//   实现：基于 zip.mjs#makeZip 的 store-only ZIP；
//         zip 内目录布局：
//           data/index.json
//           data/md/<slug>.md
//           public/wechat/download/<slug>.html
//           public/wechat/download/index.json
//         （不打包 data/auth.json / data/sessions.json / data/admin.log / data/auth-failures.json）
//   outDir：备份目录（默认项目根 backups/）；最终文件 = outDir/wxd-backup-<YYYYMMDD-HHMM>.zip
//   失败抛 WXD-STORAGE-0004（目录不可写）或 WXD-STORAGE-0006（写盘失败）

// 列出要打包的文件（相对项目根）
async function _listBackupFiles() {
  const out = [];
  // 1) data/index.json
  try {
    const st = await fsp.stat(paths.indexPath);
    if (st.isFile()) out.push({ abs: paths.indexPath, rel: "data/index.json" });
  } catch (_) {}
  // 2) data/md/*.md
  try {
    const names = await fsp.readdir(paths.mdDir);
    for (const n of names) {
      if (typeof n === "string" && n.endsWith(".md")) {
        const abs = path.join(paths.mdDir, n);
        try {
          const st = await fsp.stat(abs);
          if (st.isFile()) out.push({ abs, rel: "data/md/" + n });
        } catch (_) {}
      }
    }
  } catch (_) {}
  // 3) public/wechat/download/index.json + *.html
  try {
    const names = await fsp.readdir(paths.publicDir);
    for (const n of names) {
      if (typeof n !== "string") continue;
      const abs = path.join(paths.publicDir, n);
      try {
        const st = await fsp.stat(abs);
        if (!st.isFile()) continue;
      } catch (_) { continue; }
      if (n === "index.json") out.push({ abs, rel: "public/wechat/download/index.json" });
      else if (n.endsWith(".html")) out.push({ abs, rel: "public/wechat/download/" + n });
    }
  } catch (_) {}
  return out;
}

export async function backupDataDir(outDir) {
  // 1) 准备 outDir
  const targetDir = outDir && typeof outDir === "string"
    ? outDir
    : path.join(PROJECT_ROOT, "backups");
  try {
    await fsp.mkdir(targetDir, { recursive: true });
  } catch (e) {
    throw new StorageError("WXD-STORAGE-0004", "storage.mjs#backupDataDir", { reason: e && e.message, outDir: targetDir });
  }
  // 2) 列举 + 读取文件
  const files = await _listBackupFiles();
  if (!files.length) {
    // 没有任何归档数据：仍然生成一个空 zip（manifest.txt 说明），避免下游 null 判断
    files.push({ abs: null, rel: "MANIFEST.txt", text: "empty backup - no archive files yet\n" });
  }
  // 3) 组装 zip entries
  const entries = [];
  for (const f of files) {
    let content;
    if (f.text != null) {
      content = Buffer.from(f.text, "utf8");
    } else {
      try {
        content = await fsp.readFile(f.abs);
      } catch (e) {
        throw new StorageError("WXD-STORAGE-0006", "storage.mjs#backupDataDir", { reason: e && e.message, file: f.rel });
      }
    }
    entries.push({ name: f.rel, content: content });
  }
  // 4) 生成 zip
  let buf;
  try {
    buf = makeZip(entries);
  } catch (e) {
    throw new StorageError("WXD-STORAGE-0006", "storage.mjs#backupDataDir", { reason: e && e.message });
  }
  // 5) 写入 outDir（atomic rename）
  const stamp = (function () {
    const d = new Date();
    const ms = d.getTime() + 8 * 3600 * 1000;
    const b = new Date(ms);
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    return b.getUTCFullYear() + pad(b.getUTCMonth() + 1) + pad(b.getUTCDate()) + "-" + pad(b.getUTCHours()) + pad(b.getUTCMinutes()) + pad(b.getUTCSeconds());
  })();
  const fileName = "wxd-backup-" + stamp + ".zip";
  const targetPath = path.join(targetDir, fileName);
  try {
    await atomicWriteJsonAsync(targetPath, buf);
  } catch (e) {
    throw new StorageError("WXD-STORAGE-0004", "storage.mjs#backupDataDir", { reason: e && e.message, targetPath });
  }
  return { path: targetPath, count: entries.length, bytes: buf.length };
}

// ---- restoreDataDir ----
//   zipPath: 备份文件绝对路径
//   行为：
//     * 不覆盖现有文件（如果目标已存在 → 跳过并在返回里累计；安全失败模式）
//     * 解压后调用 mirrorIndexToPublic 保证两端 index 同步
//   失败抛 WXD-STORAGE-0005（备份文件不存在 / 损坏）

function _findEocd(buf) {
  // 找 EOCD record (0x06054b50)
  const SIG = 0x06054b50;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === SIG) return i;
  }
  return -1;
}

function _crc32(buf) {
  // 与 zip.mjs#crc32 一致的算法（PKZIP polynomial）
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export async function restoreDataDir(zipPath) {
  if (typeof zipPath !== "string" || !zipPath) {
    throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "zipPath empty" });
  }
  let buf;
  try {
    buf = await fsp.readFile(zipPath);
  } catch (e) {
    throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "cannot read zip: " + (e && e.message), zipPath });
  }
  // 解析 EOCD
  const eocdPos = _findEocd(buf);
  if (eocdPos < 0) {
    throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "EOCD not found", zipPath });
  }
  const totalEntries = buf.readUInt16LE(eocdPos + 10);
  const centralSize = buf.readUInt32LE(eocdPos + 12);
  const centralOffset = buf.readUInt32LE(eocdPos + 16);
  if (centralOffset + centralSize > buf.length) {
    throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "central dir out of range", zipPath });
  }
  let pos = centralOffset;
  const restored = [];
  const skipped = [];
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > buf.length) {
      throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "central entry out of range", zipPath });
    }
    if (buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "bad central entry signature", zipPath });
    }
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const compSize = buf.readUInt32LE(pos + 20);
    const compMethod = buf.readUInt16LE(pos + 10);
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString("utf8");
    // 跳过目录 / MANIFEST / 备份专属元数据
    if (name.endsWith("/") || name === "MANIFEST.txt") {
      pos += 46 + nameLen + extraLen + commentLen;
      continue;
    }
    // 读 local header
    if (localOffset + 30 > buf.length) {
      throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "local header out of range", file: name });
    }
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "bad local entry signature", file: name });
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (compMethod !== 0) {
      throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "unsupported compression method: " + compMethod, file: name });
    }
    if (dataStart + compSize > buf.length) {
      throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "entry data out of range", file: name });
    }
    const data = buf.slice(dataStart, dataStart + compSize);
    // 安全校验：白名单路径（不允许 .. 或绝对路径）
    if (name.includes("..") || name.startsWith("/") || name.startsWith("\\")) {
      throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "unsafe entry path", file: name });
    }
    const targetAbs = path.join(PROJECT_ROOT, name);
    // 限制必须落在 PROJECT_ROOT 下
    const rel = path.relative(PROJECT_ROOT, targetAbs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "path escapes project root", file: name });
    }
    // 不覆盖现有
    let existed = false;
    try {
      const st = await fsp.stat(targetAbs);
      if (st.isFile()) existed = true;
    } catch (_) {}
    if (existed) {
      skipped.push(name);
    } else {
      try {
        await fsp.mkdir(path.dirname(targetAbs), { recursive: true });
        await fsp.writeFile(targetAbs, data);
      } catch (e) {
        throw new StorageError("WXD-STORAGE-0005", "storage.mjs#restoreDataDir", { reason: "write failed: " + (e && e.message), file: name });
      }
      restored.push(name);
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  // 同步 mirror（如果 index.json 被恢复了）
  if (restored.some(n => n === "data/index.json" || n === "public/wechat/download/index.json")) {
    try { await mirrorIndexToPublic(); } catch (_) {}
  }
  return { restored: restored, skipped: skipped, count: restored.length };
}

// ---- 路径覆盖（仅供测试使用） ----
export function _setPathsForTest(overrides) {
  if (!overrides || typeof overrides !== "object") return;
  for (const k of Object.keys(paths)) {
    if (typeof overrides[k] === "string") paths[k] = overrides[k];
  }
}

export function _resetPathsForTest() {
  paths.root = PROJECT_ROOT;
  paths.dataDir = path.join(PROJECT_ROOT, "data");
  paths.mdDir = path.join(PROJECT_ROOT, "data", "md");
  paths.indexPath = path.join(PROJECT_ROOT, "data", "index.json");
  paths.publicDir = path.join(PROJECT_ROOT, "public", "wechat", "download");
  paths.publicIndex = path.join(PROJECT_ROOT, "public", "wechat", "download", "index.json");
}

export function _getPaths() {
  return Object.assign({}, paths);
}

export { StorageError };

