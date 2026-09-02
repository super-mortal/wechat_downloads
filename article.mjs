// article.mjs：抓取 + 多格式输出
// 设计原则：
//   * 浏览器逻辑走 ./engine.mjs，零第三方字眼从这里传出；
//   * 不依赖任何第三方 ZIP/HTML 库——HTML 文档手工拼接，ZIP 由 ./zip.mjs 提供。

import path from "node:path";
import fsLib from "node:fs/promises";
import { URL } from "node:url";
import crypto from "node:crypto";
import {
  openBrowser, openPage, navigateAndWait,
  readArticleDOM, extractStyles, pdfFromHtmlBuffer, dispose
} from "./engine.mjs";

// 下载图片一次，可产出 local 路径 / base64 data URI 两种用法
async function downloadAllImages(html, baseUrl, imgsDir) {
  const re = /<img\b[^>]*?\b(?:data-src|data-original|src)=["']([^"']+)["'][^>]*>/gi;
  const urlMap = new Map();
  const tasks = [];
  for (const m of html.matchAll(re)) {
    const url = m[1];
    if (url.startsWith("data:")) continue;
    if (!urlMap.has(url)) {
      urlMap.set(url, { localName: null, dataUri: null });
      tasks.push((async () => {
        try {
          const abs = new URL(url, baseUrl).href;
          const r = await fetch(abs, {
            headers: { "Referer": baseUrl, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
            redirect: "follow",
            signal: AbortSignal.timeout(15000)
          });
          if (!r.ok) return;
          const buf = Buffer.from(await r.arrayBuffer());
          const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
          const h = crypto.createHash("md5").update(abs).digest("hex").substring(0, 10);
          let ext = ct.includes("png") ? "png" : ct.includes("gif") ? "gif" : ct.includes("webp") ? "webp" : "jpg";
          const localName = "img-" + h + "." + ext;
          await fsLib.writeFile(path.join(imgsDir, localName), buf);
          const dataUri = "data:" + ct + ";base64," + buf.toString("base64");
          urlMap.set(url, { localName, dataUri });
        } catch (e) {}
      })());
    }
  }
  await Promise.all(tasks);
  return urlMap;
}

// 重写图片 src：useDataUri=true → 用 data URI；否则用 imgs/ 下的相对路径
function resolveImgSrc(html, urlMap, baseUrl, useDataUri) {
  return html.replace(/<img\b([^>]*?)\s+(?:data-src|data-original|src)=["']([^"']+)["']/gi, (full, lead, url) => {
    if (url.startsWith("data:")) return full;
    const entry = urlMap.get(url);
    if (!entry) return full;
    if (useDataUri && entry.dataUri) return "<img" + lead + " src=\"" + entry.dataUri + "\" data-original=\"" + url + "\"";
    if (!useDataUri && entry.localName) return "<img" + lead + " src=\"imgs/" + entry.localName + "\" data-original=\"" + url + "\"";
    return full;
  });
}

function buildHtmlDocument(o) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const escAttr = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const safeTitle = esc(o.title);
  const safeUrl = escAttr(o.sourceUrl);
  const meta = [];
  if (o.author) meta.push('<div class="dl-meta">' + esc(o.author) + '</div>');
  if (o.publishTime) meta.push('<div class="dl-meta">' + esc(o.publishTime) + '</div>');
  return [
    "<!DOCTYPE html>",
    "<html lang=\"zh-CN\"><head>",
    "<meta charset=\"utf-8\">",
    "<title>" + safeTitle + "</title>",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<style>",
    "body{font-family:'Noto Serif SC',Georgia,'Songti SC',serif;font-size:17px;line-height:1.8;color:#1A1A1A;background:#FDFBF7;margin:0;padding:0;}",
    ".doc{max-width:760px;margin:0 auto;padding:48px 40px 56px;}",
    ".crumbs{border-bottom:1px solid #E0E0E0;padding-bottom:14px;margin-bottom:22px;font-size:13px;color:#4A4A4A;letter-spacing:.15em;}",
    ".crumbs a{color:inherit;text-decoration:none;border-bottom:1px solid transparent;}",
    ".crumbs a:hover{border-bottom-color:#1A1A1A;}",
    "h1.title{font-weight:900;font-size:32px;line-height:1.3;text-wrap:balance;margin:0 0 16px;color:#1A1A1A;}",
    ".meta-line{font-size:14px;color:#4A4A4A;margin:4px 0;letter-spacing:.05em;}",
    ".divider{display:flex;align-items:center;gap:14px;color:#9a9a9a;font-size:13px;letter-spacing:.3em;margin:32px 0;}",
    ".divider::before,.divider::after{content:\"\";flex:1;border-top:1px dashed #E0E0E0;}",
    ".article-content img{max-width:100% !important;height:auto !important;display:block;margin:18px auto;border:1px solid #E0E0E0;}",
    ".article-content p{margin:14px 8px;}",
    ".article-content h1,.article-content h2,.article-content h3{font-weight:900;margin:22px 0 8px;}",
    ".article-content blockquote{margin:14px 0;padding:10px 16px;border-left:3px solid #1A1A1A;background:#F5F5F5;}",
    ".article-content pre{background:#F5F5F5;border:1px solid #E0E0E0;padding:12px;overflow:auto;font-size:14px;}",
    "footer.feet{margin-top:48px;border-top:1px solid #E0E0E0;padding-top:14px;font-size:13px;color:#9a9a9a;display:flex;justify-content:space-between;}",
    "</style>",
    "<style>" + (o.styles || "") + "</style>",
    "</head><body><div class=\"doc\">",
    "<div class=\"crumbs\"><span>本地存档</span> · <a href=\"" + safeUrl + "\" target=\"_blank\">原文</a></div>",
    "<h1 class=\"title\">" + safeTitle + "</h1>",
    meta.join(""),
    "<div class=\"divider\">— 正文 —</div>",
    "<div class=\"article-content\">" + o.html + "</div>",
"<footer class=\"feet\"><span><b>免费公众号下载器</b> · <span style=\"opacity:.7;\">通过本机浏览器直接归档</span></span><a href=\"https://supermortal.cn\" target=\"_blank\" rel=\"noopener\">supermortal.cn</a></footer>",
    "</div></body></html>"
  ].join("");
}

