/**
 * shared.js — AI Ad Purifier / AI 深度阅读与提纯助手 共享纯逻辑模块
 *
 * 不依赖任何 chrome.* / DOM API，可在 Node 中直接 require（用于单元测试）。
 * 通过 globalThis.CEE 暴露给所有扩展脚本：
 *   - content script / popup / options：在页面中用 <script src="shared.js"> 先加载
 *   - background service worker：importScripts('shared.js')
 *
 * 维护核心逻辑：
 * 1. 选择器安全校验（防误删 root / body / main 容器）
 * 2. 规则库归一化、容量控制与域名清洗
 * 3. Markdown 转换与 Frontmatter 元数据生成
 * 4. HTML 转义与安全清洗
 */
(function (global) {
  'use strict';

  // 危险根节点黑名单：这些选择器绝不能用于整块隐藏
  var DANGEROUS_ROOTS = [
    'html', 'body', 'main', 'header', 'footer', 'nav', 'section', 'article',
    'div', 'span', 'p', 'a', 'img', 'svg', 'button', 'input', 'ul', 'ol', 'li',
    '.style-scope', '.ytd-app', 'ytd-app', 'ytd-page-manager', '#page-manager',
    '#content', '#app', '#root', '#main', '#body', '.container', '.wrapper',
    '.content', '.main', '.page', '.layout', '.view', '.app',
    '#cee-reader-overlay', '#cee-reader-capsule', '#cee-picker-highlight'
  ];

  // 允许作为“裸标签”选择器（无 class/id/属性）使用的广告自定义元素
  var SAFE_AD_TAGS = [
    'ytd-ad-slot-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-display-ad-renderer',
    'ytd-statement-banner-renderer',
    'ytd-in-feed-ad-layout-renderer'
  ];

  var DANGEROUS_SET = {};
  DANGEROUS_ROOTS.forEach(function (s) { DANGEROUS_SET[s] = true; });
  var SAFE_TAG_SET = {};
  SAFE_AD_TAGS.forEach(function (s) { SAFE_TAG_SET[s] = true; });

  /**
   * 选择器安全校验：防止误把整页布局/容器隐藏。
   */
  function isSafeSelector(sel) {
    if (!sel || typeof sel !== 'string') return false;
    var s = sel.trim().toLowerCase();
    if (s.length < 2 || s.length > 300) return false;
    if (s.indexOf('!important') !== -1) return false;
    if (s === '*' || s.indexOf('*') === 0) return false;
    if (DANGEROUS_SET[s]) return false;

    // 裸标签：只允许白名单广告元素
    if (/^[a-z0-9-]+$/i.test(s)) {
      return !!SAFE_TAG_SET[s];
    }

    // 纯标签组合器（无任何 class/id/属性定位）拒绝，:has() 场景除外
    if (/^(?:[a-z][a-z0-9]*|\*)(?::[a-z-]+(?:\([^()]*\))?)*(?:(?:\s*[>+~]\s*|\s+)(?:[a-z][a-z0-9]*|\*)(?::[a-z-]+(?:\([^()]*\))?)*)+$/i.test(s) && s.indexOf(':has(') === -1) {
      return false;
    }

    return true;
  }

  /**
   * 域名归一化：小写 + 去除 www. 前缀
   */
  function normalizeDomain(host) {
    if (!host) return '';
    return String(host).trim().toLowerCase().replace(/^www\./, '');
  }

  /** 生成规则 ID */
  function makeRuleId(prefix) {
    return (prefix || 'rule_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isRule(r) {
    return !!r && typeof r === 'object' && typeof r.selector === 'string' && r.selector.trim().length > 0;
  }

  /**
   * 规则库归一化 + 容量控制
   */
  function normalizeRules(rules, opts) {
    var maxDomains = (opts && opts.maxDomains) || 500;
    var maxPerDomain = (opts && opts.maxPerDomain) || 100;
    var maxTotal = (opts && opts.maxTotal) || 3000;
    var out = {};
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return out;

    var merged = {};
    var keys = Object.keys(rules);
    for (var i = 0; i < keys.length; i++) {
      var dom = normalizeDomain(keys[i]);
      if (!dom) continue;
      var arr = rules[keys[i]];
      if (!Array.isArray(arr)) continue;
      var target = merged[dom];
      if (!target) { target = []; merged[dom] = target; }
      var seen = {};
      for (var j = 0; j < target.length; j++) { seen[target[j].selector] = true; }
      for (var k = 0; k < arr.length; k++) {
        var r = arr[k];
        if (!isRule(r)) continue;
        var sel = r.selector.trim();
        if (!isSafeSelector(sel)) continue;
        if (seen[sel]) continue;
        seen[sel] = true;
        target.push({
          id: (typeof r.id === 'string' && r.id) ? r.id : makeRuleId(),
          name: (typeof r.name === 'string' && r.name) ? r.name.slice(0, 120) : '规则',
          selector: sel,
          enabled: r.enabled !== false,
          date: (typeof r.date === 'string' && r.date) ? r.date : '',
          ts: (typeof r.ts === 'number') ? r.ts : 0
        });
      }
    }

    var doms = Object.keys(merged);
    for (var d = 0; d < doms.length; d++) {
      var list = merged[doms[d]];
      if (list.length === 0) continue;
      if (list.length > maxPerDomain) {
        merged[doms[d]] = list.slice(list.length - maxPerDomain);
      }
      out[doms[d]] = merged[doms[d]];
    }

    var entries = Object.keys(out).map(function (dom) { return [dom, out[dom].length]; });
    entries.sort(function (a, b) { return a[1] - b[1]; });
    var total = 0;
    var capped = {};
    for (var e = 0; e < entries.length && e < maxDomains; e++) {
      var take = Math.min(out[entries[e][0]].length, maxTotal - total);
      if (take <= 0) break;
      capped[entries[e][0]] = out[entries[e][0]].slice(0, take);
      total += take;
    }
    return capped;
  }

  /** HTML 安全转义 */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 带超时的 fetch
   */
  function fetchWithTimeout(url, options, timeoutMs) {
    var ms = timeoutMs || 25000;
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var opts = options || {};
    if (ctrl) {
      opts = Object.assign({}, opts, { signal: ctrl.signal });
      var timer = setTimeout(function () { ctrl.abort(); }, ms);
      return Promise.resolve(global.fetch(url, opts)).then(function (res) {
        clearTimeout(timer);
        return res;
      }, function (err) {
        clearTimeout(timer);
        throw err;
      });
    }
    return Promise.resolve(global.fetch(url, opts));
  }

  /**
   * 将提取的文章对象转换为带 YAML Frontmatter 的标准 Markdown
   * @param {Object} article { title, author, date, url, contentMarkdown, aiSummary }
   */
  function formatArticleToMarkdown(article) {
    var title = (article.title || 'Untitled Article').trim();
    var author = (article.author || '').trim();
    var date = (article.date || new Date().toISOString().split('T')[0]).trim();
    var url = (article.url || '').trim();
    var md = (article.contentMarkdown || article.text || '').trim();

    var frontmatter = [
      '---',
      'title: "' + title.replace(/"/g, '\\"') + '"',
      author ? 'author: "' + author.replace(/"/g, '\\"') + '"' : null,
      'date: ' + date,
      url ? 'source: "' + url + '"' : null,
      'purified_by: "AI Ad Purifier & Deep Reader"',
      '---',
      ''
    ].filter(function (line) { return line !== null; }).join('\n');

    var header = '# ' + title + '\n\n';
    if (author || date || url) {
      var meta = [];
      if (author) meta.push('**作者**: ' + author);
      if (date) meta.push('**日期**: ' + date);
      if (url) meta.push('**原文**: [' + title + '](' + url + ')');
      header += meta.join(' | ') + '\n\n---\n\n';
    }

    if (article.aiSummary) {
      header += '## 🧠 AI 核心提要\n\n' + article.aiSummary + '\n\n---\n\n';
    }

    return frontmatter + header + md;
  }

  var CEE = {
    isSafeSelector: isSafeSelector,
    DANGEROUS_ROOTS: DANGEROUS_ROOTS,
    SAFE_AD_TAGS: SAFE_AD_TAGS,
    normalizeDomain: normalizeDomain,
    normalizeRules: normalizeRules,
    makeRuleId: makeRuleId,
    escapeHtml: escapeHtml,
    fetchWithTimeout: fetchWithTimeout,
    formatArticleToMarkdown: formatArticleToMarkdown
  };

  global.CEE = CEE;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CEE;
  }
})(globalThis);
