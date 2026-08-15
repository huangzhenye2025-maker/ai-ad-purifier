// content.js - AI Ad Purifier 内容脚本
// 职责：注入 CSS 隐藏规则、本地广告扫描、AI DOM 快照、元素点选器、动态统计
(function () {
  'use strict';

  const CEE = globalThis.CEE;

  // 域名归一化（www. 与裸域共用一套规则）
  const domainRaw = window.location.hostname;
  const domain = CEE.normalizeDomain(domainRaw);
  const IS_TOP = window.top === window;

  // 内置标准广告拦截规则（开箱即用）
  const DEFAULT_AD_SELECTORS = [
    // Standard Ad Networks & Google AdSense / DoubleClick
    '.adsbygoogle',
    'iframe[src*="googleads"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[id*="google_ads_"]',
    '[id^="google_ads_"]',
    '[id*="google_ads_frame"]',
    'ins.adsbygoogle',
    'div[id^="div-gpt-ad"]',
    'div[class*="ad-container"]',
    'div[class*="ad-wrapper"]',
    'div[class*="ad-slot"]',
    'div[class*="ad-box"]',
    'div[class*="ad-unit"]',
    '.banner-ad',
    '.sidebar-ad',
    '.header-ad',
    '.footer-ad',
    '.native-ad',
    '[data-ad-client]',
    '[data-ad-slot]',
    // YouTube Ads & Promoted Items
    'ytd-ad-slot-renderer',
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-rich-item-renderer:has(ytd-display-ad-renderer)',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-display-ad-renderer',
    'ytd-statement-banner-renderer',
    'ytd-in-feed-ad-layout-renderer',
    '.ytp-ad-overlay-container',
    '.ytp-ad-message-container',
    // Sponsored & Popups
    '[class*="sponsored-post"]',
    '[class*="sponsored-content"]',
    '[id*="sponsored-banner"]',
    '.popup-ad-overlay',
    '.floating-ad-banner'
  ];

  let styleElement = null;
  let activeSelectors = []; // 当前生效的安全选择器
  let hiddenCount = 0;
  let picker = null;

  // ---------- 1. CSS 规则注入 ----------

  function injectSavedRules() {
    chrome.storage.local.get(['rules', 'globalEnabled', 'siteDisabled'], function (result) {
      const globalEnabled = result.globalEnabled !== false;
      const siteDisabled = (result.siteDisabled || {})[domain] === true;
      const enabled = globalEnabled && !siteDisabled;

      const allRules = result.rules || {};
      const domainRules = allRules[domain] || allRules[domainRaw] || [];

      let css = '';
      activeSelectors = [];
      if (enabled) {
        DEFAULT_AD_SELECTORS.forEach(function (sel) {
          if (CEE.isSafeSelector(sel)) {
            css += sel + ' { display: none !important; }\n';
            activeSelectors.push(sel);
          }
        });
        domainRules.forEach(function (rule) {
          if (rule.enabled !== false && CEE.isSafeSelector(rule.selector)) {
            css += rule.selector + ' { display: none !important; }\n';
            activeSelectors.push(rule.selector);
          }
        });
      }

      if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'cee-injected-styles';
        (document.head || document.documentElement).appendChild(styleElement);
      }
      styleElement.textContent = css;
      refreshStats(true);
    });
  }

  // ---------- 2. 统计（角标 + 弹窗展示） ----------

  function refreshStats(force) {
    if (!IS_TOP) return;
    const combined = activeSelectors.join(', ');
    let n = 0;
    if (combined) {
      try { n = document.querySelectorAll(combined).length; } catch (e) { n = 0; }
    }
    if (force || n !== hiddenCount) {
      hiddenCount = n;
      try {
        chrome.runtime.sendMessage({ type: 'ad-stats', count: n });
      } catch (e) { /* service worker 未就绪时忽略 */ }
    }
  }

  // MutationObserver：页面动态插入/移除广告时自动刷新统计
  let mo = null;
  let lastCountTs = 0;
  let statsPending = false;

  function scheduleStats() {
    if (statsPending) return;
    statsPending = true;
    setTimeout(function () {
      statsPending = false;
      const now = Date.now();
      if (now - lastCountTs < 2000) { // 冷却中则顺延，保证最终一定刷新
        scheduleStats();
        return;
      }
      lastCountTs = now;
      refreshStats(false);
    }, 600);
  }

  function startObserver() {
    if (mo || !document.body) return;
    mo = new MutationObserver(function () {
      scheduleStats();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- 3. 消息处理 ----------

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message !== 'object') return;

    if (message.action === 'get-simplified-dom') {
      if (!IS_TOP) return;
      try { sendResponse({ dom: getSimplifiedDOM() }); }
      catch (err) { sendResponse({ error: err.message }); }
      return;
    }

    if (message.action === 'scan-local-ads') {
      if (!IS_TOP) return;
      try { sendResponse({ selectors: scanLocalAds() }); }
      catch (err) { sendResponse({ error: err.message }); }
      return;
    }

    if (message.action === 'get-stats') {
      if (!IS_TOP) return;
      sendResponse({ count: hiddenCount });
      return;
    }

    if (message.action === 'activate-picker') {
      if (!IS_TOP) return;
      activatePicker(sendResponse); // 异步：点选完成后回调
      return true;
    }

    if (message.action === 'cancel-picker') {
      if (!IS_TOP) return;
      deactivatePicker();
      sendResponse({ ok: true });
      return;
    }
  });

  // ---------- 4. 本地智能扫描（免费版，零 API 调用） ----------

  const AD_KEYWORDS = [
    'banner-ad', 'sponsored', 'promoted', 'ad-container', 'ad-wrapper', 'ad-slot',
    'adbox', 'google-ad', 'sidebar-ad', 'native-ad', 'advert', 'adsbygoogle',
    'ad-banner', 'ad-unit', 'ad-placeholder', 'ad-wrap', 'ad-block', 'ad-item',
    'advertisement', 'advertise', 'ad-badge', 'popup-ad', 'popunder'
  ];

  function scanLocalAds() {
    const foundSelectors = new Set();

    // Strategy A: 内置默认广告规则中当前页面命中的部分
    DEFAULT_AD_SELECTORS.forEach(function (sel) {
      if (!CEE.isSafeSelector(sel)) return;
      try {
        if (document.querySelectorAll(sel).length > 0) foundSelectors.add(sel);
      } catch (e) { /* 忽略非法选择器 */ }
    });

    // Strategy B: 关键词启发式扫描（逐个 class/id，绝不整串多 class 盲取）
    const candidates = document.querySelectorAll('div, section, aside, iframe, ins');
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];

      if (el.id && typeof el.id === 'string' && el.id.length <= 100) {
        const idLower = el.id.toLowerCase();
        for (let k = 0; k < AD_KEYWORDS.length; k++) {
          if (idLower.indexOf(AD_KEYWORDS[k]) !== -1) {
            const sel = '#' + CSS.escape(el.id);
            if (CEE.isSafeSelector(sel)) foundSelectors.add(sel);
            break;
          }
        }
      }

      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/);
        for (let c = 0; c < classes.length; c++) {
          const cls = classes[c];
          if (!cls) continue;
          const clsLower = cls.toLowerCase();
          for (let k = 0; k < AD_KEYWORDS.length; k++) {
            if (clsLower.indexOf(AD_KEYWORDS[k]) !== -1) {
              const sel = '.' + CSS.escape(cls);
              if (CEE.isSafeSelector(sel)) foundSelectors.add(sel);
              break;
            }
          }
        }
      }
    }

    return Array.from(foundSelectors);
  }

  // ---------- 5. AI 用 DOM 快照（智能采样，控制 token 预算） ----------

  const MAX_NODES = 600;
  const SUSPICIOUS_RE = /(^|[-_:])(ad|ads|advert|advertis|sponsor|sponsored|promo|promoted|banner|popup|pop-under|popunder|doubleclick|googleads|adsbygoogle|native-ad|affiliate)([-_:]|$)/i;

  function looksSuspicious(el) {
    if (el.id && SUSPICIOUS_RE.test(el.id)) return true;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.split(/\s+/);
      for (let i = 0; i < classes.length; i++) {
        if (SUSPICIOUS_RE.test(classes[i])) return true;
      }
    }
    const label = el.getAttribute && el.getAttribute('aria-label');
    if (label && /(ad|sponsor|promo)/i.test(label)) return true;
    return false;
  }

  function getSimplifiedDOM() {
    let nodeCount = 0;
    const root = document.body;

    function cleanNode(node, depth, suspicious) {
      if (nodeCount > MAX_NODES || depth > 14) return null;

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (!text) return null;
        return text.substring(0, suspicious ? 120 : 30);
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return null;

      const tag = node.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'canvas', 'svg'].indexOf(tag) !== -1) return null;
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return null;

      // 跳过不可见元素，节省 token
      try {
        if (node !== root && node.getBoundingClientRect) {
          const r = node.getBoundingClientRect();
          if (r.width < 2 && r.height < 2) return null;
        }
      } catch (e) { /* 忽略 */ }

      nodeCount++;
      const isSus = suspicious || looksSuspicious(node);
      const obj = { tag: tag };
      if (node.id) obj.id = node.id.substring(0, 40);
      if (node.className && typeof node.className === 'string') {
        const classes = node.className.trim().split(/\s+/).slice(0, isSus ? 4 : 2);
        if (classes.length > 0) obj.class = classes.join(' ');
      }
      if (tag === 'iframe' && node.src) {
        obj.src = node.src.substring(0, isSus ? 120 : 60);
      }
      const label = node.getAttribute('aria-label');
      if (label) obj.label = label.substring(0, 40);

      const children = [];
      const maxKids = isSus ? 40 : 10;
      for (let i = 0; i < node.childNodes.length && children.length < maxKids; i++) {
        if (nodeCount > MAX_NODES) break;
        const c = cleanNode(node.childNodes[i], depth + 1, isSus);
        if (c) children.push(c);
      }
      if (children.length > 0) obj.children = children;
      return obj;
    }

    const cleaned = root ? cleanNode(root, 0, false) : null;
    return JSON.stringify(cleaned);
  }

  // ---------- 6. 元素点选器（拾取模式） ----------

  function pickTarget(node) {
    let el = node && node.nodeType === 1 ? node : (node && node.parentElement) || null;
    for (let i = 0; el && i < 6; i++) {
      if (el === document.body || el === document.documentElement) return null;
      if (el.id || (el.classList && el.classList.length > 0)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function selectorForElement(el) {
    if (el.id) {
      const id = String(el.id).trim();
      if (id.length > 0 && id.length <= 100 && /^[a-zA-Z_][\w\-.:]*$/.test(id)) {
        const sel = '#' + CSS.escape(id);
        if (CEE.isSafeSelector(sel)) return sel;
      }
    }
    const classes = Array.prototype.filter.call(el.classList || [], function (c) {
      return !/^cee-/.test(c);
    });
    if (classes.length > 0) {
      // 优先选广告关键词类；再退回前两个类
      const adCls = classes.filter(function (c) {
        const cl = c.toLowerCase();
        return AD_KEYWORDS.some(function (kw) { return cl.indexOf(kw) !== -1; });
      });
      const chosen = (adCls.length > 0 ? adCls : classes.slice(0, 2)).slice(0, 2);
      const sel = chosen.map(function (c) { return '.' + CSS.escape(c); }).join('');
      if (CEE.isSafeSelector(sel)) return sel;
    }
    return null;
  }

  function getI18n(key, fallback) {
    return (chrome.i18n && chrome.i18n.getMessage(key)) || fallback || '';
  }

  function flashHint(text) {
    const hint = document.getElementById('cee-picker-hint');
    if (!hint) return;
    hint.textContent = text;
    hint.style.background = '#dc2626';
    setTimeout(function () {
      if (picker) {
        hint.textContent = getI18n('pickerHint', 'Click on element to hide (Esc to cancel)');
        hint.style.background = '#0f172a';
      }
    }, 1200);
  }

  function activatePicker(done) {
    deactivatePicker(); // 若已有拾取会话，先结束（旧的 done 回调会被调用）

    picker = { done: done || null };

    const overlay = document.createElement('div');
    overlay.id = 'cee-picker-highlight';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:2px solid #6366f1;background:rgba(99,102,241,0.12);transition:width 60ms,height 60ms,top 60ms,left 60ms;';
    document.documentElement.appendChild(overlay);

    const hint = document.createElement('div');
    hint.id = 'cee-picker-hint';
    hint.textContent = getI18n('pickerHint', 'Click on element to hide (Esc to cancel)');
    hint.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;background:#0f172a;color:#fff;padding:8px 14px;border-radius:8px;font:12px/1.4 system-ui,sans-serif;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.35);';
    document.documentElement.appendChild(hint);

    document.documentElement.classList.add('cee-picker-active');

    const onMove = function (e) {
      if (!picker) return;
      const el = pickTarget(e.target);
      if (!el) { overlay.style.width = '0px'; overlay.style.height = '0px'; return; }
      const r = el.getBoundingClientRect();
      overlay.style.top = r.top + 'px';
      overlay.style.left = r.left + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    };

    const onClick = function (e) {
      if (!picker) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const el = pickTarget(e.target);
      if (!el) return;
      const sel = selectorForElement(el);
      if (!sel) {
        flashHint(getI18n('pickerNoSelector', 'No usable class/id for this element. Please select a smaller element.'));
        return;
      }
      addRuleAndHide(sel);
    };

    const onKey = function (e) {
      if (e.key === 'Escape') deactivatePicker();
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);

    picker._cleanup = function () {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      hint.remove();
      document.documentElement.classList.remove('cee-picker-active');
    };
  }

  function deactivatePicker() {
    if (!picker) return;
    if (picker._cleanup) picker._cleanup();
    const done = picker.done;
    picker = null;
    if (done) {
      try { done({ ok: true }); } catch (e) { /* 端口已关闭 */ }
    }
  }

  function addRuleAndHide(sel) {
    chrome.storage.local.get(['rules'], function (result) {
      const allRules = CEE.normalizeRules(result.rules || {});
      const list = allRules[domain] || [];
      if (!list.some(function (r) { return r.selector === sel; })) {
        list.push({
          id: CEE.makeRuleId(),
          name: getI18n('pickerRuleDefaultName', 'Picked Element'),
          selector: sel,
          enabled: true,
          date: new Date().toLocaleDateString(),
          ts: Date.now()
        });
        allRules[domain] = list;
        // 写入 storage 会触发 storage.onChanged -> injectSavedRules，CSS 立即生效
        chrome.storage.local.set({ rules: allRules }, function () {});
      }
      deactivatePicker();
    });
  }

  // ---------- 7. 启动 ----------

  injectSavedRules();

  function onReady() {
    injectSavedRules();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  // 规则/全局开关/站点白名单变化时即时更新，无需刷新页面
  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.rules || changes.globalEnabled || changes.siteDisabled) {
      injectSavedRules();
    }
  });
})();