function htmlToMarkdown(html, urlMap) {
  const _decode = s => s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, String.fromCharCode(34)).replace(/&#39;/g, String.fromCharCode(39));
  function stripTags(s, joiner) { return s.replace(/<[^>]+>/g, joiner || ""); }
  function blockquoteMd(c) { return "\n" + stripTags(c, "\n").trim().split("\n").filter(Boolean).map(l => "> " + l.trim()).join("\n") + "\n"; }
  function listMd(c, ordered) {
    const items = (c.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || []).map(li => stripTags(li, " ").trim().replace(/<[^>]+>/g, ""));
    if (!items.length) return "";
    return "\n" + items.map((s, i) => (ordered ? (i + 1) + "." : "-") + " " + s).join("\n") + "\n";
  }
  function tableMd(c) {
    const rows = c.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const data = rows.map(tr => (tr.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map(td => stripTags(td, " ").trim().replace(/\|/g, "\\|").replace(/\n/g, " ")));
    if (data.length < 1) return "";
    const out = ["\n"];
    out.push("| " + data[0].join(" | ") + " |");
    out.push("| " + data[0].map(() => "---").join(" | ") + " |");
    for (const r of data.slice(1)) out.push("| " + r.join(" | ") + " |");
    return out.join("\n") + "\n";
  }
  let t = html;
  t = t.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  t = t.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  t = t.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  t = t.replace(/<script_window_[\s\S]*?<\/script_window_>/gi, "");
  t = t.replace(/<video\b[\s\S]*?<\/video>/gi, "");
  t = t.replace(/<audio\b[\s\S]*?<\/audio>/gi, "");
  t = t.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, c) => tableMd(c));
  // 图片：split 时用 imgs/ 本地路径，否则保留远程
  const imgMap = new Map();
  let _n = 0;
  t = t.replace(/<img\b[^>]*?\b(?:data-src|data-original|src)=["']([^"']+)["'][^>]*>/gi, (full, url) => {
    if (url.startsWith("data:")) return "";
    const key = "[[IMG_" + (_n++) + "]]";
    imgMap.set(key, url);
    return "\n" + key + "\n";
  });
  t = t.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => blockquoteMd(c));
  t = t.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => "\n\`\`\`\n" + stripTags(c, "\n").trim() + "\n\`\`\`\n");
  t = t.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => "\`" + stripTags(c).trim() + "\`");
  t = t.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_, c) => listMd(c, false));
  t = t.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, c) => listMd(c, true));
  t = t.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => "\n# " + stripTags(c).trim() + "\n");
  t = t.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => "\n## " + stripTags(c).trim() + "\n");
  t = t.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => "\n### " + stripTags(c).trim() + "\n");
  t = t.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => "\n#### " + stripTags(c).trim() + "\n");
  t = t.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => "\n" + stripTags(c, " ").trim() + "\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => "**" + stripTags(c, " ").trim() + "**");
  t = t.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => "*" + stripTags(c, " ").trim() + "*");
  t = t.replace(/<a\b[^>]*?\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, c) => {
    const label = stripTags(c, " ").trim();
    return label ? "[" + label + "](" + href + ")" : href;
  });
  t = t.replace(/<\/?(section|div|span|article|aside|main|nav|footer)\b[^>]*>/gi, "");
  // 还原图片：split 时走本地 imgs/，否则原 URL
  t = t.replace(/\[\[IMG_(\d+)\]\]/g, (full, n) => {
    const key = "[[IMG_" + n + "]]";
    const url = imgMap.get(key);
    if (!url) return "";
    if (urlMap && urlMap.has(url) && urlMap.get(url).localName) {
      return "\n![](" + "imgs/" + urlMap.get(url).localName + ")\n";
    }
    return "\n![](" + url + ")\n";
  });
  t = t.replace(/<[^>]+>/g, "");
  t = _decode(t);
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim() + "\n";
}

