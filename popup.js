// popup.js - AI Ad Purifier 弹窗逻辑 (支持 Chrome i18n 多语言)
document.addEventListener('DOMContentLoaded', async () => {
  const CEE = globalThis.CEE;

  const mainPanel = document.getElementById('main-panel');
  const localCleanBtn = document.getElementById('local-clean');
  const aiCleanBtn = document.getElementById('ai-clean');
  const btnPicker = document.getElementById('btn-picker');
  const btnUndo = document.getElementById('btn-undo');
  const btnSiteToggle = document.getElementById('btn-site-toggle');
  const rulesContainer = document.getElementById('rules-container');
  const rulesCount = document.getElementById('rules-count');
  const hiddenCountEl = document.getElementById('hidden-count');
  const currentDomainText = document.getElementById('current-domain');
  const openSettingsBtn = document.getElementById('open-settings');

  const quotaText = document.getElementById('quota-text');
  const upgradeBtnLink = document.getElementById('upgrade-btn-link');
  const upgradeModal = document.getElementById('upgrade-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalWaffoBuy = document.getElementById('modal-waffo-buy');
  const modalOrderId = document.getElementById('modal-order-id');
  const modalBtnActivate = document.getElementById('modal-btn-activate');

  let activeTab = null;
  let domain = '';
  let sitePaused = false;
  let picking = false;

  const CLOUD_VERIFY_URL = "https://ai-ad-purifier.onrender.com/verify";
  const WAFFO_SUBSCRIPTION_URL = "https://pancake.waffo.ai/store/xmaker-studio-p7o0nfzy/product/PROD_0BT62Y3uxafpZyoOITOO7E?type=subscription&currency=USD";

  // ---------- i18n 辅助函数 ----------

  function t(key, fallback) {
    return (chrome.i18n && chrome.i18n.getMessage(key)) || fallback || '';
  }

  function localizeDocument() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const msg = t(key, el.textContent);
      if (msg) el.textContent = msg;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      const msg = t(key, el.placeholder);
      if (msg) el.placeholder = msg;
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      const msg = t(key, el.title);
      if (msg) el.title = msg;
    });
  }

  localizeDocument();
  mainPanel.style.display = 'flex';
  initApp();

  // ---------- 通用工具 ----------

  async function fetchJSON(url, body) {
    const res = await CEE.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 20000);
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON 响应 */ }
    return { res, data };
  }

  // ---------- 2. 初始化 ----------

  async function initApp() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    activeTab = tabs[0];

    try {
      const url = new URL(activeTab.url);
      domain = CEE.normalizeDomain(url.hostname);
      currentDomainText.textContent = domain;

      if (url.protocol.startsWith('chrome') || url.protocol.startsWith('edge') || url.protocol === 'about:') {
        disableForUnsupportedPage(t('unsupportedPageSys', 'Browser system pages cannot be cleaned.'));
        return;
      }
    } catch (e) {
      disableForUnsupportedPage(t('unsupportedPageGen', 'This page does not support ad cleaning.'));
      return;
    }

    loadDomainRules();
    checkAndUpdateQuota();
    updateSiteToggleUI();
    refreshHiddenCount();

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.rules || changes.isPro || changes.siteDisabled) {
        loadDomainRules();
        checkAndUpdateQuota();
        updateSiteToggleUI();
        refreshHiddenCount();
      }
    });

    // 点选隐藏
    btnPicker.addEventListener('click', startPicker);
    // 撤销上一条
    btnUndo.addEventListener('click', undoLastRule);
    // 暂停/恢复当前站点
    btnSiteToggle.addEventListener('click', toggleSitePause);
    // 本地清理
    localCleanBtn.addEventListener('click', () => {
      localCleanBtn.disabled = true;
      localCleanBtn.textContent = t('localCleanBtnScanning', '⚡ Scanning local ads...');
      triggerLocalScannerFallback(() => {
        localCleanBtn.disabled = false;
        localCleanBtn.textContent = t('localCleanBtn', '⚡ Instant Local Clean (Free)');
      });
    });
    // AI 清理
    aiCleanBtn.addEventListener('click', onAiCleanClick);
    // 升级弹窗
    upgradeBtnLink.addEventListener('click', () => { upgradeModal.style.display = 'flex'; });
    modalCloseBtn.addEventListener('click', () => { upgradeModal.style.display = 'none'; });
    modalWaffoBuy.addEventListener('click', () => {
      chrome.tabs.create({ url: WAFFO_SUBSCRIPTION_URL });
    });
    modalBtnActivate.addEventListener('click', onModalActivate);
  }

  function disableForUnsupportedPage(message) {
    aiCleanBtn.disabled = true;
    localCleanBtn.disabled = true;
    btnPicker.disabled = true;
    aiCleanBtn.style.opacity = '0.5';
    aiCleanBtn.textContent = message;
    rulesContainer.innerHTML = '<div class="empty-state">' + CEE.escapeHtml(message) + '</div>';
  }

  // ---------- 规则列表 ----------

  function loadDomainRules() {
    chrome.storage.local.get(['rules'], (result) => {
      const allRules = result.rules || {};
      const rawDomainRules = allRules[domain] || [];
      const domainRules = rawDomainRules.filter(r => CEE.isSafeSelector(r.selector));
      renderRules(domainRules);
    });
  }

  function renderRules(rules) {
    rulesCount.textContent = '(' + rules.length + ')';
    if (rules.length === 0) {
      rulesContainer.innerHTML = `<div class="empty-state">${CEE.escapeHtml(t('emptyStateRules', 'No hidden elements on this website yet. Click a clean button above to start!'))}</div>`;
      return;
    }

    rulesContainer.innerHTML = '';
    rules.forEach((rule) => {
      const item = document.createElement('div');
      item.className = 'rule-item';
      const restoreTitle = CEE.escapeHtml(t('restoreHiddenElement', 'Restore hidden element'));
      // 注意：name/selector 一律 HTML 转义，防止属性逃逸
      item.innerHTML = `
        <div class="rule-details">
          <div class="rule-name" title="${CEE.escapeHtml(rule.name)}">${CEE.escapeHtml(rule.name)}</div>
          <div class="rule-selector" title="${CEE.escapeHtml(rule.selector)}">${CEE.escapeHtml(rule.selector)}</div>
        </div>
        <div class="rule-actions">
          <label class="switch">
            <input type="checkbox" id="toggle-${CEE.escapeHtml(rule.id)}" ${rule.enabled !== false ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <button class="delete-btn" id="delete-${CEE.escapeHtml(rule.id)}" title="${restoreTitle}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      item.querySelector(`#toggle-${CSS.escape(rule.id)}`).addEventListener('change', (e) => {
        toggleRule(rule.id, e.target.checked);
      });
      item.querySelector(`#delete-${CSS.escape(rule.id)}`).addEventListener('click', () => {
        deleteRule(rule.id);
      });

      rulesContainer.appendChild(item);
    });
  }

  function toggleRule(ruleId, enabled) {
    chrome.storage.local.get(['rules'], (result) => {
      const allRules = CEE.normalizeRules(result.rules || {});
      const domainRules = allRules[domain] || [];
      const updated = domainRules.map(r => r.id === ruleId ? { ...r, enabled } : r);
      allRules[domain] = updated;
      chrome.storage.local.set({ rules: allRules });
    });
  }

  function deleteRule(ruleId) {
    chrome.storage.local.get(['rules'], (result) => {
      const allRules = CEE.normalizeRules(result.rules || {});
      const domainRules = allRules[domain] || [];
      const filtered = domainRules.filter(r => r.id !== ruleId);
      if (filtered.length > 0) {
        allRules[domain] = filtered;
      } else {
        delete allRules[domain];
      }
      chrome.storage.local.set({ rules: allRules });
    });
  }

  // ---------- 撤销上一条 ----------

  function undoLastRule() {
    chrome.storage.local.get(['rules'], (result) => {
      const allRules = CEE.normalizeRules(result.rules || {});
      const list = allRules[domain] || [];
      if (list.length === 0) {
        alert(t('undoNoRules', 'No rules to undo on this website.'));
        return;
      }
      // 优先撤销 ts 最大（最新添加）的规则；同值取数组靠后的
      let idx = list.length - 1;
      let bestTs = -1;
      for (let i = 0; i < list.length; i++) {
        const ts = list[i].ts || 0;
        if (ts >= bestTs) { bestTs = ts; idx = i; }
      }
      const removed = list[idx];
      list.splice(idx, 1);
      if (list.length > 0) {
        allRules[domain] = list;
      } else {
        delete allRules[domain];
      }
      chrome.storage.local.set({ rules: allRules }, () => {
        alert(t('undoSuccess', 'Undone: ') + removed.selector);
        loadDomainRules();
      });
    });
  }

  // ---------- 暂停/恢复当前站点 ----------

  function toggleSitePause() {
    chrome.storage.local.get(['siteDisabled'], (result) => {
      const sd = result.siteDisabled || {};
      if (sd[domain]) {
        delete sd[domain];
      } else {
        sd[domain] = true;
      }
      chrome.storage.local.set({ siteDisabled: sd }, updateSiteToggleUI);
    });
  }

  function updateSiteToggleUI() {
    chrome.storage.local.get(['siteDisabled', 'globalEnabled'], (result) => {
      const globalEnabled = result.globalEnabled !== false;
      sitePaused = (result.siteDisabled || {})[domain] === true;
      const effectiveDisabled = !globalEnabled || sitePaused;

      if (sitePaused) {
        btnSiteToggle.textContent = t('siteResumeBtn', '▶ Resume on Site');
        btnSiteToggle.style.color = '#f87171';
        btnSiteToggle.style.borderColor = 'rgba(248,113,113,0.4)';
      } else {
        btnSiteToggle.textContent = t('sitePauseBtn', '⏸ Pause on Site');
        btnSiteToggle.style.color = '';
        btnSiteToggle.style.borderColor = '';
      }

      // 站点暂停或全局关闭时，禁用清理/点选按钮
      [aiCleanBtn, localCleanBtn, btnPicker].forEach(btn => {
        btn.disabled = effectiveDisabled;
        btn.style.opacity = effectiveDisabled ? '0.5' : '';
      });
      if (effectiveDisabled) {
        aiCleanBtn.textContent = globalEnabled
          ? t('sitePausedMsg', 'Cleaning paused on this site')
          : t('globalDisabledMsg', 'Global protection is disabled');
      } else {
        aiCleanBtn.textContent = t('aiCleanBtn', '✨ DeepSeek AI Purify (Pro $7.99/mo)');
      }
      if (!globalEnabled && localCleanBtn) {
        localCleanBtn.textContent = t('localCleanBtn', '⚡ Instant Local Clean (Free)');
      }
    });
  }

  // ---------- 隐藏数量 ----------

  function refreshHiddenCount() {
    if (!activeTab || !activeTab.id) return;
    chrome.tabs.sendMessage(activeTab.id, { action: 'get-stats' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      const n = res.count || 0;
      hiddenCountEl.textContent = '🛡 ' + n;
    });
  }

  // ---------- 点选隐藏 ----------

  function startPicker() {
    if (picking) return;
    if (!activeTab || !activeTab.id) return;
    picking = true;
    btnPicker.disabled = true;
    btnPicker.textContent = t('pickerBtnActive', '🎯 Click on any element…');
    // 弹窗会保持打开；用户点击元素或按 Esc 后 content 脚本回调
    chrome.tabs.sendMessage(activeTab.id, { action: 'activate-picker' }, () => {
      picking = false;
      btnPicker.disabled = false;
      btnPicker.textContent = t('pickerBtn', '🎯 Pick & Hide');
      refreshHiddenCount();
    });
  }

  // ---------- 本地扫描兜底 ----------

  function triggerLocalScannerFallback(doneCallback) {
    chrome.tabs.sendMessage(activeTab.id, { action: 'scan-local-ads' }, (scanRes) => {
      const localSelectors = (scanRes && Array.isArray(scanRes.selectors) && scanRes.selectors.length > 0)
        ? scanRes.selectors
        : ['.adsbygoogle', 'iframe[src*="googleads"]', 'iframe[src*="doubleclick"]', 'ytd-ad-slot-renderer'];
      processAISelectors(localSelectors, doneCallback);
    });
  }

  // ---------- AI 清理 ----------

  function onAiCleanClick() {
    checkAndUpdateQuota(({ isPro }) => {
      if (!isPro) {
        upgradeModal.style.display = 'flex';
        return;
      }

      aiCleanBtn.disabled = true;
      aiCleanBtn.textContent = t('aiCleanBtnScanning', '🤖 DeepSeek AI is analyzing page...');

      chrome.tabs.sendMessage(activeTab.id, { action: 'get-simplified-dom' }, (domResponse) => {
        if (chrome.runtime.lastError || !domResponse || domResponse.error) {
          triggerLocalScannerFallback(resetAiBtn);
          return;
        }
        const domString = domResponse.dom;

        chrome.storage.local.get(['activationCode'], async (storageRes) => {
          const orderId = storageRes.activationCode;
          if (!orderId) {
            upgradeModal.style.display = 'flex';
            resetAiBtn();
            return;
          }

          try {
            const cleanUrl = CLOUD_VERIFY_URL.replace('/verify', '/analyze');
            const { res, data } = await fetchJSON(cleanUrl, {
              key: orderId,
              dom: `Hostname: ${domain}. Condensed DOM:\n${domString}`
            });

            if (!res.ok) {
              const code = data && data.code;
              if (res.status === 403 && code === 'expired') {
                chrome.storage.local.set({ isPro: false, expiresAt: null }, () => {
                  upgradeModal.style.display = 'flex';
                  alert(t('subExpired', 'Subscription has expired. Please renew to continue using Pro features.'));
                });
                throw new Error('subscription expired');
              }
              if (res.status === 403 || res.status === 429) {
                if (code === 'rate_limited') {
                  throw new Error(t('rateLimited', 'Too many requests. Please try again later.'));
                }
                chrome.storage.local.set({ isPro: false }, () => {
                  upgradeModal.style.display = 'flex';
                });
                throw new Error(t('subInvalidOrExpired', 'Subscription expired or invalid Order ID. Please re-subscribe.'));
              }
              throw new Error(t('serverErrorHttp', 'Cloud analysis service error (HTTP ') + res.status + ')');
            }

            const selectors = data && data.selectors;
            if (!Array.isArray(selectors) || selectors.length === 0) {
              triggerLocalScannerFallback(resetAiBtn);
              return;
            }
            processAISelectors(selectors, resetAiBtn);
          } catch (error) {
            console.log('AI 云端通信异常:', error.message);
            if (error.message && error.message !== 'subscription expired') {
              alert(error.message);
            }
            resetAiBtn();
          }
        });
      });
    });
  }

  function resetAiBtn() {
    aiCleanBtn.disabled = false;
    aiCleanBtn.textContent = t('aiCleanBtn', '✨ DeepSeek AI Purify (Pro $7.99/mo)');
  }

  // 处理并保存 AI/本地扫描生成的选择器
  function processAISelectors(selectors, onComplete) {
    chrome.storage.local.get(['rules'], (rulesResult) => {
      const allRules = CEE.normalizeRules(rulesResult.rules || {});
      const domainRules = allRules[domain] || [];

      let addedCount = 0;
      selectors.forEach((sel, index) => {
        if (CEE.isSafeSelector(sel) && !domainRules.some(r => r.selector === sel)) {
          domainRules.push({
            id: CEE.makeRuleId('rule_ai_'),
            name: t('smartRulePrefix', 'Smart Rule #') + (index + 1),
            selector: sel,
            enabled: true,
            date: new Date().toLocaleDateString(),
            ts: Date.now() + index // 同一批内保序
          });
          addedCount++;
        }
      });

      if (addedCount > 0) {
        allRules[domain] = domainRules;
        chrome.storage.local.set({ rules: allRules }, () => {
          if (onComplete) onComplete();
        });
      } else {
        alert(t('aiCleanApplied', '🤖 Page analysis complete. Blocking rules have been applied.'));
        if (onComplete) onComplete();
      }
    });
  }

  // ---------- 订阅状态 ----------

  function checkAndUpdateQuota(callback) {
    chrome.storage.local.get(['isPro', 'expiresAt'], (res) => {
      const exp = res.expiresAt ? new Date(res.expiresAt).getTime() : 0;
      const expired = res.isPro === true && exp > 0 && exp < Date.now();
      if (expired) {
        chrome.storage.local.set({ isPro: false, expiresAt: null });
      }
      const isPro = res.isPro === true && !expired;

      if (isPro) {
        quotaText.innerHTML = `👑 <b style="color:#6366f1;">${t('planPro', '👑 Pro Edition')}</b>` +
          (exp > 0 ? ' · ' + t('planProUntil', 'Until ') + new Date(exp).toLocaleDateString() : '');
        upgradeBtnLink.style.display = 'none';
      } else {
        quotaText.innerHTML = `${t('planFree', '🌱 Free Edition (Standard Shield)')}`;
        upgradeBtnLink.style.display = 'inline-block';
      }

      if (callback) callback({ isPro });
    });
  }

  // ---------- 激活 ----------

  function activateWithCode(code, onSuccess) {
    if (!CEE.isPlausibleKey(code)) {
      alert(t('invalidOrderId', "Invalid Order ID format. Please paste your Waffo Order ID (starting with 'ORD_', e.g., ORD_7QH059...)."));
      return false;
    }
    fetchJSON(CLOUD_VERIFY_URL, { key: code })
      .then(({ res, data }) => {
        if (!res.ok) throw new Error('服务器返回错误');
        if (data.valid) {
          chrome.storage.local.set({
            isPro: true,
            activationCode: code,
            expiresAt: data.expiresAt || null
          }, () => {
            alert(t('activationSuccess', '🎉 Premium access activated successfully! Thank you for subscribing to AI Ad Purifier.'));
            onSuccess();
          });
        } else {
          alert('❌ ' + (data.message || t('activationFailed', 'Invalid or unpaid Order ID. Please check your purchase receipt.')));
        }
      })
      .catch(() => {
        alert(t('serverConnFailed', 'Failed to connect to verification server. Please check your network or try again later.'));
      });
    return true;
  }

  function onModalActivate() {
    const code = modalOrderId.value.trim().toUpperCase();
    if (!code) {
      alert(t('enterOrderId', 'Please enter your Waffo subscription Order ID.'));
      return;
    }
    modalBtnActivate.disabled = true;
    modalBtnActivate.textContent = t('modalActivatingBtn', 'Activating...');
    const started = activateWithCode(code, () => {
      upgradeModal.style.display = 'none';
      checkAndUpdateQuota();
      modalBtnActivate.disabled = false;
      modalBtnActivate.textContent = t('modalActivateBtn', 'Activate');
    });
    if (!started) {
      modalBtnActivate.disabled = false;
      modalBtnActivate.textContent = t('modalActivateBtn', 'Activate');
    }
  }

  // ---------- 其它 ----------

  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  const btnRateStore = document.getElementById('btn-rate-store');
  if (btnRateStore) {
    btnRateStore.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://chromewebstore.google.com/detail/' + chrome.runtime.id });
    });
  }
});
