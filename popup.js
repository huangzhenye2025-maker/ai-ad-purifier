// popup.js - AI Ad Purifier / AI 深度阅读与提纯助手 弹窗逻辑
document.addEventListener('DOMContentLoaded', async () => {
  const CEE = globalThis.CEE;

  const currentDomainText = document.getElementById('current-domain');
  const siteStatusBadge = document.getElementById('site-status-badge');
  const siteStatusText = document.getElementById('site-status-text');
  const quotaDisplay = document.getElementById('quota-display');
  const btnShowUpgrade = document.getElementById('btn-show-upgrade');
  const openOptionsBtn = document.getElementById('open-options-btn');

  const btnOpenReader = document.getElementById('btn-open-reader');
  const btnAiPurify = document.getElementById('btn-ai-purify');
  const btnGateBuster = document.getElementById('btn-gate-buster');
  const btnPicker = document.getElementById('btn-picker');
  const btnToggleSite = document.getElementById('btn-toggle-site');
  const siteToggleIcon = document.getElementById('site-toggle-icon');
  const siteToggleLabel = document.getElementById('site-toggle-label');

  const rulesCountEl = document.getElementById('rules-count');
  const rulesContainer = document.getElementById('rules-container');

  const upgradeModal = document.getElementById('upgrade-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalBuyLink = document.getElementById('modal-buy-link');
  const modalOrderId = document.getElementById('modal-order-id');
  const modalActivateBtn = document.getElementById('modal-activate-btn');

  const WAFFO_BUY_URL = 'https://pancake.waffo.ai/store/xmaker-studio-p7o0nfzy/product/PROD_0BT62Y3uxafpZyoOITOO7E?type=product&currency=USD';
  const SUPABASE_URL = 'https://emsdrhllxuorcaxbejtw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_MIUNy-qIOpOrcjGOYVqRFA_tzo0qgnB';
  const VERIFY_URL = SUPABASE_URL + '/rest/v1/rpc/verify_license';

  let activeTab = null;
  let domain = '';
  let sitePaused = false;

  // ---------- 初始化 ----------

  async function init() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    activeTab = tabs[0];

    try {
      const url = new URL(activeTab.url);
      domain = CEE.normalizeDomain(url.hostname);
      currentDomainText.textContent = domain;

      if (url.protocol.startsWith('chrome') || url.protocol.startsWith('edge') || url.protocol === 'about:') {
        disableForSysPage();
        return;
      }
    } catch (e) {
      currentDomainText.textContent = '未知页面';
      return;
    }

    refreshQuotaUI();
    refreshSiteStatus();
    loadRules();
    bindEvents();

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.rules || changes.siteDisabled || changes.isPro || changes.aiDailyQuota || changes.customApiKey) {
        refreshQuotaUI();
        refreshSiteStatus();
        loadRules();
      }
    });
  }

  function disableForSysPage() {
    btnOpenReader.disabled = true;
    btnAiPurify.disabled = true;
    btnGateBuster.disabled = true;
    btnPicker.disabled = true;
    btnToggleSite.disabled = true;
    rulesContainer.innerHTML = '<div class="empty-state">浏览器系统页面不支持阅读与清理</div>';
  }

  // ---------- 配额与状态展示 ----------

  function refreshQuotaUI() {
    chrome.storage.local.get(['isPro', 'customApiKey'], (res) => {
      if (res.customApiKey) {
        quotaDisplay.innerHTML = '🧠 <b style="color:#6ee7b7;">已启用 DeepSeek 自备 Key</b>';
        btnShowUpgrade.style.display = res.isPro ? 'none' : 'inline-block';
      } else if (res.isPro) {
        quotaDisplay.innerHTML = '👑 <b style="color:#a5b4fc;">Pro 终身买断版 (全功能)</b>';
        btnShowUpgrade.style.display = 'none';
      } else {
        quotaDisplay.innerHTML = '⚡ <b>本地离线提纯 (可自备Key开启大模型)</b>';
        btnShowUpgrade.style.display = 'inline-block';
      }
    });
  }

  function refreshSiteStatus() {
    chrome.storage.local.get(['siteDisabled', 'globalEnabled'], (res) => {
      const globalEnabled = res.globalEnabled !== false;
      sitePaused = (res.siteDisabled || {})[domain] === true;

      if (!globalEnabled || sitePaused) {
        siteStatusBadge.className = 'shield-status paused';
        siteStatusText.textContent = '已暂停';
        siteToggleIcon.textContent = '▶';
        siteToggleLabel.textContent = '恢复此站';
      } else {
        siteStatusBadge.className = 'shield-status';
        siteToggleIcon.textContent = '⏸';
        siteToggleLabel.textContent = '暂停此站';

        // 获取隐藏数量
        if (activeTab && activeTab.id) {
          chrome.tabs.sendMessage(activeTab.id, { action: 'get-stats' }, (res) => {
            if (chrome.runtime.lastError || !res) return;
            const count = res.count || 0;
            siteStatusText.textContent = `防护中 (${count})`;
          });
        }
      }
    });
  }

  // ---------- 规则列表展示 ----------

  function loadRules() {
    chrome.storage.local.get(['rules'], (res) => {
      const allRules = res.rules || {};
      const list = (allRules[domain] || []).filter(r => CEE.isSafeSelector(r.selector));
      rulesCountEl.textContent = `(${list.length})`;

      if (list.length === 0) {
        rulesContainer.innerHTML = '<div class="empty-state">当前网站无额外规则，内置规则防护中</div>';
        return;
      }

      rulesContainer.innerHTML = '';
      list.forEach((r) => {
        const item = document.createElement('div');
        item.className = 'rule-item';
        item.innerHTML = `
          <div class="rule-details">
            <div class="rule-name">${CEE.escapeHtml(r.name)}</div>
            <div class="rule-selector">${CEE.escapeHtml(r.selector)}</div>
          </div>
          <button class="icon-btn" style="width:24px;height:24px;color:#f87171;" id="del-${CEE.escapeHtml(r.id)}" title="删除规则">✕</button>
        `;
        item.querySelector(`#del-${CSS.escape(r.id)}`).addEventListener('click', () => deleteRule(r.id));
        rulesContainer.appendChild(item);
      });
    });
  }

  function deleteRule(ruleId) {
    chrome.storage.local.get(['rules'], (res) => {
      const allRules = CEE.normalizeRules(res.rules || {});
      const list = allRules[domain] || [];
      const filtered = list.filter(r => r.id !== ruleId);
      if (filtered.length > 0) allRules[domain] = filtered;
      else delete allRules[domain];
      chrome.storage.local.set({ rules: allRules });
    });
  }

  // ---------- 事件绑定 ----------

  function bindEvents() {
    // 开启沉浸阅读
    btnOpenReader.addEventListener('click', () => {
      if (!activeTab || !activeTab.id) return;
      chrome.tabs.sendMessage(activeTab.id, { action: 'open-reader-mode' }, () => {
        window.close(); // 唤起后优雅关闭 popup
      });
    });

    // AI 深度提纯
    btnAiPurify.addEventListener('click', () => {
      if (!activeTab || !activeTab.id) return;
      chrome.tabs.sendMessage(activeTab.id, { action: 'open-reader-mode' }, () => {
        window.close();
      });
    });

    // 一键破壁
    btnGateBuster.addEventListener('click', () => {
      if (!activeTab || !activeTab.id) return;
      btnGateBuster.disabled = true;
      btnGateBuster.innerText = '🛡️ 破壁中...';
      chrome.tabs.sendMessage(activeTab.id, { action: 'trigger-gate-buster' }, (res) => {
        btnGateBuster.disabled = false;
        btnGateBuster.innerHTML = '<span style="font-size:14px;">🛡️</span><span>一键破壁</span>';
        const count = (res && res.count) || 0;
        alert(`🛡️ 破壁完成！已清除 ${count} 处知乎/CSDN/Cookie 遮罩或展开全文。`);
      });
    });

    // 元素点选
    btnPicker.addEventListener('click', () => {
      if (!activeTab || !activeTab.id) return;
      chrome.tabs.sendMessage(activeTab.id, { action: 'activate-picker' });
      window.close();
    });

    // 暂停/恢复当前站点
    btnToggleSite.addEventListener('click', () => {
      chrome.storage.local.get(['siteDisabled'], (res) => {
        const sd = res.siteDisabled || {};
        if (sd[domain]) delete sd[domain];
        else sd[domain] = true;
        chrome.storage.local.set({ siteDisabled: sd }, refreshSiteStatus);
      });
    });

    // 控制台按钮
    openOptionsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // 升级弹窗
    btnShowUpgrade.addEventListener('click', () => {
      upgradeModal.style.display = 'flex';
    });
    modalCloseBtn.addEventListener('click', () => {
      upgradeModal.style.display = 'none';
    });
    modalBuyLink.addEventListener('click', () => {
      chrome.tabs.create({ url: WAFFO_BUY_URL });
    });
    modalActivateBtn.addEventListener('click', handleActivate);
  }

  async function handleActivate() {
    const code = modalOrderId.value.trim().toUpperCase();
    if (!code) {
      alert('请输入您的 Waffo 订单号或买断激活码。');
      return;
    }
    modalActivateBtn.disabled = true;
    modalActivateBtn.textContent = '激活中...';

    try {
      const res = await CEE.fetchWithTimeout(VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ p_key: code })
      }, 15000);
      const data = await res.json();
      if (data.valid) {
        chrome.storage.local.set({
          isPro: true,
          activationCode: code,
          expiresAt: data.expires_at || null
        }, () => {
          alert('🎉 恭喜！Pro 终身买断版已成功激活，已解锁无限次 AI 提纯与导出！');
          upgradeModal.style.display = 'none';
          refreshQuotaUI();
        });
      } else {
        alert('❌ ' + (data.message || '无效或未支付的订单号，请检查后重试。'));
      }
    } catch (e) {
      alert('无法连接验证服务器，请检查网络后重试。');
    } finally {
      modalActivateBtn.disabled = false;
      modalActivateBtn.textContent = '激活';
    }
  }

  init();
});
