// content.js - AI Ad Purifier / AI 深度阅读与提纯助手 内容脚本
// 职责：
// 1. 🛡️ 智能破壁与反爬/弹窗解除引擎 (知乎/CSDN/Cookie/Newsletter/防复制解锁)
// 2. 📖 纯本地智能正文提取器 (Smart Article Extractor & Markdown 转换)
// 3. 🎨 沉浸式多主题阅读器 Overlay (明亮/暗黑/羊皮纸/墨水屏 + 目录 + 导出)
// 4. 🧠 AI 提纯卡片 (云端 DeepSeek + 极客 BYOK + 本地秒级智能 NLP 兜底提取)
// 5. ⚡ 本地与 CSS 规则拦截 + 元素点选器
(function () {
  'use strict';

  const CEE = globalThis.CEE || {};
  const IS_TOP = window.top === window;
  const domainRaw = window.location.hostname;
  const domain = CEE.normalizeDomain ? CEE.normalizeDomain(domainRaw) : domainRaw.toLowerCase().replace(/^www\./, '');

  // ---------- 1. 内置通用广告选择器 ----------
  const DEFAULT_AD_SELECTORS = [
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
    'ytd-ad-slot-renderer',
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-rich-item-renderer:has(ytd-display-ad-renderer)',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-display-ad-renderer',
    'ytd-statement-banner-renderer',
    'ytd-in-feed-ad-layout-renderer',
    '.ytp-ad-overlay-container',
    '.ytp-ad-message-container',
    '[class*="sponsored-post"]',
    '[class*="sponsored-content"]',
    '[id*="sponsored-banner"]',
    '.popup-ad-overlay',
    '.floating-ad-banner'
  ];

  let styleElement = null;
  let activeSelectors = [];
  let hiddenCount = 0;
  let picker = null;
  let readerOverlay = null;
  let capsuleEl = null;

  // ---------- 2. 🛡️ 智能破壁与反爬/遮罩清除引擎 (Gate Buster) ----------

  function runGateBuster() {
    let unblockedCount = 0;

    // 2.1 CSDN 专项深度破壁
    if (domain.indexOf('csdn.net') !== -1) {
      const hideBox = document.querySelector('.hide-article-box, #article_content .hide-article-box');
      if (hideBox) { hideBox.remove(); unblockedCount++; }

      const articleBox = document.getElementById('article_content') || document.querySelector('.article_content');
      if (articleBox) {
        articleBox.style.setProperty('height', 'auto', 'important');
        articleBox.style.setProperty('max-height', 'none', 'important');
        articleBox.style.setProperty('overflow', 'visible', 'important');
      }

      const csdnClutter = document.querySelectorAll(
        '.recommend-box, #rightAside, .programmer1Box, .blog_container_aside, .blog-footer-bottom, #recommendNps, .csdn-side-toolbar'
      );
      csdnClutter.forEach(el => { el.style.display = 'none'; unblockedCount++; });

      const codeBlocks = document.querySelectorAll('code, pre, .hljs');
      codeBlocks.forEach(el => {
        el.style.setProperty('user-select', 'text', 'important');
        el.style.setProperty('-webkit-user-select', 'text', 'important');
      });
      const copyBtns = document.querySelectorAll('.hljs-button[data-title*="复制"], .btn-copy');
      copyBtns.forEach(btn => {
        btn.removeAttribute('onclick');
        btn.setAttribute('data-title', '一键自由复制');
        btn.onclick = function (e) {
          e.stopPropagation();
          const pre = btn.closest('pre');
          if (pre) {
            const code = pre.querySelector('code') || pre;
            navigator.clipboard.writeText(code.innerText.trim()).then(() => {
              btn.setAttribute('data-title', '已复制 ✔');
              setTimeout(() => btn.setAttribute('data-title', '一键自由复制'), 1500);
            });
          }
        };
      });
    }

    // 2.2 知乎 专项深度破壁
    if (domain.indexOf('zhihu.com') !== -1) {
      const expandBtns = document.querySelectorAll('.ContentItem-expandButton, .RichContent-inner--collapsed + button');
      expandBtns.forEach(btn => {
        try { btn.click(); unblockedCount++; } catch (e) {}
      });

      const zhihuModals = document.querySelectorAll(
        '.Modal-wrapper:has(.signFlowModal), .signFlowModal, .OpenInAppButton, .AppBanner, .Modal-backdrop'
      );
      zhihuModals.forEach(m => { m.remove(); unblockedCount++; });

      const zhihuClutter = document.querySelectorAll('.Topstory-mainColumnAside, .GlobalSideBar, .Ad-Card, .Pc-feed-ad');
      zhihuClutter.forEach(el => { el.style.display = 'none'; unblockedCount++; });
    }

    // 2.3 简书 / 掘金 / 贴吧 / 百度等国内平台
    if (domain.indexOf('jianshu.com') !== -1 || domain.indexOf('juejin.cn') !== -1 || domain.indexOf('baidu.com') !== -1) {
      const showMoreBtns = document.querySelectorAll('.show-more, .collapse-free-content, .read-more-btn, .open-app-btn');
      showMoreBtns.forEach(btn => { try { btn.click(); unblockedCount++; } catch (e) {} });
      const collapseWrappers = document.querySelectorAll('.collapse-free-content, .article-content--collapsed');
      collapseWrappers.forEach(el => {
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('max-height', 'none', 'important');
      });
    }

    // 2.4 全球通用 Cookie / GDPR & Newsletter 强迫遮罩清除
    const cookieModals = document.querySelectorAll([
      '#onetrust-consent-sdk',
      '#onetrust-banner-sdk',
      '.cookie-banner',
      '.cookie-notice',
      '.qc-cmp2-container',
      '[class*="cookie-consent"]',
      '[id*="cookie-consent"]',
      '.newsletter-modal',
      '.mailchimp-popup',
      '.subscribe-modal-backdrop',
      '.tp-backdrop',
      '.tp-modal'
    ].join(', '));
    cookieModals.forEach(m => { m.remove(); unblockedCount++; });

    try {
      if (document.documentElement.style.overflow === 'hidden') {
        document.documentElement.style.setProperty('overflow', 'auto', 'important');
      }
      if (document.body && (document.body.style.overflow === 'hidden' || document.body.style.position === 'fixed')) {
        document.body.style.setProperty('overflow', 'auto', 'important');
        document.body.style.setProperty('position', 'static', 'important');
      }
    } catch (e) {}

    // 2.5 解除全局防复制
    try {
      const unselectable = document.querySelectorAll('[style*="user-select: none"], [style*="user-select:none"]');
      unselectable.forEach(el => {
        el.style.setProperty('user-select', 'text', 'important');
        el.style.setProperty('-webkit-user-select', 'text', 'important');
      });
      document.oncontextmenu = null;
      document.onselectstart = null;
      document.body && (document.body.oncopy = null);
    } catch (e) {}

    return unblockedCount;
  }

  // ---------- 3. CSS 规则注入 ----------

  function injectSavedRules() {
    chrome.storage.local.get(['rules', 'globalEnabled', 'siteDisabled', 'autoGateBuster'], function (result) {
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

      if (enabled && result.autoGateBuster !== false) {
        runGateBuster();
      }
    });
  }

  // ---------- 4. 统计与角标 ----------

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
      } catch (e) {}
    }
  }

  let mo = null;
  let statsPending = false;
  function scheduleStats() {
    if (statsPending) return;
    statsPending = true;
    setTimeout(function () {
      statsPending = false;
      refreshStats(false);
      runGateBuster();
    }, 800);
  }

  function startObserver() {
    if (mo || !document.body) return;
    mo = new MutationObserver(function () {
      scheduleStats();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- 5. 📖 纯本地智能正文提取算法 ----------

  function extractArticleContent() {
    const docTitle = document.title || '';
    let title = docTitle.split(/[-_|]/)[0].trim();
    const h1 = document.querySelector('h1');
    if (h1 && h1.innerText.trim().length > 4) {
      title = h1.innerText.trim();
    }

    let author = '';
    const authorMeta = document.querySelector('meta[name="author"], meta[property="article:author"]');
    if (authorMeta && authorMeta.content) {
      author = authorMeta.content.trim();
    } else {
      const authorEl = document.querySelector('.author, .byline, [rel="author"], .author-name, .user-name');
      if (authorEl) author = authorEl.innerText.trim().slice(0, 40);
    }

    let date = '';
    const dateMeta = document.querySelector('meta[property="article:published_time"], meta[name="pubdate"], meta[name="publishdate"]');
    if (dateMeta && dateMeta.content) {
      date = dateMeta.content.slice(0, 10);
    } else {
      const timeEl = document.querySelector('time, .publish-time, .post-time, .date');
      if (timeEl) date = (timeEl.getAttribute('datetime') || timeEl.innerText).trim().slice(0, 10);
    }
    if (!date) date = new Date().toISOString().split('T')[0];

    const CANDIDATES = [
      '#article_content',
      '.article_content',
      'article',
      '.post-content',
      '.entry-content',
      '.markdown-body',
      '.RichContent-inner',
      '.post-body',
      '.article-body',
      'main',
      '.main-content',
      '#main-content'
    ];

    let mainContainer = null;
    for (let i = 0; i < CANDIDATES.length; i++) {
      const el = document.querySelector(CANDIDATES[i]);
      if (el && el.innerText.trim().length > 150) {
        mainContainer = el;
        break;
      }
    }

    if (!mainContainer) {
      const blocks = document.querySelectorAll('div, section');
      let bestScore = 0;
      blocks.forEach(block => {
        if (block === document.body || block.children.length > 80) return;
        const pCount = block.querySelectorAll('p').length;
        const textLen = block.innerText.length;
        const score = pCount * 50 + textLen;
        if (score > bestScore && textLen > 200) {
          bestScore = score;
          mainContainer = block;
        }
      });
    }

    if (!mainContainer) {
      mainContainer = document.body;
    }

    const clone = mainContainer.cloneNode(true);
    const REMOVE_TAGS = [
      'script', 'style', 'noscript', 'canvas', 'svg', 'form', 'nav', 'header', 'footer',
      'aside', 'iframe', '.adsbygoogle', '[id*="ad"]', '[class*="ad-"]', '[class*="sidebar"]',
      '[class*="comment"]', '[class*="recommend"]', '[class*="related"]', '[class*="share"]',
      '.hide-article-box', '.csdn-side-toolbar', '#cee-reader-overlay', '#cee-reader-capsule'
    ];
    REMOVE_TAGS.forEach(selector => {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    });

    const cleanHtml = clone.innerHTML;
    const markdown = convertHtmlToMarkdown(clone);
    const plainText = clone.innerText.trim();
    const wordCount = plainText.length;
    const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 400));

    const toc = [];
    const headings = clone.querySelectorAll('h1, h2, h3, h4');
    headings.forEach((h, idx) => {
      const text = h.innerText.trim();
      if (text) {
        toc.push({
          level: parseInt(h.tagName.substring(1), 10),
          text: text,
          id: 'cee-heading-' + idx
        });
      }
    });

    return {
      title: title || '未命名文章',
      author: author,
      date: date,
      url: window.location.href,
      domain: domain,
      wordCount: wordCount,
      readTimeMinutes: readTimeMinutes,
      cleanHtml: cleanHtml,
      contentMarkdown: markdown,
      text: plainText,
      toc: toc
    };
  }

  function convertHtmlToMarkdown(node) {
    let md = '';

    function traverse(el) {
      if (!el) return;
      if (el.nodeType === Node.TEXT_NODE) {
        const t = el.textContent;
        if (t.trim()) md += t;
        return;
      }
      if (el.nodeType !== Node.ELEMENT_NODE) return;

      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript'].includes(tag)) return;

      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        const level = '#'.repeat(parseInt(tag[1], 10));
        md += '\n\n' + level + ' ' + el.innerText.trim() + '\n\n';
        return;
      }

      if (tag === 'p') {
        md += '\n\n';
        el.childNodes.forEach(traverse);
        md += '\n\n';
        return;
      }

      if (tag === 'pre') {
        const code = el.querySelector('code') || el;
        md += '\n\n```\n' + code.innerText.trim() + '\n```\n\n';
        return;
      }

      if (tag === 'code') {
        md += ' `' + el.innerText.trim() + '` ';
        return;
      }

      if (tag === 'blockquote') {
        md += '\n\n> ' + el.innerText.trim().replace(/\n/g, '\n> ') + '\n\n';
        return;
      }

      if (tag === 'ul') {
        md += '\n';
        el.querySelectorAll(':scope > li').forEach(li => {
          md += '- ' + li.innerText.trim() + '\n';
        });
        md += '\n';
        return;
      }

      if (tag === 'ol') {
        md += '\n';
        el.querySelectorAll(':scope > li').forEach((li, idx) => {
          md += (idx + 1) + '. ' + li.innerText.trim() + '\n';
        });
        md += '\n';
        return;
      }

      if (tag === 'img') {
        const src = el.getAttribute('src') || '';
        const alt = el.getAttribute('alt') || 'image';
        if (src) md += '\n\n![' + alt + '](' + src + ')\n\n';
        return;
      }

      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        const text = el.innerText.trim();
        if (href && text) md += ' [' + text + '](' + href + ') ';
        else el.childNodes.forEach(traverse);
        return;
      }

      if (['strong', 'b'].includes(tag)) {
        md += ' **' + el.innerText.trim() + '** ';
        return;
      }

      if (['em', 'i'].includes(tag)) {
        md += ' *' + el.innerText.trim() + '* ';
        return;
      }

      if (tag === 'hr') {
        md += '\n\n---\n\n';
        return;
      }

      el.childNodes.forEach(traverse);
    }

    traverse(node);
    return md.replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------- 6. 🧠 本地智能提纯引擎 (NLP Extractive Fallback) ----------

  function generateLocalSmartDigest(article) {
    const text = article.text || '';
    const title = article.title || '';
    const sentences = text
      .split(/(?<=[。！？.!?\n])\s+/)
      .map(s => s.trim())
      .filter(s => s.length >= 15 && s.length <= 180 && !/^(\d+|[a-zA-Z])$/.test(s));

    if (sentences.length === 0) {
      return {
        summary: title || '未检测到足够正文段落。',
        keypoints: ['请确保页面正文内容已完全加载'],
        insights: ['可在插件控制台配置 DeepSeek API Key 体验云端大模型'],
        glossary: [],
        mindmap: `# ${title}\n- 暂无分级大纲`
      };
    }

    // 1. 词频与关键词权重计算
    const words = (text + ' ' + title).toLowerCase().match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,15}/g) || [];
    const stopWords = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was', 'were', 'which',
      'about', 'their', 'will', 'then', 'they', 'what', 'when', 'where', 'some', 'more', 'into',
      'them', 'these', 'your', 'said', 'also', 'because', 'been', 'there', 'would', 'could', 'should',
      '各个', '以及', '我们', '这个', '那个', '因为', '所以', '如果', '但是', '然后', '对于', '关于',
      '进行', '通过', '可以', '作为', '其中', '由于', '目前', '相关', '主要', '同时', '虽然', '尽管'
    ]);
    const freqMap = {};
    words.forEach(w => {
      if (!stopWords.has(w)) {
        freqMap[w] = (freqMap[w] || 0) + 1;
      }
    });

    // 2. 句子重要度评分 (频率 + 位置加权 + 长度适度)
    const scoredSentences = sentences.map((s, idx) => {
      let score = 0;
      const sWords = s.toLowerCase().match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,15}/g) || [];
      sWords.forEach(w => { score += (freqMap[w] || 0); });
      if (idx < 4) score *= 1.4;
      if (idx > sentences.length - 4) score *= 1.2;
      if (s.length >= 35 && s.length <= 120) score *= 1.25;
      return { text: s, score: score, index: idx };
    });

    const sorted = [...scoredSentences].sort((a, b) => b.score - a.score);

    // 3. 核心摘要 (前 3 句按原文顺序)
    const summarySentences = sorted.slice(0, 3).sort((a, b) => a.index - b.index).map(item => item.text);
    const summary = summarySentences.join(' ');

    // 4. 核心论点 (4 条不同段落的重点论述)
    const keypoints = [];
    const step = Math.max(1, Math.floor(sorted.length / 4));
    for (let i = 0; i < sorted.length && keypoints.length < 4; i += step) {
      if (sorted[i] && !keypoints.includes(sorted[i].text)) {
        keypoints.push(sorted[i].text);
      }
    }
    if (keypoints.length === 0) keypoints.push(summarySentences[0] || '核心要点提炼完成');

    // 5. 行动启发
    const actionIndicators = /(建议|方法|策略|步骤|如何|关键|技巧|推荐|应该|通过|方案|how to|strategy|tip|step|guide|should|recommend|build|grow|learn|focus|start)/i;
    const actionSentences = sentences.filter(s => actionIndicators.test(s));
    const insights = (actionSentences.length > 0 ? actionSentences.slice(0, 3) : sorted.slice(3, 6).map(s => s.text));

    // 6. 术语表解
    const glossary = [];
    const termMatches = text.match(/[“"「『]([^“”"」』]{2,15})[”"」』]|(?<=\b)[A-Z][a-zA-Z0-9]{2,12}(?=\b)/g) || [];
    const uniqueTerms = Array.from(new Set(termMatches)).slice(0, 4);
    uniqueTerms.forEach(term => {
      const ctx = sentences.find(s => s.indexOf(term) !== -1);
      glossary.push({
        term: term,
        def: ctx ? ctx.slice(0, 110) + '...' : '本文讨论的重要概念与核心关键词'
      });
    });

    // 7. 思维导图大纲
    let mindmap = `# ${title || '文章结构导图'}\n`;
    if (article.toc && article.toc.length > 0) {
      article.toc.forEach(t => {
        const indent = '  '.repeat(Math.max(0, t.level - 1));
        mindmap += `${indent}- ${t.text}\n`;
      });
    } else {
      mindmap += `## 1. 核心背景与主题引入\n- ${summarySentences[0] || '主题背景'}\n## 2. 核心论点剖析\n- ${keypoints[0] || '关键分析'}\n- ${keypoints[1] || '细节探讨'}\n## 3. 落地启发与总结\n- ${insights[0] || '实践落地'}\n`;
    }

    return {
      summary: summary || title,
      keypoints: keypoints,
      insights: insights,
      glossary: glossary,
      mindmap: mindmap
    };
  }

  // ---------- 7. 🎨 沉浸式多主题阅读器 Overlay (Reader Mode) ----------

  let currentArticle = null;
  let currentTheme = 'light';
  let currentFontSize = 18;
  let currentFontFamily = 'sans';
  let currentWidth = 'normal';
  let aiDigestData = null;

  function openReaderMode(articleData) {
    if (!IS_TOP) return;
    if (readerOverlay) {
      readerOverlay.remove();
      readerOverlay = null;
    }

    currentArticle = articleData || extractArticleContent();

    chrome.storage.local.get(['readerTheme', 'readerFontSize', 'readerFontFamily', 'readerWidth'], (res) => {
      if (res.readerTheme) currentTheme = res.readerTheme;
      if (res.readerFontSize) currentFontSize = res.readerFontSize;
      if (res.readerFontFamily) currentFontFamily = res.readerFontFamily;
      if (res.readerWidth) currentWidth = res.readerWidth;
      renderReaderOverlay();
    });
  }

  function closeReaderMode() {
    if (readerOverlay) {
      readerOverlay.remove();
      readerOverlay = null;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  }

  function renderReaderOverlay() {
    document.documentElement.style.setProperty('overflow', 'hidden', 'important');

    readerOverlay = document.createElement('div');
    readerOverlay.id = 'cee-reader-overlay';
    readerOverlay.className = `cee-theme-${currentTheme} cee-font-${currentFontFamily} cee-width-${currentWidth}`;

    const fontStyleMap = {
      sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
      serif: '"Source Serif Pro", Georgia, Cambria, "Songti SC", "SimSun", serif',
      mono: '"Fira Code", Consolas, "Courier New", monospace'
    };

    const widthMap = {
      narrow: '680px',
      normal: '820px',
      wide: '1020px'
    };

    const themeStyles = `
      #cee-reader-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        transition: background 0.2s, color 0.2s;
        font-family: ${fontStyleMap[currentFontFamily]};
        -webkit-font-smoothing: antialiased;
      }
      #cee-reader-overlay.cee-theme-light {
        background: #f8fafc;
        color: #1e293b;
      }
      #cee-reader-overlay.cee-theme-dark {
        background: #0f172a;
        color: #e2e8f0;
      }
      #cee-reader-overlay.cee-theme-sepia {
        background: #fbf0d9;
        color: #433422;
      }
      #cee-reader-overlay.cee-theme-ink {
        background: #ffffff;
        color: #000000;
      }

      .cee-reader-nav {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 24px;
        backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      }
      .cee-theme-light .cee-reader-nav { background: rgba(248, 250, 252, 0.88); }
      .cee-theme-dark .cee-reader-nav { background: rgba(15, 23, 42, 0.88); border-color: #334155; }
      .cee-theme-sepia .cee-reader-nav { background: rgba(251, 240, 217, 0.92); border-color: #e2d2b5; }
      .cee-theme-ink .cee-reader-nav { background: #ffffff; border-color: #000000; }

      .cee-nav-logo {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        font-size: 14px;
      }
      .cee-nav-tools {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .cee-btn-tool {
        background: rgba(148, 163, 184, 0.12);
        border: 1px solid rgba(148, 163, 184, 0.25);
        color: inherit;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: all 0.15s ease;
      }
      .cee-btn-tool:hover {
        background: rgba(99, 102, 241, 0.15);
        border-color: #6366f1;
        transform: translateY(-1px);
      }
      .cee-btn-close {
        background: #ef4444 !important;
        color: #ffffff !important;
        border: none !important;
        font-weight: 700;
      }

      .cee-reader-main-container {
        display: flex;
        justify-content: center;
        padding: 40px 20px 80px 20px;
        flex: 1;
      }
      .cee-reader-content-box {
        width: 100%;
        max-width: ${widthMap[currentWidth]};
        font-size: ${currentFontSize}px;
        line-height: 1.8;
      }

      .cee-article-header {
        margin-bottom: 32px;
        padding-bottom: 20px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      }
      .cee-article-title {
        font-size: 1.8em;
        font-weight: 800;
        line-height: 1.35;
        margin-bottom: 16px;
      }
      .cee-article-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 0.8em;
        opacity: 0.75;
      }

      .cee-ai-digest-card {
        background: rgba(99, 102, 241, 0.06);
        border: 1px solid rgba(99, 102, 241, 0.25);
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 36px;
        box-shadow: 0 4px 20px rgba(99, 102, 241, 0.05);
      }
      .cee-ai-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
      }
      .cee-ai-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 700;
        color: #6366f1;
        background: rgba(99, 102, 241, 0.12);
        padding: 4px 10px;
        border-radius: 20px;
      }
      .cee-ai-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 16px;
        border-bottom: 1px solid rgba(99, 102, 241, 0.15);
        padding-bottom: 8px;
        overflow-x: auto;
      }
      .cee-ai-tab-btn {
        background: none;
        border: none;
        color: inherit;
        opacity: 0.65;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
      }
      .cee-ai-tab-btn.active {
        opacity: 1;
        background: rgba(99, 102, 241, 0.15);
        color: #6366f1;
      }
      .cee-ai-content {
        font-size: 14px;
        line-height: 1.7;
      }

      .cee-article-body p { margin-bottom: 1.4em; }
      .cee-article-body h1, .cee-article-body h2, .cee-article-body h3 {
        margin-top: 1.6em;
        margin-bottom: 0.8em;
        font-weight: 700;
        line-height: 1.3;
      }
      .cee-article-body img {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        margin: 20px 0;
        display: block;
      }
      .cee-article-body pre {
        background: rgba(0, 0, 0, 0.05);
        padding: 16px;
        border-radius: 8px;
        overflow-x: auto;
        font-size: 0.88em;
      }
      .cee-theme-dark .cee-article-body pre { background: #1e293b; color: #f8fafc; }
      .cee-article-body blockquote {
        border-left: 4px solid #6366f1;
        padding-left: 16px;
        margin: 20px 0;
        opacity: 0.85;
      }

      .cee-toc-drawer {
        position: fixed;
        left: 20px;
        top: 80px;
        bottom: 40px;
        width: 220px;
        overflow-y: auto;
        font-size: 12px;
        opacity: 0.8;
        display: none;
      }
      @media (min-width: 1300px) {
        .cee-toc-drawer { display: block; }
      }
      .cee-toc-item {
        padding: 4px 0;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cee-toc-item:hover { color: #6366f1; }
      .cee-toc-l2 { padding-left: 12px; }
      .cee-toc-l3 { padding-left: 24px; }
    `;

    let tocHtml = '';
    if (currentArticle.toc && currentArticle.toc.length > 0) {
      tocHtml = '<div class="cee-toc-drawer"><b>📑 目录导航</b><div style="margin-top:8px;">' +
        currentArticle.toc.map((t, idx) =>
          `<div class="cee-toc-item cee-toc-l${t.level}" data-target-id="${t.id}" title="${CEE.escapeHtml(t.text)}">${CEE.escapeHtml(t.text)}</div>`
        ).join('') + '</div></div>';
    }

    readerOverlay.innerHTML = `
      <style>${themeStyles}</style>
      <div class="cee-reader-nav">
        <div class="cee-nav-logo">
          <span>📖</span>
          <span>AI 深度阅读模式</span>
        </div>
        <div class="cee-nav-tools">
          <button class="cee-btn-tool" id="cee-theme-btn" title="切换阅读主题">
            🎨 ${currentTheme === 'light' ? '明亮' : currentTheme === 'dark' ? '暗黑' : currentTheme === 'sepia' ? '羊皮纸' : '墨水屏'}
          </button>
          <button class="cee-btn-tool" id="cee-font-btn" title="切换字体">
            🔤 ${currentFontFamily === 'sans' ? '无衬线' : currentFontFamily === 'serif' ? '衬线' : '等宽'}
          </button>
          <button class="cee-btn-tool" id="cee-font-dec" title="缩小字号">A-</button>
          <button class="cee-btn-tool" id="cee-font-inc" title="放大字号">A+</button>
          <button class="cee-btn-tool" id="cee-width-btn" title="切换行宽">
            ↔️ ${currentWidth === 'narrow' ? '紧凑' : currentWidth === 'normal' ? '标准' : '宽屏'}
          </button>
          <button class="cee-btn-tool" id="cee-export-md" title="下载为 Markdown 文件">
            📥 导出 .md
          </button>
          <button class="cee-btn-tool" id="cee-copy-md" title="复制 Markdown 到剪贴板 (Notion/Obsidian)">
            📋 复制 Markdown
          </button>
          <button class="cee-btn-tool" id="cee-print-btn" title="纯净排版打印 / 保存 PDF">
            🖨️ 打印/PDF
          </button>
          <button class="cee-btn-tool cee-btn-close" id="cee-close-btn" title="退出阅读模式 (Esc)">
            ✕
          </button>
        </div>
      </div>

      ${tocHtml}

      <div class="cee-reader-main-container">
        <div class="cee-reader-content-box">
          <div class="cee-article-header">
            <h1 class="cee-article-title">${CEE.escapeHtml(currentArticle.title)}</h1>
            <div class="cee-article-meta">
              ${currentArticle.author ? `<span>✍️ ${CEE.escapeHtml(currentArticle.author)}</span>` : ''}
              <span>📅 ${CEE.escapeHtml(currentArticle.date)}</span>
              <span>🌐 ${CEE.escapeHtml(currentArticle.domain)}</span>
              <span>📊 约 ${currentArticle.wordCount} 字</span>
              <span>⏱️ 阅读约 ${currentArticle.readTimeMinutes} 分钟</span>
            </div>
          </div>

          <!-- AI 提炼卡片 -->
          <div class="cee-ai-digest-card" id="cee-ai-card">
            <div class="cee-ai-header">
              <div class="cee-ai-badge" id="cee-ai-mode-badge">🧠 DeepSeek AI 深度精华提炼</div>
              <div style="display:flex;gap:6px;">
                <button class="cee-btn-tool" id="cee-open-config-btn" title="配置 API Key" style="display:none;background:rgba(255,255,255,0.1);">⚙️ 配置 Key</button>
                <button class="cee-btn-tool" id="cee-run-ai-btn" style="background:#6366f1;color:#fff;border:none;">
                  ✨ 一键 AI 精华提纯
                </button>
              </div>
            </div>
            <div class="cee-ai-tabs" id="cee-ai-tab-bar" style="display:none;">
              <button class="cee-ai-tab-btn active" data-tab="summary">📌 核心摘要</button>
              <button class="cee-ai-tab-btn" data-tab="keypoints">🎯 核心论点</button>
              <button class="cee-ai-tab-btn" data-tab="insights">💡 行动启发</button>
              <button class="cee-ai-tab-btn" data-tab="glossary">📚 术语表解</button>
              <button class="cee-ai-tab-btn" data-tab="mindmap">🗺️ 思维导图大纲</button>
            </div>
            <div class="cee-ai-content" id="cee-ai-content-box">
              点击右上角「一键 AI 精华提纯」，AI 将秒级提炼本文核心主旨、要点论证、行动启发与思维导图大纲。
            </div>
          </div>

          <!-- 正文 -->
          <div class="cee-article-body" id="cee-article-body-box">
            ${currentArticle.cleanHtml}
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(readerOverlay);
    bindReaderEvents();
  }

  function bindReaderEvents() {
    if (!readerOverlay) return;

    readerOverlay.querySelector('#cee-close-btn').addEventListener('click', closeReaderMode);
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && readerOverlay) {
        closeReaderMode();
        document.removeEventListener('keydown', escHandler);
      }
    });

    const themes = ['light', 'dark', 'sepia', 'ink'];
    readerOverlay.querySelector('#cee-theme-btn').addEventListener('click', () => {
      const idx = (themes.indexOf(currentTheme) + 1) % themes.length;
      currentTheme = themes[idx];
      chrome.storage.local.set({ readerTheme: currentTheme });
      renderReaderOverlay();
    });

    const fonts = ['sans', 'serif', 'mono'];
    readerOverlay.querySelector('#cee-font-btn').addEventListener('click', () => {
      const idx = (fonts.indexOf(currentFontFamily) + 1) % fonts.length;
      currentFontFamily = fonts[idx];
      chrome.storage.local.set({ readerFontFamily: currentFontFamily });
      renderReaderOverlay();
    });

    readerOverlay.querySelector('#cee-font-inc').addEventListener('click', () => {
      currentFontSize = Math.min(32, currentFontSize + 2);
      chrome.storage.local.set({ readerFontSize: currentFontSize });
      renderReaderOverlay();
    });
    readerOverlay.querySelector('#cee-font-dec').addEventListener('click', () => {
      currentFontSize = Math.max(14, currentFontSize - 2);
      chrome.storage.local.set({ readerFontSize: currentFontSize });
      renderReaderOverlay();
    });

    const widths = ['narrow', 'normal', 'wide'];
    readerOverlay.querySelector('#cee-width-btn').addEventListener('click', () => {
      const idx = (widths.indexOf(currentWidth) + 1) % widths.length;
      currentWidth = widths[idx];
      chrome.storage.local.set({ readerWidth: currentWidth });
      renderReaderOverlay();
    });

    readerOverlay.querySelector('#cee-export-md').addEventListener('click', () => {
      const mdContent = CEE.formatArticleToMarkdown(currentArticle);
      const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (currentArticle.title.replace(/[\\/:*?"<>|]/g, '_') || 'article') + '.md';
      a.click();
      URL.revokeObjectURL(url);
    });

    readerOverlay.querySelector('#cee-copy-md').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const mdContent = CEE.formatArticleToMarkdown(currentArticle);
      navigator.clipboard.writeText(mdContent).then(() => {
        const old = btn.innerText;
        btn.innerText = '✅ 已复制 Markdown';
        setTimeout(() => { btn.innerText = old; }, 1500);
      });
    });

    readerOverlay.querySelector('#cee-print-btn').addEventListener('click', () => {
      window.print();
    });

    const runAiBtn = readerOverlay.querySelector('#cee-run-ai-btn');
    if (runAiBtn) {
      runAiBtn.addEventListener('click', runAiDigestInsideReader);
    }

    const configBtn = readerOverlay.querySelector('#cee-open-config-btn');
    if (configBtn) {
      configBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'open-options' });
      });
    }
  }

  // ---------- 8. 🧠 AI 提纯执行逻辑 (自备 Key 直连 / 本地智能 NLP 兜底) ----------

  async function runAiDigestInsideReader() {
    const aiContentBox = readerOverlay.querySelector('#cee-ai-content-box');
    const tabBar = readerOverlay.querySelector('#cee-ai-tab-bar');
    const runBtn = readerOverlay.querySelector('#cee-run-ai-btn');
    const modeBadge = readerOverlay.querySelector('#cee-ai-mode-badge');
    const configBtn = readerOverlay.querySelector('#cee-open-config-btn');

    runBtn.disabled = true;
    runBtn.innerText = '🤖 正在提纯...';
    aiContentBox.innerHTML = '<div style="color:#6366f1;font-weight:600;">✨ 正在解析正文并提炼核心主旨、逻辑论点与思维导图...</div>';

    chrome.storage.local.get(['customApiKey', 'customApiEndpoint'], async (storage) => {
      const promptText = `请对以下文章进行深度精华提纯，并严格按如下 JSON 结构返回（不要包裹多余 markdown 代码块）：
{
  "summary": "3-5句话精准提炼核心主旨",
  "keypoints": ["要点1", "要点2", "要点3", "要点4"],
  "insights": ["实践建议或启发1", "实践建议或启发2"],
  "glossary": [{"term": "专业术语1", "def": "简明通俗释义"}],
  "mindmap": "# 文章导图\\n## 核心支柱1\\n- 论据A\\n- 论据B\\n## 核心支柱2\\n- 论据C"
}

文章标题：${currentArticle.title}
文章内容：
${currentArticle.text.slice(0, 4500)}`;

      let digestJson = null;
      let usedLocalFallback = false;
      let keyNotice = '';

      // 1. 若用户配置了自备 API Key (BYOK 极客直连模式)
      if (storage.customApiKey) {
        try {
          const endpoint = storage.customApiEndpoint || 'https://api.deepseek.com/chat/completions';
          const res = await CEE.fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${storage.customApiKey}`
            },
            body: JSON.stringify({
              model: 'deepseek-chat',
              messages: [{ role: 'user', content: promptText }],
              temperature: 0.2
            })
          }, 25000);

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            const msg = (errJson.error && errJson.error.message) || `HTTP ${res.status}`;
            throw new Error(msg);
          }

          const raw = await res.json();
          const content = raw.choices[0].message.content;
          const match = content.match(/\{[\s\S]*\}/);
          digestJson = JSON.parse(match ? match[0] : content);
          modeBadge.innerText = '🧠 DeepSeek AI 深度提纯';
        } catch (e) {
          console.warn('Custom API Key call failed, falling back to local NLP:', e);
          keyNotice = `<div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 12px;margin-bottom:12px;color:#fca5a5;font-size:12px;">⚠️ 自定义 API Key 响应异常 (${CEE.escapeHtml(e.message)})，已为您自动切换为本地智能提纯。</div>`;
        }
      }

      // 2. 若未配置 API Key 或调用失败，无缝启用本地纯前端智能 NLP 提纯引擎
      if (!digestJson || !digestJson.summary) {
        digestJson = generateLocalSmartDigest(currentArticle);
        usedLocalFallback = true;
        modeBadge.innerText = '⚡ 本地智能提纯 (秒级即达)';
        if (configBtn) configBtn.style.display = 'inline-flex';

        if (!keyNotice) {
          keyNotice = `
            <div style="background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:8px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;font-size:12px;">
              <span>💡 当前为<b>本地离线提纯</b>。想要开启 DeepSeek 大模型万字逻辑链与导图？</span>
              <button id="cee-key-setup-btn" style="background:#6366f1;color:#fff;border:none;padding:5px 12px;border-radius:6px;font-weight:600;cursor:pointer;white-space:nowrap;">👉 1分钟配置 Key</button>
            </div>
          `;
        }
      }

      aiDigestData = digestJson;
      currentArticle.aiSummary = digestJson.summary;

      tabBar.style.display = 'flex';
      renderAiTabContent('summary', keyNotice);
      runBtn.innerText = '✅ 提纯完成';
      runBtn.disabled = false;

      tabBar.querySelectorAll('.cee-ai-tab-btn').forEach(btn => {
        btn.onclick = () => {
          tabBar.querySelectorAll('.cee-ai-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderAiTabContent(btn.dataset.tab, keyNotice);
        };
      });
    });
  }

  function renderAiTabContent(tabKey, keyNotice) {
    if (!aiDigestData || !readerOverlay) return;
    const box = readerOverlay.querySelector('#cee-ai-content-box');
    if (!box) return;

    let inner = '';
    if (tabKey === 'summary') {
      inner = `<p style="font-weight:500;margin:0;line-height:1.75;">${CEE.escapeHtml(aiDigestData.summary || '暂无摘要')}</p>`;
    } else if (tabKey === 'keypoints') {
      const list = aiDigestData.keypoints || [];
      inner = list.length ? `<ul style="padding-left:20px;margin:0;line-height:1.75;">${list.map(pt => `<li>${CEE.escapeHtml(pt)}</li>`).join('')}</ul>` : '暂无核心论点';
    } else if (tabKey === 'insights') {
      const list = aiDigestData.insights || [];
      inner = list.length ? `<ul style="padding-left:20px;margin:0;line-height:1.75;">${list.map(ins => `<li>💡 ${CEE.escapeHtml(ins)}</li>`).join('')}</ul>` : '暂无行动启发';
    } else if (tabKey === 'glossary') {
      const list = aiDigestData.glossary || [];
      inner = list.length ? `<div style="display:flex;flex-direction:column;gap:8px;">${list.map(item => `<div><b>${CEE.escapeHtml(item.term)}</b>: <span style="opacity:0.85;">${CEE.escapeHtml(item.def)}</span></div>`).join('')}</div>` : '无生僻术语';
    } else if (tabKey === 'mindmap') {
      inner = `<pre style="font-family:monospace;white-space:pre-wrap;background:rgba(0,0,0,0.04);padding:12px;border-radius:6px;margin:0;line-height:1.6;">${CEE.escapeHtml(aiDigestData.mindmap || '')}</pre>`;
    }

    box.innerHTML = (keyNotice || '') + inner;

    const keySetupBtn = box.querySelector('#cee-key-setup-btn');
    if (keySetupBtn) {
      keySetupBtn.onclick = () => {
        chrome.runtime.sendMessage({ action: 'open-options' });
      };
    }
  }

  // ---------- 9. 快捷页面悬浮胶囊 ----------

  function initReaderCapsule() {
    if (!IS_TOP) return;
    chrome.storage.local.get(['showFloatingCapsule'], (res) => {
      if (res.showFloatingCapsule === false) return;
      if (document.getElementById('cee-reader-capsule')) return;

      capsuleEl = document.createElement('div');
      capsuleEl.id = 'cee-reader-capsule';
      capsuleEl.innerHTML = `
        <style>
          #cee-reader-capsule {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 2147483645;
            display: flex;
            align-items: center;
            background: rgba(15, 23, 42, 0.88);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
            border-radius: 30px;
            padding: 4px 6px;
            gap: 4px;
            color: #ffffff;
            font: 12px/1.4 system-ui, -apple-system, sans-serif;
            transition: all 0.2s ease;
          }
          #cee-reader-capsule:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
          }
          .cee-capsule-btn {
            background: none;
            border: none;
            color: #ffffff;
            padding: 6px 10px;
            border-radius: 20px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: background 0.15s;
          }
          .cee-capsule-btn:hover {
            background: rgba(255, 255, 255, 0.15);
          }
          .cee-capsule-close {
            color: #94a3b8;
            font-size: 14px;
            padding: 4px 8px;
            cursor: pointer;
          }
          .cee-capsule-close:hover { color: #ff5252; }
        </style>
        <button class="cee-capsule-btn" id="cee-capsule-reader" title="开启纯净阅读模式">📖 深度阅读</button>
        <button class="cee-capsule-btn" id="cee-capsule-bust" title="一键破除弹窗与限制">🛡️ 破除遮罩</button>
        <span class="cee-capsule-close" id="cee-capsule-close" title="收起悬浮胶囊">✕</span>
      `;

      document.body.appendChild(capsuleEl);

      capsuleEl.querySelector('#cee-capsule-reader').onclick = () => openReaderMode();
      capsuleEl.querySelector('#cee-capsule-bust').onclick = () => {
        const count = runGateBuster();
        flashPickerHint(`🛡️ 已破除 ${count} 处遮罩与阅读限制`);
      };
      capsuleEl.querySelector('#cee-capsule-close').onclick = () => capsuleEl.remove();
    });
  }

  // ---------- 10. 元素点选器 (Picker) ----------

  function pickTarget(node) {
    let el = node && node.nodeType === 1 ? node : (node && node.parentElement) || null;
    for (let i = 0; el && i < 6; i++) {
      if (el === document.body || el === document.documentElement || el.id === 'cee-reader-overlay' || el.id === 'cee-reader-capsule') return null;
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
      const sel = classes.slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
      if (CEE.isSafeSelector(sel)) return sel;
    }
    return null;
  }

  function flashPickerHint(text) {
    let hint = document.getElementById('cee-picker-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'cee-picker-hint';
      hint.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;background:#0f172a;color:#fff;padding:8px 16px;border-radius:20px;font:12px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);';
      document.body.appendChild(hint);
    }
    hint.textContent = text;
    setTimeout(() => { if (hint) hint.remove(); }, 2000);
  }

  function activatePicker(done) {
    deactivatePicker();
    picker = { done: done || null };

    const overlay = document.createElement('div');
    overlay.id = 'cee-picker-highlight';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:2px solid #6366f1;background:rgba(99,102,241,0.15);transition:all 60ms;';
    document.documentElement.appendChild(overlay);

    const onMove = (e) => {
      if (!picker) return;
      const el = pickTarget(e.target);
      if (!el) { overlay.style.width = '0px'; overlay.style.height = '0px'; return; }
      const r = el.getBoundingClientRect();
      overlay.style.top = r.top + 'px';
      overlay.style.left = r.left + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    };

    const onClick = (e) => {
      if (!picker) return;
      e.preventDefault();
      e.stopPropagation();
      const el = pickTarget(e.target);
      if (!el) return;
      const sel = selectorForElement(el);
      if (sel) {
        addRuleAndHide(sel);
      }
    };

    const onKey = (e) => {
      if (e.key === 'Escape') deactivatePicker();
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);

    picker._cleanup = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    };
  }

  function deactivatePicker() {
    if (!picker) return;
    if (picker._cleanup) picker._cleanup();
    const done = picker.done;
    picker = null;
    if (done) done({ ok: true });
  }

  function addRuleAndHide(sel) {
    chrome.storage.local.get(['rules'], (result) => {
      const allRules = CEE.normalizeRules(result.rules || {});
      const list = allRules[domain] || [];
      if (!list.some(r => r.selector === sel)) {
        list.push({
          id: CEE.makeRuleId(),
          name: '手动点选隐藏',
          selector: sel,
          enabled: true,
          date: new Date().toLocaleDateString(),
          ts: Date.now()
        });
        allRules[domain] = list;
        chrome.storage.local.set({ rules: allRules });
      }
      deactivatePicker();
    });
  }

  // ---------- 11. 消息路由 ----------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;

    if (message.action === 'open-reader-mode') {
      if (!IS_TOP) return;
      openReaderMode();
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'trigger-gate-buster') {
      if (!IS_TOP) return;
      const count = runGateBuster();
      sendResponse({ ok: true, count: count });
      return;
    }

    if (message.action === 'get-article-data') {
      if (!IS_TOP) return;
      try {
        const article = extractArticleContent();
        sendResponse({ ok: true, article: article });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return;
    }

    if (message.action === 'get-simplified-dom') {
      if (!IS_TOP) return;
      sendResponse({ dom: document.body ? document.body.innerText.slice(0, 3000) : '' });
      return;
    }

    if (message.action === 'get-stats') {
      if (!IS_TOP) return;
      sendResponse({ count: hiddenCount });
      return;
    }

    if (message.action === 'activate-picker') {
      if (!IS_TOP) return;
      activatePicker(sendResponse);
      return true;
    }

    if (message.action === 'cancel-picker') {
      if (!IS_TOP) return;
      deactivatePicker();
      sendResponse({ ok: true });
      return;
    }
  });

  // ---------- 12. 启动初始化 ----------

  injectSavedRules();

  function onReady() {
    injectSavedRules();
    startObserver();
    setTimeout(initReaderCapsule, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.rules || changes.globalEnabled || changes.siteDisabled) {
      injectSavedRules();
    }
  });
})();
