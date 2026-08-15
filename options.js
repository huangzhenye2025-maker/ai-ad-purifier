// options.js - AI Ad Purifier 控制面板 (支持 Chrome i18n 多语言)
document.addEventListener('DOMContentLoaded', () => {
  const CEE = globalThis.CEE;

  const globalToggle = document.getElementById('global-toggle');
  const globalStatusText = document.getElementById('global-status-text');
  
  const statDomains = document.getElementById('stat-domains');
  const statElements = document.getElementById('stat-elements');
  
  const domainListContainer = document.getElementById('domain-list-container');
  
  const panelDomainTitle = document.getElementById('panel-domain-title');
  const panelDomainDesc = document.getElementById('panel-domain-desc');
  const searchInput = document.getElementById('search-rules');
  const tableBody = document.getElementById('rules-table-body');
  
  const fileInput = document.getElementById('import-file');
  const btnExport = document.getElementById('btn-export');
  const btnClearAll = document.getElementById('btn-clear-all');
  const btnImport = document.getElementById('btn-import');
  const whitelistContainer = document.getElementById('whitelist-container');

  let allRules = {};
  let siteDisabled = {};
  let selectedDomain = '';

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
  loadSettings();

  // 1. Load data from local storage
  function loadSettings() {
    chrome.storage.local.get(['rules', 'globalEnabled', 'isPro', 'siteDisabled'], (result) => {
      allRules = CEE.normalizeRules(result.rules || {});
      // 归一化（合并 www、去重、容量上限）后若与存储不一致，回写以自愈
      if (JSON.stringify(allRules) !== JSON.stringify(result.rules || {})) {
        chrome.storage.local.set({ rules: allRules });
      }
      siteDisabled = result.siteDisabled || {};
      const globalEnabled = result.globalEnabled !== false;
      const isPro = result.isPro === true;
      
      // Update global toggle state
      globalToggle.checked = globalEnabled;
      updateGlobalStatusText(globalEnabled);
      
      // Update plan status badge
      const statPlanStatus = document.getElementById('stat-plan-status');
      const btnUpgradeOptions = document.getElementById('btn-upgrade-options');
      if (statPlanStatus) {
        if (isPro) {
          statPlanStatus.innerHTML = `👑 <b>${t('planPro', '👑 Pro Edition')}</b>`;
          statPlanStatus.style.color = '#818cf8';
          if (btnUpgradeOptions) btnUpgradeOptions.style.display = 'none';
        } else {
          statPlanStatus.innerHTML = `${t('planFree', '🌱 Free Edition (Standard Shield)')}`;
          statPlanStatus.style.color = '#a5b4fc';
          if (btnUpgradeOptions) btnUpgradeOptions.style.display = 'inline-block';
        }
      }
      
      // Calculate Stats
      updateStats();
      
      // Render Domain list
      renderDomainList();

      // Render paused-site whitelist
      renderWhitelist();
      
      // If a domain was already selected, refresh its rules. Otherwise select the first one.
      const domains = Object.keys(allRules).filter(dom => allRules[dom] && allRules[dom].length > 0);
      if (domains.length > 0) {
        if (!selectedDomain || !domains.includes(selectedDomain)) {
          selectedDomain = domains[0];
        }
        selectDomain(selectedDomain);
      } else {
        panelDomainTitle.textContent = t('panelNoSitesTitle', 'No websites configured yet');
        panelDomainDesc.textContent = t('panelNoSitesDesc', 'Browse the web and click the extension icon to start blocking ads!');
        tableBody.innerHTML = `<tr><td colspan="5" class="no-rules-state">${escapeHtml(t('noRulesConfigured', 'No ad blocking rules configured yet.'))}</td></tr>`;
      }
    });
  }

  const btnUpgradeOptions = document.getElementById('btn-upgrade-options');
  if (btnUpgradeOptions) {
    btnUpgradeOptions.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://pancake.waffo.ai/store/xmaker-studio-p7o0nfzy/product/PROD_0BT62Y3uxafpZyoOITOO7E?type=subscription&currency=USD' });
    });
  }

  function updateGlobalStatusText(enabled) {
    if (enabled) {
      globalStatusText.textContent = t('statusEnabled', 'Enabled');
      globalStatusText.style.color = 'var(--color-success)';
    } else {
      globalStatusText.textContent = t('statusDisabled', 'Disabled');
      globalStatusText.style.color = 'var(--color-accent)';
    }
  }

  function updateStats() {
    const domains = Object.keys(allRules).filter(dom => allRules[dom] && allRules[dom].length > 0);
    const domainCount = domains.length;
    let elementCount = 0;
    domains.forEach(dom => {
      elementCount += allRules[dom].length;
    });
    
    statDomains.textContent = domainCount;
    statElements.textContent = elementCount;
  }

  // 2. Render Left Sidebar of Domains
  function renderDomainList() {
    domainListContainer.innerHTML = '';
    const domains = Object.keys(allRules).filter(dom => allRules[dom] && allRules[dom].length > 0);
    
    if (domains.length === 0) {
      domainListContainer.innerHTML = `<div style="font-size:13px; color:var(--text-muted); padding: 8px;">${escapeHtml(t('noActiveDomains', 'No active domains'))}</div>`;
      return;
    }
    
    domains.sort().forEach(dom => {
      const item = document.createElement('div');
      item.className = `domain-item ${dom === selectedDomain ? 'active' : ''}`;
      item.innerHTML = `
        <span>${escapeHtml(dom)}</span>
        <span class="domain-badge">${allRules[dom].length}</span>
      `;
      item.addEventListener('click', () => {
        selectDomain(dom);
      });
      domainListContainer.appendChild(item);
    });
  }

  // 3. Select Domain & Display Rules
  function selectDomain(dom) {
    selectedDomain = dom;
    
    // Highlight sidebar item
    document.querySelectorAll('.domain-item').forEach(item => {
      item.classList.remove('active');
      if (item.querySelector('span').textContent === dom) {
        item.classList.add('active');
      }
    });

    panelDomainTitle.textContent = dom;
    panelDomainDesc.textContent = t('panelDefaultDesc', 'Click on a website from the sidebar to inspect blocking rules. Double click rule name or selector to edit directly.');
    renderRulesTable();
  }

  // 4. Render Table Rules
  function renderRulesTable() {
    const rules = allRules[selectedDomain] || [];
    const query = searchInput.value.toLowerCase().trim();
    
    const filteredRules = rules.filter(rule => {
      return rule.name.toLowerCase().includes(query) || 
             rule.selector.toLowerCase().includes(query);
    });

    tableBody.innerHTML = '';

    if (filteredRules.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="5" class="no-rules-state">${escapeHtml(t('noMatchingRules', 'No matching rules found.'))}</td></tr>`;
      return;
    }

    filteredRules.forEach((rule) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="rule-name-cell" id="name-${rule.id}" title="Double click to edit name">${escapeHtml(rule.name)}</td>
        <td class="rule-selector-cell" id="selector-${rule.id}" title="Double click to edit selector">${escapeHtml(rule.selector)}</td>
        <td class="rule-date-cell">${escapeHtml(rule.date || 'Unknown')}</td>
        <td>
          <label class="switch">
            <input type="checkbox" id="toggle-${rule.id}" ${rule.enabled !== false ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </td>
        <td class="actions-cell">
          <button class="action-btn delete" id="delete-${rule.id}" title="${escapeHtml(t('restoreHiddenElement', 'Delete rule'))}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </td>
      `;

      // Double-click to Edit Name
      const nameCell = tr.querySelector(`#name-${rule.id}`);
      nameCell.addEventListener('dblclick', () => makeEditable(nameCell, rule.id, 'name', rule.name));

      // Double-click to Edit Selector
      const selectorCell = tr.querySelector(`#selector-${rule.id}`);
      selectorCell.addEventListener('dblclick', () => makeEditable(selectorCell, rule.id, 'selector', rule.selector));

      // Switch status Toggle
      tr.querySelector(`#toggle-${rule.id}`).addEventListener('change', (e) => {
        toggleRule(rule.id, e.target.checked);
      });

      // Delete rule button
      tr.querySelector(`#delete-${rule.id}`).addEventListener('click', () => {
        deleteRule(rule.id);
      });

      tableBody.appendChild(tr);
    });
  }

  // 5. In-Place Inline Editor
  function makeEditable(cell, ruleId, field, currentValue) {
    if (cell.querySelector('input')) return; // Already editing
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
    
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();

    const saveChanges = () => {
      const newValue = input.value.trim();
      if (!newValue) {
        cell.textContent = currentValue; // Revert if blank
        return;
      }

      // If editing selector, perform validation
      if (field === 'selector') {
        try {
          if (!CEE.isSafeSelector(newValue)) {
            throw new Error('Unsafe selector');
          }
          document.querySelector(newValue);
        } catch (e) {
          alert(t('invalidSelectorAlert', 'Invalid CSS selector format. Please verify the syntax and try again.'));
          cell.textContent = currentValue; // Revert
          return;
        }
      }

      if (newValue !== currentValue) {
        updateRuleProperty(ruleId, field, newValue);
      } else {
        cell.textContent = currentValue;
      }
    };

    // Events
    input.addEventListener('blur', saveChanges);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveChanges();
      } else if (e.key === 'Escape') {
        cell.textContent = currentValue; // Cancel
      }
    });
  }

  function updateRuleProperty(ruleId, field, value) {
    const rules = allRules[selectedDomain] || [];
    const updated = rules.map(r => r.id === ruleId ? { ...r, [field]: value } : r);
    allRules[selectedDomain] = updated;
    saveRulesToStorage();
  }

  function toggleRule(ruleId, enabled) {
    const rules = allRules[selectedDomain] || [];
    const updated = rules.map(r => r.id === ruleId ? { ...r, enabled } : r);
    allRules[selectedDomain] = updated;
    saveRulesToStorage();
  }

  function deleteRule(ruleId) {
    if (!confirm(t('confirmDeleteRule', 'Are you sure you want to delete this ad-blocking rule?'))) return;
    
    const rules = allRules[selectedDomain] || [];
    const filtered = rules.filter(r => r.id !== ruleId);
    
    if (filtered.length === 0) {
      delete allRules[selectedDomain];
      selectedDomain = ''; // Reset selected domain if deleted last rule
    } else {
      allRules[selectedDomain] = filtered;
    }
    
    saveRulesToStorage();
  }

  function saveRulesToStorage() {
    chrome.storage.local.set({ rules: allRules }, () => {
      loadSettings(); // Reload everything to sync values
    });
  }

  // 6. Global Switch & Search Events
  globalToggle.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    chrome.storage.local.set({ globalEnabled: enabled }, () => {
      updateGlobalStatusText(enabled);
    });
  });

  searchInput.addEventListener('input', renderRulesTable);

  // 7. Backup and Restore Actions

  // Export Rules to JSON file
  btnExport.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allRules, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `ai-ad-purifier-backup.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // Trigger file upload when clicking Import button
  btnImport.addEventListener('click', () => {
    fileInput.click();
  });

  // Read uploaded JSON file and import rules
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        
        // Simple structural validation
        if (typeof imported !== 'object' || Array.isArray(imported)) {
          throw new Error(t('importFormatError', 'JSON format does not match rule export structure.'));
        }
        
        if (confirm(t('confirmImport', 'Are you sure you want to import these rules? They will be merged with your existing configuration.'))) {
          // Merge imported rules with current rules
          chrome.storage.local.get(['rules'], (result) => {
            let currentRules = CEE.normalizeRules(result.rules || {});
            
            for (const domain in imported) {
              if (Array.isArray(imported[domain])) {
                if (!currentRules[domain]) {
                  currentRules[domain] = [];
                }
                
                imported[domain].forEach(importedRule => {
                  // 安全过滤：非法/危险选择器一律丢弃（防止导入隐藏 body/#root 的坏规则）
                  if (!importedRule || typeof importedRule.selector !== 'string') return;
                  const sel = importedRule.selector.trim();
                  if (!CEE.isSafeSelector(sel)) return;

                  // Avoid duplicating exact selectors in the same domain
                  if (!currentRules[domain].some(r => r.selector === sel)) {
                    // 重新生成 ID，避免与现有规则冲突或包含非法字符
                    currentRules[domain].push({
                      id: CEE.makeRuleId('rule_imp_'),
                      name: importedRule.name || 'Imported Rule',
                      selector: sel,
                      enabled: importedRule.enabled !== false,
                      date: importedRule.date || new Date().toLocaleDateString(),
                      ts: Date.now()
                    });
                  }
                });
              }
            }

            // 容量上限归一化（每域/总数/域名合并 www）
            currentRules = CEE.normalizeRules(currentRules);

            chrome.storage.local.set({ rules: currentRules }, () => {
              alert(t('importSuccess', 'Configuration imported successfully!'));
              loadSettings();
            });
          });
        }
      } catch (err) {
        alert(t('importParseError', 'Failed to parse backup file: ') + err.message);
      }
      fileInput.value = ''; // Reset file input
    };
    reader.readAsText(file);
  });

  // Clear all rules completely
  btnClearAll.addEventListener('click', () => {
    if (confirm(t('confirmClearAll', '⚠️ Warning: This will permanently delete all of your ad blocking rules. This action cannot be undone! Proceed?'))) {
      chrome.storage.local.set({ rules: {} }, () => {
        selectedDomain = '';
        loadSettings();
        alert(t('allRulesCleared', 'All ad-blocking rules have been cleared.'));
      });
    }
  });

  // Open Chrome Web Store review page
  const btnRateStoreOptions = document.getElementById('btn-rate-store-options');
  if (btnRateStoreOptions) {
    btnRateStoreOptions.addEventListener('click', () => {
      const extensionId = chrome.runtime.id;
      const storeReviewUrl = `https://chromewebstore.google.com/detail/${extensionId}`;
      chrome.tabs.create({ url: storeReviewUrl });
    });
  }

  // ---------- 暂停站点（白名单）管理 ----------
  function renderWhitelist() {
    if (!whitelistContainer) return;
    const domains = Object.keys(siteDisabled).sort();
    if (domains.length === 0) {
      whitelistContainer.innerHTML = `<div class="no-rules-state" style="padding:16px !important;margin:0;">${escapeHtml(t('whitelistEmpty', "No paused websites. Click 'Pause on Site' in the popup to whitelist a website."))}</div>`;
      return;
    }
    whitelistContainer.innerHTML = '';
    domains.forEach(dom => {
      const item = document.createElement('div');
      item.className = 'whitelist-item';
      item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 12px;border:1px solid var(--border-color);border-radius:8px;background:rgba(0,0,0,0.1);';
      item.innerHTML = `
        <span style="font-family:monospace;font-size:12px;color:var(--text-secondary);word-break:break-all;">${CEE.escapeHtml(dom)}</span>
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;white-space:nowrap;" data-whitelist-remove="${CEE.escapeHtml(dom)}">${escapeHtml(t('resumeCleanBtn', 'Resume Shield'))}</button>
      `;
      whitelistContainer.appendChild(item);
    });
    whitelistContainer.querySelectorAll('[data-whitelist-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        delete siteDisabled[btn.dataset.whitelistRemove];
        chrome.storage.local.set({ siteDisabled }, renderWhitelist);
      });
    });
  }

  // Helper utility to sanitize HTML output
  function escapeHtml(str) {
    return CEE.escapeHtml(str);
  }
});
