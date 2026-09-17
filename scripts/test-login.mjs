import { login } from "weixin-agent-sdk";

// Race login() against a 10s timeout.
// login() internally calls startWeixinLoginWithQr -> print QR via qrcode-terminal
// -> waitForWeixinLogin (long-poll up to 8min). We just need to confirm:
//   1. import 路径正确
//   2. SDK 内部能拿到 qrcodeUrl
//   3. 网络请求发出 / 收到 mock / 拿到 QR 字符串
// 真实扫码不在本测试范围内（需要用户微信）。

let capturedQr = null;
let capturedBase = null;
let loginStarted = false;

const log = (msg) => {
  const text = String(msg);
  process.stdout.write(`[sdk-log] ${text}\n`);
  const m = /二维码链接:\s*(\S+)/.exec(text);
  if (m) capturedQr = m[1];
  if (loginStarted) capturedBase = (capturedBase ?? "") + text;
};

const controller = new AbortController();
const hardExit = setTimeout(() => {
  process.stdout.write("[test-login] 10s hard timeout, force exit\n");
  // login() 内部不支持 abortSignal，只能强制退出进程结束它的长轮询
  process.exit(0);
}, 10_000);

try {
  loginStarted = true;
  // 不传 abortSignal；SDK 不支持；超时由 hardExit 兜底
  const accountId = await Promise.race([
    login({ log }).catch((err) => {
      process.stdout.write(`[test-login] login() rejected: ${err?.message ?? err}\n`);
      return null;
    }),
    new Promise((resolve) =>
      controller.signal.addEventListener("abort", () => resolve(null), { once: true })
    ),
    new Promise((resolve) => setTimeout(() => resolve(null), 9_000)),
  ]);

  process.stdout.write(
    `[test-login] finished race, accountId=${accountId ?? "<timeout>"}, capturedQrUrl=${capturedQr ? capturedQr.slice(0, 80) : "<none>"}\n`
  );
} catch (err) {
  process.stderr.write(`[test-login] unexpected error: ${err?.message ?? err}\n`);
} finally {
  clearTimeout(hardExit);
  controller.abort();
  process.exit(0);
}
