'use strict';

// 零依赖语法检查脚本：对扩展/后端/测试的所有 JS 文件执行 node --check，
// 并对 manifest.json / rules.json 做 JSON.parse 校验。
// 运行：node scripts/check.js
// 全部通过打印 'All checks passed.' 并退出 0；任一失败打印失败项并退出 1。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = path.join(__dirname, '..');

// 需要 --check 的 JS 文件（相对项目根目录）
const JS_FILES = [
  'shared.js',
  'content.js',
  'background.js',
  'popup.js',
  'options.js',
  'server.js',
  'cloudflare-worker.js',
  'scripts/check.js',
  'scripts/build-zip.js',
  'tests/shared.test.js',
];

// 需要 JSON.parse 校验的文件
const JSON_FILES = [
  'manifest.json',
  'rules.json'
];

const LOCALES_DIR = path.join(BASE, '_locales');
if (fs.existsSync(LOCALES_DIR)) {
  for (const loc of fs.readdirSync(LOCALES_DIR)) {
    const locFile = path.join('_locales', loc, 'messages.json');
    if (fs.existsSync(path.join(BASE, locFile))) {
      JSON_FILES.push(locFile);
    }
  }
}

let failed = false;

function fail(msg) {
  failed = true;
  console.error('[FAIL] ' + msg);
}

// cloudflare-worker.js 是 ESM（含 export default），直接 --check 会按 CJS 解析而失败：
// 拷贝到临时 .mjs 文件再检查，结束后删除。
function checkEsmFile(absPath, label) {
  const tmp = path.join(os.tmpdir(), `cf-worker-check-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mjs`);
  try {
    fs.writeFileSync(tmp, fs.readFileSync(absPath));
    const res = spawnSync(process.execPath, ['--check', tmp], { stdio: 'inherit' });
    if (res.status === 0) {
      console.log('OK ' + label + ' (ESM via temp .mjs)');
    } else {
      fail('syntax error in ' + label + ' (node --check exit ' + res.status + ')');
    }
  } catch (err) {
    fail('could not check ' + label + ': ' + err.message);
  } finally {
    try { fs.unlinkSync(tmp); } catch (err) { /* 临时文件已删除或不存在 */ }
  }
}

// 1) JS 语法检查
for (const rel of JS_FILES) {
  const abs = path.join(BASE, rel);
  if (!fs.existsSync(abs)) {
    fail('missing file: ' + rel);
    continue;
  }
  if (rel === 'cloudflare-worker.js') {
    checkEsmFile(abs, rel);
    continue;
  }
  // 注意：不要用 stdio:'pipe' 捕获子进程输出（沙箱环境会报 EPERM），一律 'inherit'
  const res = spawnSync(process.execPath, ['--check', abs], { stdio: 'inherit' });
  if (res.status === 0) {
    console.log('OK ' + rel);
  } else {
    fail('syntax error in ' + rel + ' (node --check exit ' + res.status + ')');
  }
}

// 2) JSON 校验
for (const rel of JSON_FILES) {
  const abs = path.join(BASE, rel);
  try {
    JSON.parse(fs.readFileSync(abs, 'utf8'));
    console.log('OK ' + rel + ' (valid JSON)');
  } catch (err) {
    fail('invalid JSON in ' + rel + ': ' + err.message);
  }
}

if (failed) {
  console.error('Check failed.');
  process.exit(1);
}

console.log('All checks passed.');
process.exit(0);
