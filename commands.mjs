// commands.mjs - 斜杠命令分发（DEV_PLAN.md §6.3）
//   错误码：WXD-CMD-0001（理论上不应触发，兜底给 127.0.0.1）
//   接口：handleCommand(text, baseUrl) -> string | null
//   返回 null 表示「非命令 / 未知命令」，由 agent 层再处理

import { readIndex } from "./storage.mjs";

const WXD_CMD_0001 = "WXD-CMD-0001";

/**
 * 命令分发实现（严格按 §6.3）：
 *   /help  → 帮助文案
 *   /all   → 列表页 URL
 *   /count → 已收录数量
 *   其它  → 返回 null（未知命令）
 * @param {string} text 用户文本（trim 后）
 * @param {string} baseUrl 公网域名（含协议，无尾斜杠）
 * @returns {Promise<string | null>}
 */
export async function handleCommand(text, baseUrl) {
  // 兜底：baseUrl 为空时退到 127.0.0.1:3915，避免命令回执丢域名
  const safeBase = (typeof baseUrl === "string" && baseUrl)
    ? baseUrl.replace(/\/+$/, "")
    : "http://127.0.0.1:3915";

  const [cmd] = String(text || "").trim().split(/\s+/);
  switch (cmd) {
    case "/help":
      return "可用命令：\n/all · 所有文章列表\n/count · 文章数量\n/help · 本帮助\n\n直接发 mp.weixin.qq.com/s/... 也可收录";
    case "/all":
      return `${safeBase}/wechat/download`;
    case "/count": {
      const idx = await readIndex();
      return `已收录 ${idx.length} 篇`;
    }
    default:
      return null;
  }
}

// 占位导出错误码常量，便于测试 / 文档对齐；并未在主流程抛错（dev-spec.md 已说明兜底）
export { WXD_CMD_0001 };
