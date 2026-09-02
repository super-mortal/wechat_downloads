// zip-store.mjs
// 一个不依赖任何第三方包的最小 ZIP (store-only) 拼装器。
// 用法：
//   const buf = makeZip([{ name: "a.html", content: "<html>..." }, { name: "imgs/x.png", content: buffer }]);
//
// 不支持加密、不支持压缩、不支持长文件名超过 65535 字节、不支持分卷。
// 我们的所有产出文件都不踩这些限制。

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = makeCrcTable();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosTime(d) {
  return ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
}

export function makeZip(entries) {
  // entries: [{ name: string, content: Buffer | string, time?: Date }]
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = new Date();
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const data = Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content, "utf8");
    const crc = crc32(data);
    const t = e.time || now;
    const tm = dosTime(t);
    const dt = dosDate(t);

    // 本地文件头（30 字节 + 名字 + 数据）
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);     // signature
    local.writeUInt16LE(20, 4);             // version
    local.writeUInt16LE(0, 6);              // flags
    local.writeUInt16LE(0, 8);              // method = 0 (STORE)
    local.writeUInt16LE(tm, 10);
    local.writeUInt16LE(dt, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);   // compressed
    local.writeUInt32LE(data.length, 22);   // uncompressed
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);             // extra
    const localBytes = Buffer.concat([local, nameBuf, data]);
    localParts.push(localBytes);

    // 中央目录条目（46 字节 + 名字）
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);   // version made by
    central.writeUInt16LE(20, 6);   // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(tm, 12);
    central.writeUInt16LE(dt, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);    // extra
    central.writeUInt16LE(0, 32);    // comment
    central.writeUInt16LE(0, 34);    // disk number
    central.writeUInt16LE(0, 36);    // internal attrs
    central.writeUInt32LE(0, 38);    // external attrs
    central.writeUInt32LE(offset, 42);
    const centralBytes = Buffer.concat([central, nameBuf]);
    centralParts.push(centralBytes);

    offset += localBytes.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                              // disk
  eocd.writeUInt16LE(0, 6);                              // disk where central dir starts
  eocd.writeUInt16LE(centralParts.length, 8);             // entries on this disk
  eocd.writeUInt16LE(centralParts.length, 10);            // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);              // central dir size
  eocd.writeUInt32LE(centralStart, 16);                  // central dir offset
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}
