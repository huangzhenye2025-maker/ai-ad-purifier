// background.js - AI Ad Purifier Service Worker
// 职责：DNR 网络拦截开关同步、规则库安全清理与容量控制、隐藏数量角标
importScripts('shared.js');

const CEE = globalThis.CEE;
const RULESET_ID = 'ads';

// ---------- DNR 网络拦截开关（跟随全局开关） ----------

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
      console.warn('[AI Ad Purifier] DNR sync failed:', err && err.message);
    });
}

// ---------- 规则库安全清理 + 容量控制 ----------
// 每次 storage 变化都跑一遍：导入/点选/脚本写入的非法规则会被立刻清洗，
// 避免坏规则（如隐藏 body/#root）持续生效。

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

// ---------- 隐藏数量角标 ----------

chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });

chrome.runtime.onMessage.addListener(function (message, sender) {
  if (message && message.type === 'ad-stats' && sender.tab) {
    const n = Math.max(0, Math.min(9999, message.count || 0));
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: n > 0 ? String(n) : '' });
  }
});

// ---------- 生命周期 ----------

function initDefaults(callback) {
  chrome.storage.local.get(['globalEnabled', 'siteDisabled'], function (result) {
    const patch = {};
    if (result.globalEnabled === undefined) patch.globalEnabled = true;
    if (result.siteDisabled === undefined) patch.siteDisabled = {};
    if (Object.keys(patch).length > 0) {
      chrome.storage.local.set(patch, callback || function () {});
    } else if (callback) {
      callback();
    }
  });
}

function onStartup() {
  enforceStorageSanity();
  chrome.storage.local.get(['globalEnabled'], function (result) {
    syncDNR(result.globalEnabled !== false);
  });
}

chrome.runtime.onInstalled.addListener(function () {
  initDefaults(function () {
    chrome.storage.local.set({ isActivated: true }, function () {
      onStartup();
    });
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

// 启动即执行一次（service worker 冷启动）
initDefaults(onStartup);
