'use strict';

/**
 * build-zip.js — 一键打包 Chrome Web Store 规范 ZIP（零依赖、跨平台）
 *
 * 运行：node scripts/build-zip.js  （或 npm run build）
 * 流程：
 *   1. 先跑 scripts/check.js 语法/JSON 校验，失败即中止
 *   2. 只打包扩展客户端文件（排除后端、测试、脚本、宣传物料）
 *   3. 输出 AI_Ad_Purifier_v<manifest版本>.zip（旧 zip 保留不覆盖）
 *
 * 说明：Node 没有内置 zip 容器 API，这里用 zlib.deflateRawSync + 手写
 * ZIP 本地文件头/中央目录/CRC32，实现零依赖打包，Windows/macOS/Linux 通用。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const BASE = path.join(__dirname, '..');

// 商店 ZIP 必须只包含这些扩展客户端文件
const FILES = [
  'manifest.json',
  'shared.js',
  'content.js',
  'background.js',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js',
  'styles.css',
  'rules.json'
];
const DIRS = ['icons', '_locales'];

// ---------- mini ZIP writer ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  // entries: [{ name, data: Buffer }]
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const comp = zlib.deflateRawSync(e.data, { level: 9 });
    const method = comp.length < e.data.length ? 8 : 0;
    const data = method === 8 ? comp : e.data;
    const size = e.data.length;
    const csize = data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // flags: UTF-8 filename
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(csize, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(Buffer.concat([local, nameBuf, data]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);      // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(csize, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const cd = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cd, eocd]);
}

// ---------- 收集文件 ----------

function collectEntries() {
  const entries = [];
  for (const rel of FILES) {
    const abs = path.join(BASE, rel);
    if (!fs.existsSync(abs)) {
      console.error('[build] missing required file: ' + rel);
      process.exit(1);
    }
    entries.push({ name: rel.replace(/\\/g, '/'), data: fs.readFileSync(abs) });
  }

  function walk(currentRel) {
    const absDir = path.join(BASE, currentRel);
    if (!fs.existsSync(absDir)) return;
    for (const item of fs.readdirSync(absDir)) {
      const itemRel = path.join(currentRel, item);
      const itemAbs = path.join(BASE, itemRel);
      const stat = fs.statSync(itemAbs);
      if (stat.isDirectory()) {
        walk(itemRel);
      } else {
        entries.push({ name: itemRel.replace(/\\/g, '/'), data: fs.readFileSync(itemAbs) });
      }
    }
  }

  for (const dir of DIRS) {
    walk(dir);
  }
  return entries;
}

// ---------- 主流程 ----------

console.log('[build] 步骤 1/2: 运行语法与 JSON 校验 (node scripts/check.js)...');
const check = spawnSync(process.execPath, [path.join(BASE, 'scripts', 'check.js')], {
  stdio: 'inherit'
});
if (check.status !== 0) {
  console.error('[build] 校验未通过，中止打包。');
  process.exit(1);
}

console.log('[build] 步骤 2/2: 打包扩展客户端文件...');
const manifest = JSON.parse(fs.readFileSync(path.join(BASE, 'manifest.json'), 'utf8'));
const version = manifest.version || '0.0.0';
const outName = `AI_Ad_Purifier_v${version}.zip`;
const outPath = path.join(BASE, outName);

const entries = collectEntries();
const zipData = makeZip(entries);
fs.writeFileSync(outPath, zipData);

console.log(`[build] 完成: ${outName} (${entries.length} 个文件, ${(zipData.length / 1024).toFixed(1)} KB)`);
console.log('[build] 包含文件: ' + entries.map((e) => e.name).join(', '));
