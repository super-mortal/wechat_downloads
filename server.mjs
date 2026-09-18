// server.mjs - 本地 HTTP 服务
//   * OFF + 单条 URL：后端返 JSON 清单，前端 fetch().blob() 逐个触发原生下载
//   * OFF + batch / ON + 任意：后端流式返 application/zip

import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { statSync, readFileSync } from "node:fs";
import { downloadArticle } from "./article.mjs";
import { openBrowser, dispose } from "./engine.mjs";
import { makeZip } from "./zip.mjs";
import { recordPublicBaseUrl } from "./domain.mjs";
import * as admin from "./admin.mjs";
import * as storage from "./storage.mjs";
import { start as startBot, Bot } from "weixin-agent-sdk";
import { agent } from "./agent.mjs";

const PORT = 3915;

var VIEWS_DIR = path.join(process.cwd(), "views");
function loadView(name) {
  return readFileSync(path.join(VIEWS_DIR, name), "utf8");
}

function domainMiddleware(req, res, next) {
  try { recordPublicBaseUrl(req); } catch (_) { /* cache miss is non-fatal */ }
  if (typeof next === "function") next();
}

function safeName(u) {
  return (u.match(/[A-Za-z0-9_-]{12,}/) || ["archive"])[0].slice(0, 14);
}

function renderHome() {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>免费公众号下载器</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27><rect width=%2764%27 height=%2764%27 fill=%27%23FDFBF7%27 stroke=%27%231A1A1A%27 stroke-width=%274%27/><text x=%2732%27 y=%2746%27 text-anchor=%27middle%27 font-family=%27serif%27 font-weight=%27900%27 font-size=%2740%27 fill=%27%231A1A1A%27>免</text></svg>">
<style>
:root{--paper:#FDFBF7;--paper-deep:#F5F5F5;--ink:#1A1A1A;--pencil:#4A4A4A;--soft:#9a9a9a;--border:#E0E0E0;--hl:#FFFF00;
  --reading:"Noto Serif SC",Georgia,"Songti SC",serif;--motion:none;}
*,*::before,*::after{box-sizing:border-box;transition:none !important;animation:none !important;}
html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);font-family:var(--reading);font-size:17px;line-height:1.8;}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.5;
  background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27140%27 height=%27140%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%272%27/%3E%3CfeColorMatrix values=%270 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0%27/%3E%3C/filter%3E%3Crect width=%27140%27 height=%27140%27 filter=%27url(%23n)%27/%3E%3C/svg%3E");}
