'use strict';

// 零依赖单元测试：仅使用 Node 内置 node:test / node:assert/strict / node:http。
// 运行：node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const CEE = require('../shared.js');

// ---------------------------------------------------------------------------
// CEE.isSafeSelector
// ---------------------------------------------------------------------------

test('isSafeSelector rejects dangerous selectors', () => {
  const rejected = [
    'body',
    '#root',
    '.container',
    'div',
    'a',
    'main',
    'html',
    'footer',
    '*',
    '* > div',
    'div > div',                 // 纯标签组合器，无 :has(
    'div > div:not(.x)',         // 无 :has 的纯组合（含结构伪类）
    'div > div > p',
    'body *',                    // 纯空格后代组合器
    'div !important',
    '.ad-banner !important',
    '',                          // 空串
    '   ',                       // 全空白
    'x'.repeat(301),             // 超过 300 字符
  ];
  for (const sel of rejected) {
    assert.equal(CEE.isSafeSelector(sel), false, `expected to reject: ${JSON.stringify(sel)}`);
  }
});

test('isSafeSelector rejects non-strings and non-whitelisted bare tags', () => {
  assert.equal(CEE.isSafeSelector(null), false);
  assert.equal(CEE.isSafeSelector(undefined), false);
  assert.equal(CEE.isSafeSelector(42), false);
  assert.equal(CEE.isSafeSelector({}), false);
  assert.equal(CEE.isSafeSelector('ytd-app'), false);          // 危险根
  assert.equal(CEE.isSafeSelector('.ytd-app'), false);         // 危险根
  assert.equal(CEE.isSafeSelector('#page-manager'), false);    // 危险根
  assert.equal(CEE.isSafeSelector('span'), false);             // 裸标签非白名单
  assert.equal(CEE.isSafeSelector('ytd-ad-slot-renderer2'), false); // 裸标签非白名单
});

test('isSafeSelector accepts targeted selectors', () => {
  const accepted = [
    'ytd-ad-slot-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-display-ad-renderer',
    'ytd-statement-banner-renderer',
    'ytd-in-feed-ad-layout-renderer',
    '.ad-banner',
    '#sponsor-banner',
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'div.ad-slot > ins.adsbygoogle',
    'div:has(> ytd-ad-slot-renderer)',
    'a[href^="https://ads.example.com"]',
  ];
  for (const sel of accepted) {
    assert.equal(CEE.isSafeSelector(sel), true, `expected to accept: ${JSON.stringify(sel)}`);
  }
});

// ---------------------------------------------------------------------------
// CEE.normalizeDomain
// ---------------------------------------------------------------------------

test('normalizeDomain lowercases and strips www prefix', () => {
  assert.equal(CEE.normalizeDomain('www.Example.COM'), 'example.com');
  assert.equal(CEE.normalizeDomain('example.com'), 'example.com');
  assert.equal(CEE.normalizeDomain(''), '');
  assert.equal(CEE.normalizeDomain('  WWW.FooBar.CN  '), 'foobar.cn');
  assert.equal(CEE.normalizeDomain(null), '');
});

// ---------------------------------------------------------------------------
// CEE.normalizeRules
// ---------------------------------------------------------------------------

test('normalizeRules merges www domains, dedups, drops invalid/unsafe entries, keeps input intact', () => {
  const input = {
    'www.example.com': [
      { selector: '.ad-a', id: 'a1', name: 'Alpha', enabled: true, date: '2024-01-01', ts: 10 },
      { selector: '.ad-a', id: 'a2' }, // 同 selector 重复 -> 丢弃
      { selector: 'body' },            // 危险选择器 -> 丢弃（安全过滤）
      { selector: '  ' },              // 空白 selector -> 丢弃
      { foo: 1 },                      // 无 selector -> 丢弃
      { selector: 42 },                // 非字符串 selector -> 丢弃
    ],
    'example.com': [
      { selector: '.ad-b', id: 'b1' },
      null,                            // 非对象 -> 丢弃
      { selector: '.ad-b', id: 'b2' }, // 同 selector 重复 -> 丢弃
    ],
    'OTHER.com': [{ selector: '.ad-c' }], // 域名归一化为小写
  };

  const before = JSON.parse(JSON.stringify(input));
  const out = CEE.normalizeRules(input);

  // 不修改入参（深比较）
  assert.deepEqual(input, before);

  assert.deepEqual(Object.keys(out).sort(), ['example.com', 'other.com']);
  assert.deepEqual(out['example.com'].map((r) => r.selector), ['.ad-a', '.ad-b']);
  assert.equal(out['example.com'][0].id, 'a1');
  assert.equal(out['example.com'][0].name, 'Alpha');
  assert.equal(out['example.com'][0].enabled, true);
  assert.equal(out['example.com'][0].date, '2024-01-01');
  assert.equal(out['example.com'][0].ts, 10);
  assert.deepEqual(out['other.com'].map((r) => r.selector), ['.ad-c']);
});