// ===== 主入口 =====
// formats: array of "html", "md", "pdf"
// split: boolean。true=分文件模式（image 到 imgs/、HTML/MD 相对引用、产物 zip 打包）；
//              false=合并模式（image 内嵌 data URI、产物立刻 ready）。
export async function downloadArticle({ url, formats, split, browser }) {
  formats = formats || ["html"];
  outDir = outDir || ".";
  outPrefix = outPrefix || "article";
  const ownBrowser = !browser;
  const br = browser || await openBrowser();
  try {
    const page = await openPage(br);
    await navigateAndWait(page, url, "#js_content", 1500);
    const info = await readArticleDOM(page);
    if (!info.jcHtml) throw new Error("正文区域不存在（可能文章已删除或链接无效）");
    const styles = await extractStyles(page);
    await fsLib.mkdir(outDir, { recursive: true });

    const imgsDir = path.join(outDir, outPrefix + "-imgs");
    await fsLib.mkdir(imgsDir, { recursive: true });
    const urlMap = await downloadAllImages(info.jcHtml, info.currentUrl, imgsDir);
    const totalImg = urlMap.size;
    const imagesDownloaded = [...urlMap.values()].filter(v => v.localName).length;
    const savedAt = new Date().toLocaleString("zh-CN");
    const baseOpts = { title: info.title, author: info.author, publishTime: info.pubTime, styles, sourceUrl: info.currentUrl, savedAt };
    const outputs = [];

    // HTML
    if (formats.includes("html")) {
      const htmlProcessed = resolveImgSrc(info.jcHtml, urlMap, info.currentUrl, !split);
      const fullHtml = buildHtmlDocument(Object.assign({}, baseOpts, { html: htmlProcessed }));
      const fname = split ? outPrefix + ".html" : outPrefix + "-single.html";
      const p = path.join(outDir, fname);
      await fsLib.writeFile(p, fullHtml, "utf8");
      outputs.push({ format: "html", filename: fname, path: p });
    }

    // 把 imgs/ 目录也作为一个整体挂到返回值里
    if (split) {
      const imgsList = await fsLib.readdir(imgsDir);
      outputs.push({ format: "_imgs", dir: imgsDir, files: imgsList.map(f => path.join(imgsDir, f)) });
    }

    // Markdown
    if (formats.includes("md")) {
      const mdBody = [
        "---",
        "title: " + info.title,
        "author: " + info.author,
        "publishTime: " + info.pubTime,
        "source: " + info.currentUrl,
        "split: " + (split ? "yes（使用本地 imgs/）" : "no（远程图片）"),
        "---",
        "",
        "# " + info.title,
        "",
        info.author ? "> 作者：" + info.author : "",
        info.publishTime ? "> 发布于：" + info.pubTime : "",
        "",
        htmlToMarkdown(info.jcHtml, split ? urlMap : null)
      ].filter(Boolean).join("\n");
      const p = path.join(outDir, outPrefix + ".md");
      await fsLib.writeFile(p, mdBody, "utf8");
      outputs.push({ format: "md", filename: outPrefix + ".md", path: p });
    }

    // PDF：对"我们自己生成的 HTML"做 page.pdf，比直接拉 mp.weixin.qq.com 的全页面快很多
    if (formats.includes("pdf")) {
      const htmlProcessed = resolveImgSrc(info.jcHtml, urlMap, info.currentUrl, !split);
      const fullHtml = buildHtmlDocument(Object.assign({}, baseOpts, { html: htmlProcessed }));
      const pdfBuf = await pdfFromHtmlBuffer(br, fullHtml, {});
      const p = path.join(outDir, outPrefix + ".pdf");
      await fsLib.writeFile(p, pdfBuf);
      outputs.push({ format: "pdf", filename: outPrefix + ".pdf", path: p });
    }

    return {
      ok: true,
      url,  // 原始 URL，便于生成可识别的 zip 文件名
      title: info.title, author: info.author, publishTime: info.pubTime,
      imagesDownloaded, imagesTotal: totalImg,
      split: !!split,
      outputs
    };
  } finally {
    if (ownBrowser) await dispose(br);
  }
}
