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

// ---------------------------------------------------------------------------
// CEE.computeAiQuota & CEE.formatArticleToMarkdown
// ---------------------------------------------------------------------------

test('computeAiQuota computes free daily quota and pro unlimited quota correctly', () => {
  const today = CEE.getTodayDateStr();

  // Free tier with 0 used
  const q0 = CEE.computeAiQuota(null, false);
  assert.equal(q0.isPro, false);
  assert.equal(q0.remaining, 3);
  assert.equal(q0.canUse, true);

  // Free tier with 2 used today
  const q2 = CEE.computeAiQuota({ date: today, count: 2 }, false);
  assert.equal(q2.remaining, 1);
  assert.equal(q2.canUse, true);

  // Free tier with 3 used today
  const q3 = CEE.computeAiQuota({ date: today, count: 3 }, false);
  assert.equal(q3.remaining, 0);
  assert.equal(q3.canUse, false);

  // Free tier yesterday quota resets today
  const qOld = CEE.computeAiQuota({ date: '2020-01-01', count: 3 }, false);
  assert.equal(qOld.remaining, 3);
  assert.equal(qOld.canUse, true);

  // Pro tier is unlimited
  const qPro = CEE.computeAiQuota({ date: today, count: 50 }, true);
  assert.equal(qPro.isPro, true);
  assert.equal(qPro.canUse, true);
});

test('formatArticleToMarkdown formats article with YAML frontmatter correctly', () => {
  const article = {
    title: 'Hello World',
    author: 'Alice',
    date: '2026-08-17',
    url: 'https://example.com/hello',
    contentMarkdown: 'This is paragraph 1.\n\n## Subheading\n\nContent here.',
    aiSummary: 'A brief summary of hello world.'
  };

  const md = CEE.formatArticleToMarkdown(article);
  assert.match(md, /---/);
  assert.match(md, /title: "Hello World"/);
  assert.match(md, /author: "Alice"/);
  assert.match(md, /source: "https:\/\/example\.com\/hello"/);
  assert.match(md, /## 🧠 AI 核心提要/);
  assert.match(md, /A brief summary of hello world\./);
  assert.match(md, /This is paragraph 1\./);
});

// ---------------------------------------------------------------------------
// CEE.escapeHtml & isPlausibleKey
// ---------------------------------------------------------------------------

test('escapeHtml escapes all special characters', () => {
  assert.equal(CEE.escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#039;');
  assert.equal(CEE.escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(CEE.escapeHtml(null), '');
});

test('isPlausibleKey accepts ORD_, PURIFIER-, PRO-, LIFETIME- keys', () => {
  assert.equal(CEE.isPlausibleKey('ORD_ABC123'), true);
  assert.equal(CEE.isPlausibleKey('purifier-xyz1'), true);
  assert.equal(CEE.isPlausibleKey('PRO-LIFETIME-01'), true);
  assert.equal(CEE.isPlausibleKey('LIFETIME-VIP'), true);
  assert.equal(CEE.isPlausibleKey('foo'), false);
  assert.equal(CEE.isPlausibleKey(''), false);
  assert.equal(CEE.isPlausibleKey(null), false);
});
