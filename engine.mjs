// engine.mjs - 浏览器引擎的本地适配层。
// 仅本文件 import 任何浏览器相关的第三方包；其它文件应仅 import 此处的具名 API。
// 暴露出来的 API:
//   openBrowser(opts)        -> Browser
//   openPage(browser, locale) -> Page
//   navigateAndWait(page, url, waitSelector, extraMs)
//   readArticleDOM(page)      -> { jcHtml, title, author, publishTime, currentUrl }
//   extractStyles(page)       -> string (head <style> 内容）
//   pdfFromHtmlBuffer(browser, html, opts) -> Buffer
//   dispose(browser)

import realEngine from "playwright";

const FASTER_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-software-rasterizer",
  "--disable-setuid-sandbox",
  "--disable-features=IsolateOrigins,site-per-process,Translate,BackForwardCache"
];

function precheckChromium() {
  try {
    const exe = realEngine.chromium.executablePath();
    if (!exe) return;
    require("node:fs").accessSync(exe);
  } catch (_) {
    const hint = "Chromium 不可执行：路径未找到。\n\n修复：执行 `npx playwright install chromium` 或重新跑 `npm install`（会自动触发 postinstall）。";
    const e = new Error(hint);
    e.error_code = "WXD-SYS-0001";
    e.stage = "engine.mjs#openBrowser";
    throw e;
  }
}

export async function openBrowser(opts) {
  opts = opts || {};
  precheckChromium();
  const headless = opts.headless !== false;
  // 强制走完整 chromium（ms-playwright\chromium-1234\chrome-win64\chrome.exe），
  // 而不是 chrome-headless-shell.exe；后者是 console 子系统 exe，在 Windows 上会弹控制台窗口。
  const browser = await realEngine.chromium.launch({
    headless: headless,
    channel: "chromium",
    args: (opts.args || FASTER_LAUNCH_ARGS).concat([])
  });
  return browser;
}

export async function openPage(browser, locale) {
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: locale || "zh-CN",
    viewport: { width: 1280, height: 800 }
  });
  return ctx.newPage();
}

export async function navigateAndWait(page, url, waitSelector, extraMs) {
  // 同时挂个超时保护，避免某次请求异常卡死
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  if (waitSelector) {
    try { await page.waitForSelector(waitSelector, { timeout: 20000 }); } catch (e) {}
  }
  await page.waitForTimeout(extraMs || 1500);
}

export async function readArticleDOM(page) {
  return await page.evaluate(() => {
    const jc = document.getElementById("js_content");
    const titleEl = document.querySelector("#activity-name");
    const metaTitle = document.querySelector("meta[property=\"og:title\"]")?.content
                  || document.querySelector("meta[name=description]")?.content
                  || document.title;
    return {
      jcHtml: jc ? jc.innerHTML : "",
      title: (titleEl ? titleEl.innerText : "").trim() || metaTitle.trim(),
      author: (document.querySelector("#js_name")?.innerText || document.querySelector("meta[name=\"author\"]")?.content || "").trim(),
      publishTime: (document.querySelector("#publish_time")?.innerText || document.querySelector("meta[property=\"article:published_time\"]")?.content || "").trim(),
      currentUrl: location.href
    };
  });
}

export async function extractStyles(page) {
  return await page.evaluate(() => {
    const styles = [];
    document.querySelectorAll("style").forEach(s => styles.push(s.textContent));
    return styles.join("\n\n");
  });
}

// PDF：把纯 HTML（不含视频/广告/外链 JS）放到 data URL 上渲染，远快于对原始 mp.weixin.qq.com 做 pdf
export async function pdfFromHtmlBuffer(browser, html, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 794, height: 1123 }
  });
  try {
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    // 等字体就绪（避免 Noto Serif SC 等网络字体还没下载完就出 PDF，导致中文渲染为 tofu）
    try {
      await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()));
    } catch (_) {}
    await page.waitForTimeout(500);
    return await page.pdf({
      format: opts.format || "A4",
      printBackground: opts.printBackground !== false,
      margin: opts.margin || { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" }
    });
  } finally {
    await ctx.close();
  }
}

export async function dispose(browser) {
  if (browser) try { await browser.close(); } catch (e) {}
}
