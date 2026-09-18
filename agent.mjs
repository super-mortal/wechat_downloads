// agent.mjs - 微信 ClawBot Agent.chat 实现（DEV_PLAN.md §5 / §6.3 / §A.2）
//   错误码：WXD-BOT-0001 / WXD-CMD-0001 / WXD-NET-0001（错误码在 dev-spec.md 登记）
//   接口（§A.2）：agent.chat(req) -> Promise<{ text?: string }>
//   req: { conversationId, text, media? }
//   回执原则（§5.3 / 红线）：只有 URL 一行 / 无标题 / 无路径 / 无 emoji

import fsp from "node:fs/promises";
import { downloadArticle as _origDownloadArticle } from "./article.mjs";
import { handleCommand } from "./commands.mjs";
import {
  buildSlug,
  addEntry,
  findByUrl,
  writeMarkdown,
  writeHtml,
  mirrorIndexToPublic,
  buildEntry,
} from "./storage.mjs";
import { getCachedPublicBaseUrl } from "./domain.mjs";

// 错误码常量
const WXD_BOT_0001 = "WXD-BOT-0001";
const WXD_CMD_0001 = "WXD-CMD-0001";
const WXD_NET_0001 = "WXD-NET-0001";

// mp.weixin.qq.com/s/xxx 链接识别正则（§6）
const URL_RE = /https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]+/;

// 文案常量（与 dev-spec.md / §5.3 严格对齐）
const TEXT_FETCH_FAIL = "该文章无法访问，换一条试试";
const TEXT_NON_COMMAND = "请发 mp.weixin.qq.com/s/... 公众号链接，或 /help 看命令";
const TEXT_UNKNOWN_CMD = "未知命令。发送 /help 查看用法。";

// 可注入的 downloadArticle（仅供测试替换）
let _downloadArticle = _origDownloadArticle;

/**
 * @internal 仅供 tests/agent.test.mjs 替换 downloadArticle，避免真实抓取。
 * @param {(opts: { url: string, formats?: string[], split?: boolean, browser?: any }) => Promise<any>} fn
 */
export function _setDownloadArticleForTest(fn) {
  _downloadArticle = typeof fn === "function" ? fn : _origDownloadArticle;
}

/**
 * @internal 仅供 tests/agent.test.mjs 在测试结束后还原。
 */
export function _resetDownloadArticleForTest() {
  _downloadArticle = _origDownloadArticle;
}

/**
 * 构造符合 dev-spec.md 错误响应结构的错误对象。
 * @param {string} errorCode
 * @param {string} message
 * @param {string} stage
 * @returns {Error}
 */
function makeAgentError(errorCode, message, stage) {
  const e = new Error(message);
  e.error_code = errorCode;
  e.message = message;
  e.stage = stage;
  e.request_id = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : "";
  e.details = {};
  return e;
}

/**
 * 从 downloadArticle 返回的 outputs 数组里挑出 md / html 的内容（按 format 匹配，读取磁盘）。
 * 抓取失败 / 字段缺失时返回空串，不抛错（外层 catch 兜底）。
 * @param {Array<{format: string, path?: string}>} outputs
 * @returns {Promise<{ md: string, html: string }>}
 */
async function readOutputsContent(outputs) {
  let md = "";
  let html = "";
  if (!Array.isArray(outputs)) return { md, html };
  for (const o of outputs) {
    if (!o || typeof o !== "object") continue;
    if (o.format === "md" && typeof o.path === "string") {
      try { md = await fsp.readFile(o.path, "utf8"); } catch (_) { /* keep empty */ }
    } else if (o.format === "html" && typeof o.path === "string") {
      try { html = await fsp.readFile(o.path, "utf8"); } catch (_) { /* keep empty */ }
    }
  }
  return { md, html };
}

/**
 * 主流程：抓取 + 落盘 + 索引 + 镜像 + 回执。
 * 失败一律走 WXD-NET-0001，对应回执「该文章无法访问，换一条试试」。
 * @param {string} url
 * @param {string} baseUrl
 * @returns {Promise<{ text: string }>}
 */
