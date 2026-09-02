// CLI 入口：node cli.mjs <url> [out-prefix] [formats] [split]
//   formats  逗号分隔，可选：html,md,pdf（默认 html,md,pdf）
//   split    on/off（默认 off：合并为单文件）
// 产物落到 ./out/<prefix>.html|mdf|pdf + （split=on 时）<prefix>-imgs/
import { downloadArticle } from "./article.mjs";
import fsLib from "node:fs/promises";
import path from "node:path";

const url = process.argv[2];
if (!url) { console.log("Usage: node cli.mjs <url> [out-prefix] [formats] [split]"); process.exit(1); }
const outPrefix = process.argv[3] || "article";
const outDir = path.join(process.cwd(), "out");
const formats = (process.argv[4] || "html,md,pdf").split(",").filter(Boolean);
const split = ((process.argv[5] || "off").toLowerCase() === "on");

console.log("URL     :", url);
console.log("PREFIX  :", outPrefix);
console.log("FORMATS :", formats.join(", "));
console.log("SPLIT   :", split ? "on（图片进 imgs/）" : "off（图片内嵌）");

await fsLib.mkdir(outDir, { recursive: true });
const res = await downloadArticle({ url, formats, split });
if (!res.ok) { console.error("失败：", res.error); process.exit(1); }

for (const o of res.outputs) {
  if (o.format === "_imgs") {
    const imgsDir = path.join(outDir, outPrefix + "-imgs");
    await fsLib.mkdir(imgsDir, { recursive: true });
    for (const it of o.items) {
      await fsLib.writeFile(path.join(imgsDir, it.name), it.content);
    }
    console.log("  imgs/  ", o.items.length, "张");
    continue;
  }
  const p = path.join(outDir, outPrefix + (split ? "" : "-single") + path.extname(o.filename));
  const data = Buffer.isBuffer(o.content) ? o.content : Buffer.from(o.content, "utf8");
  await fsLib.writeFile(p, data);
  console.log("  " + path.basename(p), "(" + (data.length / 1024).toFixed(0) + " KB)");
}

console.log("\nDone. →", outDir);
