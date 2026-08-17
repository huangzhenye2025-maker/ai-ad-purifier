// background.js - AI Ad Purifier / AI 深度阅读与提纯助手 Service Worker
// 职责：DNR 网络拦截开关、规则库安全清洗与容量控制、角标与快捷右键菜单
importScripts('shared.js');

const CEE = globalThis.CEE;
const RULESET_ID = 'ads';

// ---------- 1. DNR 网络拦截开关 ----------

function syncDNR(enabled) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.getEnabledRulesets) return;
  chrome.declarativeNetRequest.getEnabledRulesets()
    .then(function (ids) {
      const has = ids.includes(RULESET_ID);
      if (enabled && !has) {
        return chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: [RULESET_ID],
          disableRulesetIds: []
        });
      }
      if (!enabled && has) {
        return chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: [],
          disableRulesetIds: [RULESET_ID]
        });
      }
    })
    .catch(function (err) {
      console.warn('[AI Purifier] DNR sync failed:', err && err.message);
    });
}

// ---------- 2. 规则库安全清理与容量控制 ----------

function enforceStorageSanity() {
  chrome.storage.local.get(['rules'], function (result) {
    const cleaned = CEE.normalizeRules(result.rules || {});
    const before = JSON.stringify(result.rules || {});
    const after = JSON.stringify(cleaned);
    if (before !== after) {
      chrome.storage.local.set({ rules: cleaned }, function () {});
    }
  });
}

// ---------- 3. 消息与角标处理 ----------

chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });

chrome.runtime.onMessage.addListener(function (message, sender) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'ad-stats' && sender.tab) {
    const n = Math.max(0, Math.min(9999, message.count || 0));
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: n > 0 ? String(n) : '' });
  }

  if (message.action === 'open-options') {
    chrome.runtime.openOptionsPage();
  }
});

// ---------- 4. 右键快捷菜单 (Context Menus) ----------

function setupContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cee-menu-reader',
      title: '📖 开启沉浸阅读模式 (AI Reader)',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'cee-menu-gate-buster',
      title: '🛡️ 一键破除遮罩与限制 (Gate Buster)',
      contexts: ['page']
    });
  });
}

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || !tab.id) return;
    if (info.menuItemId === 'cee-menu-reader') {
      chrome.tabs.sendMessage(tab.id, { action: 'open-reader-mode' });
    } else if (info.menuItemId === 'cee-menu-gate-buster') {
      chrome.tabs.sendMessage(tab.id, { action: 'trigger-gate-buster' });
    }
  });
}

// ---------- 5. 生命周期与初始化 ----------

function initDefaults(callback) {
  chrome.storage.local.get(['globalEnabled', 'siteDisabled', 'autoGateBuster', 'showFloatingCapsule'], function (result) {
    const patch = {};
    if (result.globalEnabled === undefined) patch.globalEnabled = true;
    if (result.siteDisabled === undefined) patch.siteDisabled = {};
    if (result.autoGateBuster === undefined) patch.autoGateBuster = true;
    if (result.showFloatingCapsule === undefined) patch.showFloatingCapsule = true;
    if (Object.keys(patch).length > 0) {
      chrome.storage.local.set(patch, callback || function () {});
    } else if (callback) {
      callback();
    }
  });
}

function onStartup() {
  enforceStorageSanity();
  setupContextMenus();
  chrome.storage.local.get(['globalEnabled'], function (result) {
    syncDNR(result.globalEnabled !== false);
  });
}

chrome.runtime.onInstalled.addListener(function () {
  initDefaults(function () {
    onStartup();
  });
});

chrome.runtime.onStartup.addListener(onStartup);

chrome.storage.onChanged.addListener(function (changes) {
  if (changes.rules) {
    enforceStorageSanity();
  }
  if (changes.globalEnabled) {
    syncDNR(changes.globalEnabled.newValue !== false);
  }
});

initDefaults(onStartup);
