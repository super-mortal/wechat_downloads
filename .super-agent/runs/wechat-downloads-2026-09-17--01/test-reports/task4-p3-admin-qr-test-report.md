# task4 / P3 / admin-qr 测试报告

测试环境: PowerShell 7.6.5 + Node 后端, 端口 3915
测试日期: 2026-09-17
执行人: tester 子智能体

## 第 1 次测试

### 判定：PASS

| # | 维度 | 位置 | 期望 | 实际 | 备注 |
|---|------|------|------|------|------|
| 1 | 文件存在 | admin.mjs / views/*.html / server.mjs | 4 个文件 | True/True/True/True | 全部存在 |
| 2 | admin 导出 | admin.mjs | startQrSession + pollQrStatus 等 ≥ 2 | 3 个导出 (startQrSession / pollQrStatus / getQrStatus) | 满足 |
| 3 | 路由注册 | server.mjs | 4 个路由 | 命中 5 行 (/admin, /admin/qr, /admin/qr/start POST, /admin/qr/status + import) | 满足 |
| 4 | HTTP /admin | node server | 200 HTML | 200, 长度 5531, 首行 <!doctype html> | 满足 |
| 5 | HTTP /admin/qr | node server | 200 HTML | 200, 长度 13651, 首行 <!doctype html> | 满足 |
| 6 | POST /admin/qr/start | node server | JSON 含 qrcodeUrl (https://) + sessionKey | 200, body: {"qrcodeUrl":"https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=<redacted>&bot_type=3","sessionKey":"<redacted>"","requestId":"90c539f5-e8ad-4ba2-ab29-9566b9d8eb13"} | qrcodeUrl 为 https://, sessionKey 存在 |
| 7 | GET status 404 | node server | 404 + WXD-ADMIN-0001 | 404, body: {"error_code":"WXD-ADMIN-0001","message":"/admin/qr/status 的 session 不存在 / 过期","stage":"admin.mjs#pollQrStatus","request_id":"b6443e52-66b1-4b17-b42f-bd54ff8ad16c","details":{}} | error_code 与 message 均正确 |
| 8 | 前端轮询 | admin-qr.html | fetch + setInterval + poll 命中 ≥ 2 | 命中 13 行, 关键词 fetch / setInterval / pollOnce / startPolling / stopPolling / pollTimer / POLL_INTERVAL_MS / WXD-NET-0002 等 | 满足 |
| 8b | 状态关键词 | admin-qr.html | wait / scanned / confirmed / expired | 命中 26 行, 包含 .status.wait/.scanned/.confirmed/.expired 四种状态 CSS、stageDots 切换、setStatus 文本 | 满足 |
| 9 | 纸墨风 CSS 变量 | admin-qr.html | :root --paper/--ink | 命中 21 行, 含 :root{--paper:#FDFBF7;--paper-deep:#F5F5F5;--ink:#1A1A1A;--pencil:...} | 满足 |

附加检查:
- 端口 3915 启动后可达 (Test-NetConnection Quiet = True)
- 进程关闭后端口释放 (Test-NetConnection Quiet = False)
- stderr 日志为空, 启动日志显示 eady · http://127.0.0.1:3915

## 证据

### A. 文件存在
`
Test-Path D:\github\wechat_downloads\admin.mjs             -> True
Test-Path D:\github\wechat_downloads\views\admin.html      -> True
Test-Path D:\github\wechat_downloads\views\admin-qr.html   -> True
Test-Path D:\github\wechat_downloads\server.mjs            -> True
`

### B. admin.mjs 导出
`
export async function startQrSession() {
export async function pollQrStatus(sessionKey) {
export async function getQrStatus(sessionKey) {
`

### C. server.mjs 路由
`
import * as admin from "./admin.mjs";
// /admin/* 管理面板 + 二维码（task4 / P3）
if (u.pathname === "/admin" || u.pathname === "/admin/") {
if (u.pathname === "/admin/qr") {
if (u.pathname === "/admin/qr/start" && req.method === "POST") {
if (u.pathname === "/admin/qr/status") {
`

### D. 启动日志 (server-test4.log 首行)
`
ready · http://127.0.0.1:3915
`
stderr (server-test4.err) 为空。

### E. HTTP 响应
- GET /admin -> 200, 5531 字节, 首行 <!doctype html>
- GET /admin/qr -> 200, 13651 字节, 首行 <!doctype html>
- POST /admin/qr/start -> 200, body 完整 (见 #6 行)
- GET /admin/qr/status?session=test-nonexistent -> 404, error_code=WXD-ADMIN-0001 (见 #7 行)

### F. admin-qr.html 关键片段
CSS 变量:
`
:root{--paper:#FDFBF7;--paper-deep:#F5F5F5;--ink:#1A1A1A;--pencil:#4A4A4A;--soft:#9a9a9a;--border:#E0E0E0;--hl:#FFFF00;--accent:#7A4A20;--err:#A93226;--ok:#1F6B3A;...
`
轮询:
`
var POLL_INTERVAL_MS = 2000;
pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
fetch("/admin/qr/status?session=" + encodeURIComponent(sessionKey), { method: "GET", cache: "no-store" })
fetch("/admin/qr/start", { method: "POST", cache: "no-store" })
`
状态机:
`
.status.wait / .status.scanned / .status.confirmed / .status.expired
stageDots[k].classList.toggle("on", k === name || (name === "scanned" && k === "wait") || (name === "expired" && k === "confirmed"));
`

### G. 收尾
- Get-Process node | Stop-Process -Force 成功
- 端口 3915 释放 (Test-NetConnection 返回 False, 提示 TCP connect to (127.0.0.1 : 3915) failed)

## 结论
所有 9 项验收点全部通过, 第 1 次测试 PASS, 无需进入修复循环。