test('normalizeRules caps rules per domain, keeping most recently appended', () => {
  const out = CEE.normalizeRules({
    'a.com': [{ selector: '.a1' }, { selector: '.a2' }, { selector: '.a3' }],
  }, { maxPerDomain: 2 });
  assert.deepEqual(out['a.com'].map((r) => r.selector), ['.a2', '.a3']);
});

test('normalizeRules maxTotal keeps smaller domains first; maxDomains truncates domain count', () => {
  const rules = {
    'one.com': [{ selector: '.o1' }],
    'two.com': [{ selector: '.t1' }, { selector: '.t2' }],
    'three.com': [{ selector: '.h1' }, { selector: '.h2' }],
  };

  // maxTotal=3：one.com(1) + two.com(2) 恰好占满，three.com 被挤掉
  const totalCapped = CEE.normalizeRules(rules, { maxTotal: 3 });
  assert.deepEqual(Object.keys(totalCapped).sort(), ['one.com', 'two.com']);
  assert.equal(Object.values(totalCapped).reduce((s, a) => s + a.length, 0), 3);
  assert.deepEqual(totalCapped['one.com'].map((r) => r.selector), ['.o1']);
  assert.deepEqual(totalCapped['two.com'].map((r) => r.selector), ['.t1', '.t2']);

  // maxDomains=2：按域内条数从少到多只保留 2 个域
  const domCapped = CEE.normalizeRules(rules, { maxDomains: 2 });
  assert.deepEqual(Object.keys(domCapped).sort(), ['one.com', 'two.com']);
  assert.equal(Object.values(domCapped).reduce((s, a) => s + a.length, 0), 3);
});

test('normalizeRules with small opts (maxPerDomain:2, maxTotal:3, maxDomains:2) truncates correctly', () => {
  const out = CEE.normalizeRules({
    'aaa.com': [{ selector: '.a1' }, { selector: '.a2' }, { selector: '.a3' }],
    'bbb.com': [{ selector: '.b1' }, { selector: '.b2' }],
    'ccc.com': [{ selector: '.c1' }],
    'ddd.com': [{ selector: '.d1' }],
  }, { maxPerDomain: 2, maxTotal: 3, maxDomains: 2 });

  // 每域上限后：aaa=[.a2,.a3](2), bbb=[.b1,.b2](2), ccc=[.c1](1), ddd=[.d1](1)
  // 按条数从少到多排序（稳定）：ccc, ddd, aaa, bbb
  // maxDomains=2 只保留 ccc、ddd；1+1=2 <= maxTotal
  assert.deepEqual(Object.keys(out).sort(), ['ccc.com', 'ddd.com']);
  assert.deepEqual(out['ccc.com'].map((r) => r.selector), ['.c1']);
  assert.deepEqual(out['ddd.com'].map((r) => r.selector), ['.d1']);
  assert.equal(Object.values(out).reduce((s, a) => s + a.length, 0), 2);
});

test('normalizeRules returns empty object for invalid input', () => {
  assert.deepEqual(CEE.normalizeRules(null), {});
  assert.deepEqual(CEE.normalizeRules(undefined), {});
  assert.deepEqual(CEE.normalizeRules([]), {});
  assert.deepEqual(CEE.normalizeRules('x'), {});
  assert.deepEqual(CEE.normalizeRules({ '': [{ selector: '.x' }] }), {}); // 空域名丢弃
});

// ---------------------------------------------------------------------------
// CEE.escapeHtml
// ---------------------------------------------------------------------------

test('escapeHtml escapes all special characters', () => {
  assert.equal(CEE.escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#039;');
  assert.equal(CEE.escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('escapeHtml handles null/undefined as empty string', () => {
  assert.equal(CEE.escapeHtml(null), '');
  assert.equal(CEE.escapeHtml(undefined), '');
});

// ---------------------------------------------------------------------------
// CEE.isPlausibleKey
// ---------------------------------------------------------------------------

test('isPlausibleKey accepts ORD_ and PURIFIER- keys (prefix case-insensitive)', () => {
  assert.equal(CEE.isPlausibleKey('ORD_ABC123'), true);
  assert.equal(CEE.isPlausibleKey('purifier-xyz1'), true);
  assert.equal(CEE.isPlausibleKey(' ord_abc123 '), true);
  assert.equal(CEE.isPlausibleKey('PURIFIER-ABC'), true);
});

test('isPlausibleKey rejects bad keys', () => {
  assert.equal(CEE.isPlausibleKey('foo'), false);
  assert.equal(CEE.isPlausibleKey(''), false);
  assert.equal(CEE.isPlausibleKey('ORD_'), false); // 前缀对但长度 4 < 6
  assert.equal(CEE.isPlausibleKey('ABC123'), false);
  assert.equal(CEE.isPlausibleKey(null), false);
  assert.equal(CEE.isPlausibleKey(123), false);
});

// ---------------------------------------------------------------------------
// CEE.fetchWithTimeout
// ---------------------------------------------------------------------------

test('fetchWithTimeout rejects with AbortError when server never responds', async () => {
  const server = http.createServer(() => {
    // 永不响应，让请求挂起直到超时
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    await assert.rejects(
      CEE.fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 100),
      (err) => err && err.name === 'AbortError',
      'expected fetch to reject with AbortError'
    );
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