async function downloadAndReply(url, baseUrl) {
  let result;
  try {
    result = await _downloadArticle({ url, formats: ["md", "html"], split: false });
  } catch (err) {
    console.error("[agent] downloadArticle 抛出", { url, err: err && err.message });
    return { text: TEXT_FETCH_FAIL };
  }

  if (!result || result.ok !== true) {
    console.error("[agent] downloadArticle 返回非 ok", { url, result });
    return { text: TEXT_FETCH_FAIL };
  }

  const title = (typeof result.title === "string" && result.title) ? result.title : "未命名";
  const author = (typeof result.author === "string" && result.author) ? result.author : "未知作者";

  // 读取 md / html 真实内容（downloadArticle 写到磁盘，再读回走 storage.writeXxx 落 slug 路径）
  const { md, html } = await readOutputsContent(result.outputs);

  // slug + 落盘（slug 来自 url + title，重复 URL 会在外层 findByUrl 先命中）
  const slug = buildSlug(url, title);

  try {
    await writeMarkdown(slug, md);
    await writeHtml(slug, html);
  } catch (err) {
    console.error("[agent] 写盘失败", { slug, err: err && err.message });
    // 写盘失败：仍视作抓取失败（避免半成品索引）
    return { text: TEXT_FETCH_FAIL };
  }

  // 写索引
  const sizeBytes = Buffer.byteLength(md || "", "utf8");
  const entry = buildEntry({ url, title, author, slug, sizeBytes });
  try {
    await addEntry(entry);
    await mirrorIndexToPublic();
  } catch (err) {
    console.error("[agent] 索引写入失败", { slug, err: err && err.message });
    return { text: TEXT_FETCH_FAIL };
  }

  // 回执（v3：标题在上，URL 在下；微信会把第二行的 URL 自动识别成可点链接卡片）
  const urlLine = `${baseUrl}/wechat/download/${slug}.html`;
  const titleLine = title && title !== "未命名" ? title : "";
  const text = titleLine ? (titleLine + "\n" + urlLine) : urlLine;
  return { text };
}

/**
 * @typedef {{ conversationId?: string, text?: string, media?: any }} ChatRequest
 */

/**
 * Agent 接口（§A.2）：chat(req) -> Promise<{ text? }>
 * @param {ChatRequest} req
 * @returns {Promise<{ text: string }>}
 */
export const agent = {
  async chat(req) {
    const baseUrl = getCachedPublicBaseUrl();
    const text = (req && typeof req.text === "string") ? req.text.trim() : "";

    // 1) 斜杠命令：先派发；未知命令 → 未知命令文案
    if (text.startsWith("/")) {
      let reply = null;
      try {
        reply = await handleCommand(text, baseUrl);
      } catch (err) {
        // 命令分发异常：理论上不该出现（兜底已处理），但仍按规范走 WXD-CMD-0001
        if (err && err.error_code === WXD_CMD_0001) {
          return { text: TEXT_UNKNOWN_CMD };
        }
        console.error("[agent] handleCommand 异常", { err: err && err.message });
        return { text: TEXT_UNKNOWN_CMD };
      }
      if (reply === null || typeof reply !== "string") {
        return { text: TEXT_UNKNOWN_CMD };
      }
      return { text: reply };
    }

    // 2) URL 检测：命中 → 重复检查 → 抓取
    const m = text.match(URL_RE);
    if (!m) {
      return { text: TEXT_NON_COMMAND };
    }
    const url = m[0];

    // 2a) 重复 URL：直接复用旧 entry 的 html_url（不再抓取）
    try {
      const existing = await findByUrl(url);
      if (existing && existing.html_url) {
        const urlLine2 = `${baseUrl}${existing.html_url}`;
        const titleLine2 = existing.title && existing.title !== "未命名" ? existing.title : "";
        const text2 = titleLine2 ? (titleLine2 + "\n" + urlLine2) : urlLine2;
        return { text: text2 };
      }
    } catch (_) {
      // findByUrl 失败：忽略，继续走抓取分支
    }

    // 2b) 抓取 + 落盘 + 写索引
    return await downloadAndReply(url, baseUrl);
  },
};

/**
 * 暴露错误码常量供上层（如 server.mjs 的兜底中间件）使用。
 */
export const errorCodes = {
  WXD_BOT_0001,
  WXD_CMD_0001,
  WXD_NET_0001,
};

/**
 * @internal 仅供单测断言 / 调试：检查 agent.chat 的返回值是否含 text。
 * 缺 text 时构造 WXD-BOT-0001 错误对象。
 * @param {{ text?: string }} reply
 */
export function assertReplyShape(reply) {
  if (!reply || typeof reply.text !== "string") {
    throw makeAgentError(
      WXD_BOT_0001,
      "agent.chat 返回值缺 text",
      "agent.mjs#chat"
    );
  }
}
