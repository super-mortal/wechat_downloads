// storage.mjs - 存储与索引（slug、index.json、Markdown / HTML 落盘）
//   对应 DEV_PLAN.md §9.1 / §9.2 / §9.3（M4：存储与索引）
//   错误码：WXD-STORAGE-0001 / 0002 / 0003
//   写入：单进程串行，原子写（tmp + rename），无需锁

import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

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

// ---- slug 规则：<yyyy-mm-dd>-<title-kebab>-<hash6> ----
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
  const titleKebab = slugifyTitle(title);
  const hash6 = crypto.createHash("md5").update(url).digest("hex").slice(0, 6);
  return dateStr + "-" + titleKebab + "-" + hash6;
}

// ---- 原子写（tmp + rename） ----
async function atomicWriteFile(targetPath, data) {
  const dir = path.dirname(targetPath);
  await fsp.mkdir(dir, { recursive: true });
  const tmpPath = targetPath + ".tmp-" + crypto.randomBytes(4).toString("hex");
  await fsp.writeFile(tmpPath, data);
  try {
    await fsp.rename(tmpPath, targetPath);
  } catch (e) {
    // 兜底：rename 失败时尝试 copyFile + unlink（Windows 上偶发）
    try {
      await fsp.copyFile(tmpPath, targetPath);
      await fsp.unlink(tmpPath);
    } catch (e2) {
      try { await fsp.unlink(tmpPath); } catch (_) {}
      throw e2;
    }
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