a{color:inherit;text-decoration:none;border-bottom:1px solid transparent;}
a:hover{border-bottom-color:var(--ink);}
.wrap{max-width:920px;margin:0 auto;padding:0 24px;position:relative;z-index:1;}
header{border-bottom:1px solid var(--ink);background:var(--paper);padding:24px 0;}
.hd-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:18px;}
.brand{font-weight:900;font-size:22px;letter-spacing:.05em;}
.brand .mark{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:2px solid var(--ink);border-radius:4px;font-weight:900;font-size:20px;background:var(--paper);color:var(--ink);vertical-align:middle;margin-right:10px;font-family:"Noto Serif SC",Georgia,"Songti SC",serif;line-height:1;}
.hd-links{display:flex;gap:10px;flex-wrap:wrap;}
.blog-link{font-size:13px;color:var(--pencil);letter-spacing:.15em;border:1px solid var(--ink);padding:6px 14px;border-radius:3px;text-decoration:none;}
.blog-link:hover{background:var(--ink);color:var(--paper);}
.eyebrow{display:inline-block;font-size:13px;letter-spacing:.4em;color:var(--pencil);border:1px solid var(--border);padding:6px 14px;border-radius:3px;margin:54px 0 22px;}
h1{font-weight:900;font-size:clamp(36px,6vw,58px);line-height:1.3;text-wrap:balance;margin:0 0 18px;color:var(--ink);}
h1 mark{background:var(--hl);color:var(--ink);padding:0 .15em;}
.lead{margin:0 0 30px;max-width:560px;color:var(--pencil);font-size:18px;line-height:1.75;}
.formgrid{display:grid;gap:18px;margin-bottom:18px;}
.fieldlabel{font-size:13px;letter-spacing:.3em;color:var(--pencil);text-transform:uppercase;}
textarea{width:100%;font:15px/1.7 ui-monospace,Consolas,monospace;border:1px solid var(--ink);border-radius:3px;padding:14px 16px;background:var(--paper);color:var(--ink);outline:none;resize:vertical;min-height:120px;}
textarea:focus{border-color:var(--ink);box-shadow:0 0 0 2px var(--hl);}
.toggle{display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid var(--ink);border-radius:3px;background:var(--paper);cursor:pointer;}
.toggle.on{background:var(--ink);color:var(--paper);}
.toggle .dot{width:14px;height:14px;border:1.5px solid currentColor;border-radius:50%;position:relative;}
.toggle.on .dot{background:var(--paper);}
.toggle b{font-size:15px;letter-spacing:.05em;}
.toggle .sub{flex:1;font-size:13px;color:var(--pencil);line-height:1.5;}
.toggle.on .sub{color:var(--paper);opacity:.7;}
.chips{display:flex;flex-wrap:wrap;gap:14px;}
.chip{user-select:none;cursor:pointer;display:inline-flex;align-items:center;gap:8px;padding:10px 16px;font:600 14px/1 var(--reading);border:1px solid var(--ink);border-radius:3px;background:var(--paper);color:var(--ink);}
.chip input{appearance:none;width:14px;height:14px;border:1.5px solid var(--ink);border-radius:2px;background:var(--paper);display:inline-block;position:relative;margin:0;}
.chip input:checked{background:var(--ink);}
.chip input:checked::after{content:"\u2713";color:var(--paper);position:absolute;top:-5px;left:2px;font:bold 14px/1 sans-serif;}
.chip:has(input:checked){background:var(--ink);color:var(--paper);}
.actions{display:flex;align-items:center;gap:18px;margin:18px 0 28px;flex-wrap:wrap;}
.btn{display:inline-flex;align-items:center;gap:10px;font:600 15px/1 var(--reading);padding:14px 24px;border:1px solid var(--ink);border-radius:3px;background:var(--ink);color:var(--paper);cursor:pointer;text-decoration:none;white-space:nowrap;flex-shrink:0;}
.btn:hover{background:var(--paper);color:var(--ink);}
.btn[disabled]{background:var(--paper-deep);border-color:var(--border);color:var(--soft);cursor:not-allowed;}
.btn .spin{display:none;width:14px;height:14px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .9s linear infinite;}
.btn[disabled] .spin{display:inline-block;}
@keyframes spin {from {transform: rotate(0);} to {transform: rotate(360deg);}}
.hint{margin:0;padding:14px 18px;border:1px dashed var(--border);border-radius:3px;background:var(--paper-deep);font-size:14px;color:var(--pencil);line-height:1.7;max-width:520px;flex-shrink:1;}
.status{position:relative;padding:12px 40px 12px 16px;border:1px solid var(--ink);border-radius:3px;font-size:13.5px;line-height:1.65;margin-top:18px;background:var(--paper);white-space:pre-wrap;word-break:break-all;display:none;max-height:260px;overflow:auto;}
.status .x{position:absolute;top:6px;right:8px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid var(--ink);border-radius:2px;font-size:14px;line-height:1;background:var(--paper);color:var(--ink);}
.status .x:hover{background:var(--ink);color:var(--paper);}
.status .log{max-height:140px;overflow:auto;border-top:1px dashed var(--border);margin-top:8px;padding-top:8px;font:12px/1.5 ui-monospace,Consolas,monospace;color:var(--pencil);}
.status.show{display:block;}
.status.ok{border-color:var(--ink);}
.status.err{background:#FFFBE6;border-color:var(--ink);color:var(--ink);}
.footer-grid{margin-top:96px;padding:48px 0 56px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:80px;align-items:start;}
@media(max-width:640px){.footer-grid{flex-direction:column;gap:36px;}}
.footer-grid h4{font-size:13px;letter-spacing:.3em;color:var(--pencil);font-weight:600;text-transform:uppercase;margin:0 0 14px;}
.footer-grid p{margin:6px 0;font-size:14px;color:var(--ink);}
.footer-grid p.title{font-weight:600;margin:0 0 4px;}
.footer-grid a{border-bottom:1px solid var(--border);padding-bottom:1px;}
.footer-grid a:hover{border-bottom-color:var(--ink);}
.footer-grid .small{font-size:13px;color:var(--pencil);line-height:1.7;}
code{font-family:ui-monospace,Consolas,monospace;font-size:14px;background:var(--paper-deep);padding:2px 6px;border-radius:3px;color:var(--ink);}
</style></head><body>
<header><div class="wrap hd-row">
  <div class="brand"><span class="mark">免</span>免费公众号下载器</div>
  <div class="hd-links">
    <a class="blog-link" href="https://github.com/super-mortal/wechat_downloads" target="_blank" rel="noopener">GitHub</a>
    <a class="blog-link" href="https://supermortal.cn" target="_blank" rel="noopener">博客 → supermortal.cn</a>
  </div>
</div></header>
<main class="wrap">
  <span class="eyebrow">免登录 · 免 Cookie · 本地浏览器直读</span>
  <h1>把微信公众号里看到的好文章，<br><mark>一键留到本机</mark>。</h1>
  <p class="lead">贴链接、勾格式，点下载。HTML / Markdown / PDF 可单选也可以同时要；图片默认以内嵌方式进 HTML，勾上"分文件"则把图片和文章一起打成 zip。无需账号、不会有广告。</p>
  <div class="formgrid">
    <div><div class="fieldlabel" style="margin-bottom:8px;">文章链接</div>
      <textarea id="urls" placeholder="https://...（一行一条，批量可以一次粘贴多行）"></textarea></div>
    <div><div class="fieldlabel" style="margin-bottom:8px;">存放方式</div>
      <div class="toggle" id="splitToggle" role="switch" aria-checked="false" tabindex="0">
        <div class="dot" aria-hidden="true"></div>
        <div><b id="splitTitle">合并为单文件</b><div class="sub" id="splitSub">默认：所选格式各自独立下载（HTML 单文件 / MD / PDF 都无 zip）。</div></div>
      </div></div>
    <div><div class="fieldlabel" style="margin-bottom:8px;">输出格式 · 可多选</div>
      <div class="chips">
        <label class="chip"><input type="checkbox" name="fmt" value="html" checked>HTML</label>
        <label class="chip"><input type="checkbox" name="fmt" value="md" checked>Markdown</label>
        <label class="chip"><input type="checkbox" name="fmt" value="pdf" checked>PDF</label>
      </div></div>
  </div>
  <div class="actions">
    <button type="button" class="btn" id="saveBtn"><span class="spin"></span><span class="label">下载</span></button>
    <span class="hint">提交后浏览器会直接开始下载。文件夹：每篇一个目录，下含 imgs/ 子目录。所有产物会被打包进一个 .zip。</span>
  </div>
  <div class="status" id="status"></div>
</main>
<footer>
  <div class="wrap footer-grid">
    <div>
      <h4>项目</h4>
      <p class="title">免费公众号下载器</p>
      <p class="small">一个用本机浏览器直接读公众号文章、导出 HTML / Markdown / PDF 的小工具。<br>零账号、零订阅、零云端记录。</p>
    </div>
    <div>
      <h4>作者与支持</h4>
      <p><a href="https://supermortal.cn" target="_blank" rel="noopener">博客：supermortal.cn</a></p>
      <p><a href="https://ifdian.net/a/supermortal" target="_blank" rel="noopener">爱发电：supermortal</a></p>
      <p class="small"><a href="https://qm.qq.com/q/vZUveTbAuk" target="_blank" rel="noopener">功能改进 / bug 反馈 欢迎留言</a></p>
    </div>
  </div>
</footer>
<script>
var split = false;
var tg = document.getElementById("splitToggle");
var tgTitle = document.getElementById("splitTitle");
var tgSub = document.getElementById("splitSub");
function syncToggle() {
  tg.classList.toggle("on", split);
  tg.setAttribute("aria-checked", split ? "true" : "false");
  if (split) { tgTitle.textContent = "分文件 + 打 zip"; tgSub.textContent = "开启：HTML / MD 用 imgs/ 相对路径引图；所有产物 + imgs/ 一起打进一个 .zip。批量时每篇一个子目录。"; }
  else { tgTitle.textContent = "合并为单文件"; tgSub.textContent = "默认：所选格式各自独立下载（HTML 单文件 / MD / PDF 都无 zip）。"; }
}
tg.addEventListener("click", function(){ split = !split; syncToggle(); });
tg.addEventListener("keydown", function(e){ if (e.key === " " || e.key === "Enter") { e.preventDefault(); split = !split; syncToggle(); } });
syncToggle();
var btn = document.getElementById("saveBtn");
var status = document.getElementById("status");
function showStatus(t, kind, autoMs) {
  if (kind === "ok") return; // 成功一律不弹框
  status.className = "status show " + (kind || "");
  status.innerHTML = '<button class="x" type="button" aria-label="关闭">×</button>' + t;
  status.querySelector(".x").onclick = clearStatus;
  if (status._t) clearTimeout(status._t);
  status._t = setTimeout(clearStatus, autoMs || 10000);
}
function clearStatus() { status.className = "status"; status.textContent = ""; }
function triggerDownload(blob, name) {
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1500);
}
btn.addEventListener("click", async function() {
  var urls = (document.getElementById("urls").value || "").split(/\\u005Cr\\u005Cn|\\u000d\\u000a|\\r|\\n/).map(function(s){return s.trim();}).filter(Boolean);
  var fmts = Array.from(document.querySelectorAll(".chip input:checked")).map(function(x){return x.value;});
  if (!urls.length) { showStatus("请先粘一条链接进来。", "err"); return; }
  if (!fmts.length) { showStatus("至少勾选一种格式。", "err"); return; }
  btn.disabled = true; btn.querySelector(".label").textContent = split ? "打包中…" : "下载中…";
  clearStatus();
  try {
    var res = await fetch("/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: urls, formats: fmts, split: split }) });
    var ct = (res.headers.get("content-type") || "").split(";")[0];
    if (!res.ok) {
      var txt = await res.text();
      showStatus("服务报错 " + res.status + "\\n" + txt, "err");
      return;
    }
    var dispo = res.headers.get("content-disposition") || "";
    var fnM = /filename="([^"]+)"/.exec(dispo);
    if (ct === "application/zip") {
      btn.querySelector(".label").textContent = "正在流式下载…";
      var blob = await res.blob();
      var name = fnM ? decodeURIComponent(fnM[1]) : "bundle.zip";
      triggerDownload(blob, name);
      // zip 成功：showStatus("...", "ok") 在函数里被吞，不弹框
    } else if (ct === "application/json") {
      var info = await res.json();
      if (info.error) {
        showStatus("请求被服务拒绝：" + info.error, "err");
        return;
      }
      var batches = Array.isArray(info.items) && info.items.length
        ? info.items
        : (info.files ? [{ name: (info.files[0] && info.files[0].article) || "article", files: info.files }] : []);
      if (!batches.length) { showStatus("响应里没有可下载的文件。", "err"); return; }
      var total = batches.reduce(function(s, b){return s + b.files.length;}, 0);
      var done = 0;
      var okCount = 0, failCount = 0;
      for (var bi = 0; bi < batches.length; bi++) {
        var bch = batches[bi];
        for (var i = 0; i < bch.files.length; i++) {
          var f = bch.files[i];
          done++;
          btn.querySelector(".label").textContent = "下载中 " + done + "/" + total;
          try {
            var fr = await fetch(f.url);
            if (!fr.ok) throw new Error("HTTP " + fr.status);
            var b = await fr.blob();
            triggerDownload(b, f.name);
            okCount++;
          } catch (e) { failCount++; }
          await new Promise(function(r){setTimeout(r, 250);});
        }
      }
      btn.querySelector(".label").textContent = "下载完成";
      if (failCount) showStatus(okCount + " 个文件完成，" + failCount + " 个失败。", "err", 8000);
    } else {
      var t2 = await res.text();
      showStatus("下载失败：响应类型异常 " + ct + "\\n" + t2.substring(0, 200), "err");
    }
  }
  catch (e) {
    showStatus("下载失败：" + e.message, "err");
  }
  finally {
    btn.disabled = false; btn.querySelector(".label").textContent = "下载";
  }
});
</script>
</body></html>`;
}

async function readBody(req) {
  return new Promise(function(resolve, reject){
    var chunks = [];
    req.on("data", function(c){chunks.push(c);});
    req.on("end", function(){resolve(Buffer.concat(chunks));});
    req.on("error", reject);
  });
}

function basename(p) {
  return path.basename(p);
}

// 内存中的待下载文件池 + 过期清理
var pendingFiles = new Map(); // id -> { name, mime, buffer, born }
var PENDING_TTL_MS = 5 * 60 * 1000;
var PENDING_MAX = 200;
function _gcPending() {
  var now = Date.now();
  for (var id of pendingFiles.keys()) {
    var e = pendingFiles.get(id);
    if (now - e.born > PENDING_TTL_MS) pendingFiles.delete(id);
  }
  while (pendingFiles.size > PENDING_MAX) {
    var firstKey = pendingFiles.keys().next().value;
    pendingFiles.delete(firstKey);
  }
}
function _newId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function listInMemoryOutputs(okResults) {
  // 把每篇文章的每个产出挂到 pendingFiles，返回一个干净的文件描述列表
  _gcPending();
  var mimeMap = {".html":"text/html; charset=utf-8",".md":"text/markdown; charset=utf-8",".pdf":"application/pdf"};
  var items = [];
  for (var i = 0; i < okResults.length; i++) {
    var r = okResults[i];
    var files = [];
    for (var j = 0; j < r.outputs.length; j++) {
      var o = r.outputs[j];
      if (o.format === "_imgs") continue;
      var ext = path.extname(o.filename).toLowerCase();
      var buf = Buffer.isBuffer(o.content) ? o.content : Buffer.from(o.content, "utf8");
      var id = _newId();
      pendingFiles.set(id, { name: o.filename, mime: mimeMap[ext] || "application/octet-stream", buffer: buf, born: Date.now() });
      files.push({
        id: id,
        name: o.filename,
        size: buf.length,
        mime: mimeMap[ext] || "application/octet-stream",
        url: "/dl/" + id
      });
    }
    items.push({ article: r.title || ("article-" + (i + 1)), files: files });
  }
  return items;
}

async function buildZip(okResults) {
  var stamp = new Date();
  var entries = [];
  for (var i = 0; i < okResults.length; i++) {
    var r = okResults[i];
    var folder = safeName(r.url || "article");
    for (var j = 0; j < r.outputs.length; j++) {
      var o = r.outputs[j];
      if (o.format === "_imgs") {
        for (var k = 0; k < o.files.length; k++) {
          var f = o.files[k];
          var buf = await fs.readFile(f);
          entries.push({ name: folder + "/imgs/" + basename(f), content: buf, time: stamp });
        }
        continue;
      }
      var buf2 = await fs.readFile(o.path);
      entries.push({ name: folder + "/" + basename(o.path), content: buf2, time: stamp });
    }
  }
  return entries;
}


function htmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 错误响应（WXD-HTTP-0002：单篇 slug HTML 不存在；WXD-HTTP-0003：URL 路径解码失败）
var HTTP_ERROR_META = {
  "WXD-HTTP-0002": { http: 404, message: "/wechat/download/<slug>.html 文件不存在" },
  "WXD-HTTP-0003": { http: 400, message: "URL 路径解码失败" },
};
function sendHttpError(res, code, stage) {
  var meta = HTTP_ERROR_META[code] || { http: 500, message: "internal error" };
  res.writeHead(meta.http, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({
    error_code: code,
    message: meta.message,
    stage: stage,
    request_id: "n/a",
  }));
}

// 读取 public/wechat/download/index.json（mirrorIndexToPublic 产物）
function readPublicIndex() {
  var fp = path.join(process.cwd(), "public", "wechat", "download", "index.json");
  try {
    var raw = readFileSync(fp, "utf8");
    var text = String(raw || "").trim();
    if (!text) return [];
    var parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    return [];
  }
}

// 渲染 /wechat/download 列表页 HTML
function renderListHtml(entries) {
  var tpl = loadView("list.html");
  var body;
  if (!entries.length) {
    body = '<div class="empty"><b>暂无收录</b>还没有收录文章，发 <code style="font-family:ui-monospace,Consolas,monospace;">mp.weixin.qq.com/s/...</code> 链接到机器人即可</div>';
  } else {
    var rows = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var slug = htmlEscape(e.slug || "");
      var title = htmlEscape(e.title || "(无标题)");
      var author = htmlEscape(e.author || "未知作者");
      var createdAt = htmlEscape(e.created_at || "");
      rows.push(
        '<div class="entry">' +
          '<span class="t"><a href="/wechat/download/' + slug + '.html">' + title + '</a></span>' +
          '<span class="meta">' + author + '<span class="sep">·</span>' + createdAt + '</span>' +
        '</div>'
      );
    }
    body = '<div class="list">' + rows.join("") + '</div>';
  }
  return tpl.replace("<!--__LIST_PLACEHOLDER__-->", body).replace("<!--__COUNT__-->", String(entries.length));
}

var server = http.createServer(async function(req, res) {
  try {
    domainMiddleware(req, res);
    var u = new URL(req.url, "http://127.0.0.1:" + PORT);
    if (u.pathname === "/" || u.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderHome());
      return;
    }
    if (u.pathname === "/download" && req.method === "POST") {
      var body = await readBody(req);
      var payload;
      try { payload = JSON.parse(body.toString("utf8")); } catch (e) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("invalid json");
        return;
      }
      var urls = Array.isArray(payload.urls) ? payload.urls : [];
      var fmts = Array.isArray(payload.formats) ? payload.formats : [];
      var split = !!payload.split;
      if (!urls.length || !fmts.length) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("missing urls or formats");
        return;
      }
      if (!split && urls.length > 5) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "分文件 OFF 时单次最多 5 条链接，请勾选「分文件 + 打 zip」后重试。" }));
        return;
      }
      var results = [];
      var br = await openBrowser();
      try {
        for (var i = 0; i < urls.length; i++) {
          var u2 = urls[i];
          try {
            var prefix = safeName(u2) + "-" + Date.now();
            var r = await downloadArticle({ url: u2, formats: fmts, split, browser: br });
            results.push(r);
          } catch (e) {
            results.push({ ok: false, url: u2, error: e.message });
          }
        }
      } finally { await dispose(br); }

      var ok = results.filter(function(r){return r.ok;});
      var fail = results.filter(function(r){return !r.ok;});
      if (!ok.length) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("全部失败：" + fail.map(function(f){return f.url + " -> " + f.error;}).join("\\n"));
        return;
      }
      // OFF 单条 → JSON：1 组 file 列表
      // OFF 多条 → JSON：多组 files-per-article，前端按 article 依次拉
      var d = new Date();
      var pad = function(n){return n < 10 ? "0" + n : "" + n;};
      var dayStamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      // ON 任意 → 整个 zip 流
      if (!split) {
        var items = [];
        for (var i = 0; i < ok.length; i++) {
          var r = ok[i];
          var fms = (listInMemoryOutputs([r]))[0].files;
          for (var j = 0; j < fms.length; j++) { fms[j].article = r.title || ("article-" + (i + 1)); }
          items.push({ article: r.title || ("article-" + (i + 1)), files: fms });
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ mode: split ? "zip" : "files", items: items, failures: fail.map(function(f){return {url:f.url,error:f.error};}) }));
        return;
      }
      var entries = await buildZip(ok);
      var zipBuf = makeZip(entries);
      if (fail.length) {
        var warnText = "以下链接抓取失败：\\n\\n" + fail.map(function(f){return f.url + " -> " + f.error;}).join("\\n");
        entries.push({ name: "WARN.txt", content: warnText });
        zipBuf = makeZip(entries);
      }
      var fileName = dayStamp + (urls.length > 1 ? ("-" + ok.length + "p") : "") + (fail.length ? "-含失败" : "") + ".zip";
      res.writeHead(200, {
        "content-type": "application/zip; charset=utf-8",
        "content-disposition": 'attachment; filename="' + encodeURIComponent(fileName) + '"',
        "content-length": zipBuf.length
      });
      res.end(zipBuf);
      return;
    }
    // /admin/* 管理面板 + 二维码（task4 / P3）
    if (u.pathname === "/admin" || u.pathname === "/admin/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(loadView("admin.html"));
      return;
    }
    if (u.pathname === "/admin/qr") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(loadView("admin-qr.html"));
      return;
    }
    if (u.pathname === "/admin/qr/start" && req.method === "POST") {
      try {
        var result = await admin.startQrSession();
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          qrcodeUrl: result.qrcodeUrl,
          sessionKey: result.sessionKey,
          requestId: result.requestId,
        }));
      } catch (err) {
        var code = (err && err.error_code) || "WXD-ADMIN-0002";
        var http = (err && err.http) || 500;
        res.writeHead(http, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(err && err.toJSON ? err.toJSON() : {
          error_code: code,
          message: (err && err.message) || String(err),
          stage: "admin.mjs#startQrSession",
          request_id: "n/a",
        }));
      }
      return;
    }
    if (u.pathname === "/admin/qr/status") {
      var sessionKey = u.searchParams.get("session") || "";
      try {
        var status = await admin.pollQrStatus(sessionKey);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: status }));
      } catch (err) {
        var code2 = (err && err.error_code) || "WXD-ADMIN-0001";
        var http2 = (err && err.http) || 500;
        res.writeHead(http2, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(err && err.toJSON ? err.toJSON() : {
          error_code: code2,
          message: (err && err.message) || String(err),
          stage: "admin.mjs#pollQrStatus",
          request_id: "n/a",
        }));
      }
      return;
    }
    // /wechat/download 系列路由（P6 / task7）
    //   * /wechat/download/index.json 必须在 <slug>.html 之前注册，否则会被当成 slug="index.json"
    if (u.pathname === "/wechat/download/index.json") {
      try {
        var publicIdx = readPublicIndex();
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(publicIdx));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error_code: "WXD-STORAGE-0001", message: e && e.message || String(e), stage: "server.mjs#/wechat/download/index.json" }));
      }
      return;
    }
    if (u.pathname.indexOf("/wechat/download/") === 0 && u.pathname.slice("/wechat/download/".length).length > 0) {
      var rest = u.pathname.slice("/wechat/download/".length);
      if (rest !== "index.json" && /\.html$/.test(rest) && !rest.includes("/")) {
        // 浏览器 / Invoke-WebRequest 客户端会把 slug 中的非 ASCII 字符按百分号编码发送；
        // new URL().pathname 不会自动 decode，因此必须显式 decodeURIComponent，否则中文 slug 会找不到文件。
        var slug;
        try {
          slug = decodeURIComponent(rest.slice(0, -5)); // 去掉 ".html" 再解码
        } catch (decodeErr) {
          sendHttpError(res, "WXD-HTTP-0003", "server.mjs#/wechat/download/<slug>.html");
          return;
        }
        var filePath = path.join(process.cwd(), "public", "wechat", "download", slug + ".html");
        try {
          var buf = readFileSync(filePath);
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-length": buf.length,
          });
          res.end(buf);
        } catch (e) {
          if (e && e.code === "ENOENT") {
            sendHttpError(res, "WXD-HTTP-0002", "server.mjs#/wechat/download/<slug>.html");
          } else {
            res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
            res.end("read error: " + (e && e.message));
          }
        }
        return;
      }
    }
    if (u.pathname === "/wechat/download" || u.pathname === "/wechat/download/") {
      try {
        // storage.readIndex 是 async；这里用同步读取 public mirror 更轻量
        var entries = readPublicIndex();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderListHtml(entries));
      } catch (e) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("list error: " + (e && e.message));
      }
      return;
    }
    if (u.pathname.indexOf("/dl/") === 0) {
      var pid = u.pathname.slice(4);
      var entry = pendingFiles.get(pid);
      if (!entry) { res.writeHead(404); res.end("Not found or expired"); return; }
      res.writeHead(200, {
        "content-type": entry.mime,
        "content-length": entry.buffer.length,
        "content-disposition": 'attachment; filename="' + encodeURIComponent(entry.name) + '"'
      });
      res.end(entry.buffer);
      pendingFiles.delete(pid); // 一次性，下载完即清
      return;
    }
    res.writeHead(404); res.end("Not found");
  } catch (e) {
    try { res.writeHead(500, { "content-type": "text/plain" }); res.end("Server error: " + e.message); } catch(_) {}
  }
});

server.listen(PORT, "127.0.0.1", function(){
  console.log("ready · http://127.0.0.1:" + PORT);
});

// 可选：WECHAT_BOT=1 时把 agent 接入 weixin-agent-sdk 长轮询（DEV_PLAN.md §10.3 / §A.2）
if (process.env.WECHAT_BOT === "1") {
  (async () => {
    const log = (msg) => console.log("[wechat-bot]", msg);
    try {
      // SDK 真实签名（weixin-agent-sdk@0.5.0 dist/index.d.mts）：
      //   start(agent: Agent, opts?: StartOptions): Bot
      //   StartOptions = { accountId?, abortSignal?, log?: (msg: string) => void }
      // start() 内部启动 monitor 后立即返回 Bot 实例；bot.wait() 才阻塞至 monitor 退出。
      // 本场景 HTTP 已保活进程，故不 await bot.wait()。
      const bot = await startBot(agent, { log });
      console.log("[wechat-bot] bot started", { type: typeof bot, isBot: bot instanceof Bot });
    } catch (err) {
      // 启动失败（未登录 / 二维码未扫 / 长轮询断开）：按 dev-spec.md WXD-NET-0002 登记
      console.error("[wechat-bot] start failed", {
        error_code: "WXD-NET-0002",
        message: (err && err.message) || String(err),
        stage: "server.mjs#WECHAT_BOT=1",
      });
      // 不退出进程；HTTP 仍可用
    }
  })().catch(err => console.error("[wechat-bot] uncaught", err));
}


