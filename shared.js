/**
 * shared.js — AI Ad Purifier 共享纯逻辑模块
 *
 * 不依赖任何 chrome.* / DOM API，可在 Node 中直接 require（用于单元测试）。
 * 通过 globalThis.CEE 暴露给所有扩展脚本：
 *   - content script / popup / options：在页面中用 <script src="shared.js"> 先加载
 *   - background service worker：importScripts('shared.js')
 *
 * 统一维护：选择器安全校验、规则库归一化与容量上限、域名归一化、HTML 转义、
 * 带超时的 fetch、激活码格式校验。
 */
(function (global) {
  'use strict';

  // 危险根节点黑名单：这些选择器绝不能用于整块隐藏
  var DANGEROUS_ROOTS = [
    'html', 'body', 'main', 'header', 'footer', 'nav', 'section', 'article',
    'div', 'span', 'p', 'a', 'img', 'svg', 'button', 'input', 'ul', 'ol', 'li',
    '.style-scope', '.ytd-app', 'ytd-app', 'ytd-page-manager', '#page-manager',
    '#content', '#app', '#root', '#main', '#body', '.container', '.wrapper',
    '.content', '.main', '.page', '.layout', '.view', '.app'
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
   *  - 黑名单只拦“精确匹配”的危险根选择器
   *  - 裸标签选择器（无 class/id/属性）只允许白名单内的广告自定义元素
   *  - 纯标签组合器（如 "div > div"、"body *"）直接拒绝，除非含 :has()
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
   * 域名归一化：小写 + 去除 www. 前缀，
   * 避免 www.example.com 与 example.com 各存一套规则。
   */
  function normalizeDomain(host) {
    if (!host) return '';
    return String(host).trim().toLowerCase().replace(/^www\./, '');
  }

  /** 生成规则 ID（默认前缀 rule_） */
  function makeRuleId(prefix) {
    return (prefix || 'rule_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isRule(r) {
    return !!r && typeof r === 'object' && typeof r.selector === 'string' && r.selector.trim().length > 0;
  }

  /**
   * 规则库归一化 + 容量控制（防存储无限膨胀）：
   *  - 域名归一化（自动合并 www. 与裸域）
   *  - 过滤非法规则、同域同选择器去重
   *  - 每域上限 maxPerDomain（默认 100，保留最新追加的）
   *  - 总条数上限 maxTotal（默认 3000）、域数量上限 maxDomains（默认 500）
   *  - 清空/超限的域自动移除；返回全新对象，不修改入参
   */
  function normalizeRules(rules, opts) {
    var maxDomains = (opts && opts.maxDomains) || 500;
    var maxPerDomain = (opts && opts.maxPerDomain) || 100;
    var maxTotal = (opts && opts.maxTotal) || 3000;
    var out = {};
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return out;

    var merged = {}; // 归一化域名 -> 合并后的规则数组（保持追加顺序）
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
        if (!isSafeSelector(sel)) continue; // 安全过滤：危险/非法选择器直接丢弃（自愈）
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
        // 保留最新追加的 maxPerDomain 条
        merged[doms[d]] = list.slice(list.length - maxPerDomain);
      }
      out[doms[d]] = merged[doms[d]];
    }

    // 总条数超限：按域内条数从少到多保留，尽量不让单一站点独占配额
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

  /** HTML 转义（防 XSS / 属性逃逸） */
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
   * 带超时的 fetch（浏览器与 Node 18+ 通用）。
   * 超时自动 abort，避免按钮/请求永久挂起。
   */
  function fetchWithTimeout(url, options, timeoutMs) {
    var ms = timeoutMs || 20000;
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
   * 激活码格式校验：兼容 Waffo 订单号（ORD_...）与旧版 CF Worker 生成的
   * PURIFIER-... 激活码。
   */
  function isPlausibleKey(code) {
    if (!code || typeof code !== 'string') return false;
    var c = code.trim().toUpperCase();
    if (!/^(ORD_|PURIFIER-)/.test(c)) return false;
    return c.length >= 6;
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
    isPlausibleKey: isPlausibleKey
  };

  global.CEE = CEE;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CEE;
  }
})(globalThis);
