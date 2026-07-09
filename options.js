document.addEventListener('DOMContentLoaded', () => {
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

  let allRules = {};
  let selectedDomain = '';

  // Initialize
  loadSettings();

  // 1. Load data from local storage
  function loadSettings() {
    chrome.storage.local.get(['rules', 'globalEnabled'], (result) => {
      allRules = result.rules || {};
      const globalEnabled = result.globalEnabled !== false;
      
      // Update global toggle state
      globalToggle.checked = globalEnabled;
      updateGlobalStatusText(globalEnabled);
      
      // Calculate Stats
      updateStats();
      
      // Render Domain list
      renderDomainList();
      
      // If a domain was already selected, refresh its rules. Otherwise select the first one.
      const domains = Object.keys(allRules).filter(dom => allRules[dom] && allRules[dom].length > 0);
      if (domains.length > 0) {
        if (!selectedDomain || !domains.includes(selectedDomain)) {
          selectedDomain = domains[0];
        }
        selectDomain(selectedDomain);
      } else {
        panelDomainTitle.textContent = 'No configurations yet';
        panelDomainDesc.textContent = 'Visit websites and click the extension icon to start blocking ad elements!';
        tableBody.innerHTML = `<tr><td colspan="5" class="no-rules-state">No blocking rules configured yet.</td></tr>`;
      }
    });
  }

  function updateGlobalStatusText(enabled) {
    if (enabled) {
      globalStatusText.textContent = 'Enabled';
      globalStatusText.style.color = 'var(--color-success)';
    } else {
      globalStatusText.textContent = 'Disabled';
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
      domainListContainer.innerHTML = `<div style="font-size:13px; color:var(--text-muted); padding: 8px;">No active domains</div>`;
      return;
    }
    
    domains.sort().forEach(dom => {
      const item = document.createElement('div');
      item.className = `domain-item ${dom === selectedDomain ? 'active' : ''}`;
      item.innerHTML = `
        <span>${dom}</span>
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
    panelDomainDesc.textContent = `Manage blocking rules for this website. Double click text fields to rename rule or edit CSS selector directly.`;
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
      tableBody.innerHTML = `<tr><td colspan="5" class="no-rules-state">No matching rules found.</td></tr>`;
      return;
    }

    filteredRules.forEach((rule) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="rule-name-cell" id="name-${rule.id}" title="Double click to edit name">${escapeHtml(rule.name)}</td>
        <td class="rule-selector-cell" id="selector-${rule.id}" title="Double click to edit selector">${escapeHtml(rule.selector)}</td>
        <td class="rule-date-cell">${rule.date || 'Unknown'}</td>
        <td>
          <label class="switch">
            <input type="checkbox" id="toggle-${rule.id}" ${rule.enabled !== false ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </td>
        <td class="actions-cell">
          <button class="action-btn delete" id="delete-${rule.id}" title="Delete rule">
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
          // Simple validation test for selector format syntax
          document.querySelector(newValue);
        } catch (e) {
          alert('Invalid CSS selector format. Please verify the syntax and try again.');
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
    if (!confirm('Are you sure you want to delete this ad-blocking rule?')) return;
    
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
          throw new Error('JSON format does not match rule export structure.');
        }
        
        if (confirm('Are you sure you want to import these rules? They will be merged with your existing configuration.')) {
          // Merge imported rules with current rules
          chrome.storage.local.get(['rules'], (result) => {
            const currentRules = result.rules || {};
            
            for (const domain in imported) {
              if (Array.isArray(imported[domain])) {
                if (!currentRules[domain]) {
                  currentRules[domain] = [];
                }
                
                imported[domain].forEach(importedRule => {
                  // Avoid duplicating exact selectors in the same domain
                  if (!currentRules[domain].some(r => r.selector === importedRule.selector)) {
                    currentRules[domain].push({
                      id: importedRule.id || 'rule_' + Date.now() + Math.random().toString(36).substr(2, 5),
                      name: importedRule.name || 'Imported Rule',
                      selector: importedRule.selector,
                      enabled: importedRule.enabled !== false,
                      date: importedRule.date || new Date().toLocaleDateString()
                    });
                  }
                });
              }
            }

            chrome.storage.local.set({ rules: currentRules }, () => {
              alert('Configuration imported successfully!');
              loadSettings();
            });
          });
        }
      } catch (err) {
        alert('Failed to parse backup file: ' + err.message);
      }
      fileInput.value = ''; // Reset file input
    };
    reader.readAsText(file);
  });

  // Clear all rules completely
  btnClearAll.addEventListener('click', () => {
    if (confirm('⚠️ Warning: This will permanently delete all of your ad blocking rules. This action cannot be undone! Proceed?')) {
      chrome.storage.local.set({ rules: {} }, () => {
        selectedDomain = '';
        loadSettings();
        alert('All ad-blocking rules have been cleared.');
      });
    }
  });

  // Helper utility to sanitize HTML output
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
