document.addEventListener('DOMContentLoaded', async () => {
  // Embedded / Packaged DeepSeek API Key for commercial deployment
  // Please replace this placeholder with your production DeepSeek API key when packaging the extension zip
  const DEEPSEEK_API_KEY = "YOUR_DEEPSEEK_API_KEY";

  const activationPanel = document.getElementById('activation-panel');
  const mainPanel = document.getElementById('main-panel');
  const activationCodeInput = document.getElementById('activation-code');
  const btnVerifyActivation = document.getElementById('btn-verify-activation');
  const btnWaffoBuy = document.getElementById('btn-waffo-buy');

  const aiCleanBtn = document.getElementById('ai-clean');
  const rulesContainer = document.getElementById('rules-container');
  const rulesCount = document.getElementById('rules-count');
  const currentDomainText = document.getElementById('current-domain');
  const openSettingsBtn = document.getElementById('open-settings');

  let activeTab = null;
  let domain = '';

  // 1. Activation Flow Check
  chrome.storage.local.get(['isActivated'], (result) => {
    if (result.isActivated === true) {
      mainPanel.style.display = 'flex';
      activationPanel.style.display = 'none';
      initApp();
    } else {
      mainPanel.style.display = 'none';
      activationPanel.style.display = 'flex';
    }
  });

  // Cloudflare Worker/Render API URL for license verification
  const CLOUD_VERIFY_URL = "https://ai-ad-purifier.onrender.com/verify";

  btnVerifyActivation.addEventListener('click', () => {
    const code = activationCodeInput.value.trim().toUpperCase();
    if (!code) {
      alert('Please enter your Waffo Order ID.');
      return;
    }

    if (!code.startsWith('ORD_')) {
      alert('Invalid format. Waffo Order ID usually starts with "ORD_" (e.g., ORD_7QH059...).');
      return;
    }
    
    btnVerifyActivation.disabled = true;
    btnVerifyActivation.textContent = 'Verifying...';

    // Call Cloudflare Worker/Render endpoint to verify Order ID
    fetch(CLOUD_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ key: code })
    })
    .then(res => {
      if (!res.ok) throw new Error('Server returned an error');
      return res.json();
    })
    .then(data => {
      if (data.valid) {
        chrome.storage.local.set({ isActivated: true, activationCode: code }, () => {
          alert('🎉 Activation successful! Thank you for supporting our extension.');
          activationPanel.style.display = 'none';
          mainPanel.style.display = 'flex';
          initApp();
        });
      } else {
        alert('❌ ' + (data.message || 'Invalid or unpaid Order ID. Please check your purchase receipt.'));
      }
    })
    .catch(err => {
      alert('Verification server error. Please check your network or try again later.');
    })
    .finally(() => {
      btnVerifyActivation.disabled = false;
      btnVerifyActivation.textContent = 'Activate';
    });
  });

  btnWaffoBuy.addEventListener('click', () => {
    // Open the Waffo payment URL in a new tab
    chrome.tabs.create({ url: 'https://pancake.waffo.ai/store/xmaker-studio-p7o0nfzy/product/PROD_0BT62Y3uxafpZyoOITOO7E?type=onetime&currency=USD&test=true' });
  });

  // 2. Initialize Main Cleaner Functions
  async function initApp() {
    // Query active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    activeTab = tabs[0];
    
    try {
      const url = new URL(activeTab.url);
      domain = url.hostname;
      currentDomainText.textContent = domain;

      if (url.protocol.startsWith('chrome') || url.protocol.startsWith('edge') || url.protocol === 'about:') {
        aiCleanBtn.disabled = true;
        aiCleanBtn.style.opacity = '0.5';
        aiCleanBtn.textContent = 'Not Supported';
        rulesContainer.innerHTML = '<div class="empty-state">Browser system pages cannot be cleaned.</div>';
        return;
      }
    } catch (e) {
      aiCleanBtn.disabled = true;
      aiCleanBtn.textContent = 'Invalid Page';
      rulesContainer.innerHTML = '<div class="empty-state">This page is not supported.</div>';
      return;
    }

    // Load rules for this domain
    function loadDomainRules() {
      chrome.storage.local.get(['rules'], (result) => {
        const allRules = result.rules || {};
        const domainRules = allRules[domain] || [];
        renderRules(domainRules);
      });
    }

    loadDomainRules();

    // Listen for storage changes to auto-reload rules reactive-style
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.rules) {
        loadDomainRules();
      }
    });

    // Render rules list
    function renderRules(rules) {
      rulesCount.textContent = `(${rules.length})`;
      if (rules.length === 0) {
        rulesContainer.innerHTML = '<div class="empty-state">No elements hidden on this site yet. Click the button above to clean!</div>';
        return;
      }

      rulesContainer.innerHTML = '';
      rules.forEach((rule) => {
        const item = document.createElement('div');
        item.className = 'rule-item';
        item.innerHTML = `
          <div class="rule-details">
            <div class="rule-name" title="${rule.name}">${rule.name}</div>
            <div class="rule-selector" title="${rule.selector}">${rule.selector}</div>
          </div>
          <div class="rule-actions">
            <label class="switch">
              <input type="checkbox" id="toggle-${rule.id}" ${rule.enabled !== false ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
            <button class="delete-btn" id="delete-${rule.id}" title="Restore element">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        `;

        // Event listener for toggle checkbox
        item.querySelector(`#toggle-${rule.id}`).addEventListener('change', (e) => {
          toggleRule(rule.id, e.target.checked);
        });

        // Event listener for delete button
        item.querySelector(`#delete-${rule.id}`).addEventListener('click', () => {
          deleteRule(rule.id);
        });

        rulesContainer.appendChild(item);
      });
    }

    // Toggle rule status
    function toggleRule(ruleId, enabled) {
      chrome.storage.local.get(['rules'], (result) => {
        const allRules = result.rules || {};
        const domainRules = allRules[domain] || [];
        const updated = domainRules.map(r => r.id === ruleId ? { ...r, enabled } : r);
        allRules[domain] = updated;
        chrome.storage.local.set({ rules: allRules });
      });
    }

    // Delete rule
    function deleteRule(ruleId) {
      chrome.storage.local.get(['rules'], (result) => {
        const allRules = result.rules || {};
        const domainRules = allRules[domain] || [];
        const filtered = domainRules.filter(r => r.id !== ruleId);
        allRules[domain] = filtered;
        chrome.storage.local.set({ rules: allRules });
      });
    }

    // AI Clean Button click
    aiCleanBtn.addEventListener('click', () => {
      aiCleanBtn.disabled = true;
      aiCleanBtn.textContent = '🤖 AI is analyzing page...';

      // Get simplified DOM from content script
      chrome.tabs.sendMessage(activeTab.id, { action: 'get-simplified-dom' }, (domResponse) => {
        if (chrome.runtime.lastError || !domResponse || domResponse.error) {
          alert('Failed to get page data. Please refresh and try again after the page fully loads.');
          aiCleanBtn.disabled = false;
          aiCleanBtn.textContent = '✨ AI One-Click Clean';
          return;
        }

        const domString = domResponse.dom;

        // Call DeepSeek Chat API with embedded key
        fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              {
                role: 'system',
                content: 'You are a professional web ad-blocking and layout-cleaning AI. Analyze the provided condensed web DOM to identify ads, sponsored content, promotion banners, and popups.\n[LAYOUT REQUIREMENT]:\nIf an ad element is wrapped inside a layout grid cell or parent item (such as ytd-rich-item-renderer, li, or container div), you MUST prefer using CSS `:has()` relational selector to target and hide the outermost cell grid. Example: `ytd-rich-item-renderer:has(ytd-ad-slot-renderer)` or `ytd-rich-item-renderer:has(ytd-display-ad-renderer)`. This ensures that the browser automatically performs native grid reflow and collapses any layout empty spaces!\nReturn ONLY a JSON array containing these selectors. Example: ["ytd-rich-item-renderer:has(ytd-ad-slot-renderer)", "#sponsor-banner"]\nNever wrap the output in markdown code blocks like ```json. Do not include any intro or outro explanation text.'
              },
              {
                role: 'user',
                content: `Hostname: ${domain}. Condensed DOM:\n${domString}`
              }
            ],
            temperature: 0.1
          })
        })
        .then(response => {
          if (!response.ok) {
            throw new Error(`API connection failed (HTTP ${response.status}).`);
          }
          return response.json();
        })
        .then(data => {
          let content = data.choices[0].message.content.trim();
          
          const arrayMatch = content.match(/\[\s*[\s\S]*?\s*\]/);
          if (arrayMatch) {
            content = arrayMatch[0];
          }

          const selectors = JSON.parse(content);
          if (!Array.isArray(selectors)) {
            throw new Error('Response format is not an array.');
          }

          if (selectors.length === 0) {
            alert('🤖 AI analysis completed. No obvious ad elements found on this page.');
            aiCleanBtn.disabled = false;
            aiCleanBtn.textContent = '✨ AI One-Click Clean';
            return;
          }

          // Save selectors to rules
          chrome.storage.local.get(['rules'], (rulesResult) => {
            const allRules = rulesResult.rules || {};
            const domainRules = allRules[domain] || [];

            let addedCount = 0;
            selectors.forEach((sel, index) => {
              if (!domainRules.some(r => r.selector === sel)) {
                domainRules.push({
                  id: 'rule_ai_' + Date.now() + '_' + index,
                  name: `AI Clean Block #${index + 1}`,
                  selector: sel,
                  enabled: true,
                  date: new Date().toLocaleDateString()
                });
                addedCount++;
              }
            });

            if (addedCount > 0) {
              allRules[domain] = domainRules;
              chrome.storage.local.set({ rules: allRules }, () => {
                alert(`🤖 AI Clean Complete! Blocked ${addedCount} ad elements.`);
                loadDomainRules();
              });
            } else {
              alert('🤖 AI detected ads have already been cleaned.');
            }

            aiCleanBtn.disabled = false;
            aiCleanBtn.textContent = '✨ AI One-Click Clean';
          });
        })
        .catch(err => {
          alert('AI purification service is currently unavailable. Please try again later.');
          aiCleanBtn.disabled = false;
          aiCleanBtn.textContent = '✨ AI One-Click Clean';
        });
      });
    });
  }

  // Open options dashboard
  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
