// options.js - AI Ad Purifier / AI 深度阅读与提纯助手 控制台逻辑
document.addEventListener('DOMContentLoaded', () => {
  const CEE = globalThis.CEE;

  const toggleGateBuster = document.getElementById('toggle-gate-buster');
  const toggleEnableCopy = document.getElementById('toggle-enable-copy');
  const toggleCapsule = document.getElementById('toggle-capsule');

  const selectTheme = document.getElementById('select-theme');
  const selectFont = document.getElementById('select-font');
  const selectWidth = document.getElementById('select-width');

  const inputApiKey = document.getElementById('input-api-key');
  const inputApiEndpoint = document.getElementById('input-api-endpoint');
  const btnSaveAi = document.getElementById('btn-save-ai');

  const licenseStatusText = document.getElementById('license-status-text');
  const btnOptionsBuy = document.getElementById('btn-options-buy');
  const inputLicenseCode = document.getElementById('input-license-code');
  const btnOptionsActivate = document.getElementById('btn-options-activate');

  const rulesTableContainer = document.getElementById('rules-table-container');
  const btnExportRules = document.getElementById('btn-export-rules');
  const btnImportRules = document.getElementById('btn-import-rules');
  const fileImport = document.getElementById('file-import');
  const btnClearAll = document.getElementById('btn-clear-all');

  const WAFFO_BUY_URL = 'https://pancake.waffo.ai/store/xmaker-studio-p7o0nfzy/product/PROD_0BT62Y3uxafpZyoOITOO7E?type=product&currency=USD';
  const SUPABASE_URL = 'https://emsdrhllxuorcaxbejtw.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_MIUNy-qIOpOrcjGOYVqRFA_tzo0qgnB';
  const VERIFY_URL = SUPABASE_URL + '/rest/v1/rpc/verify_license';

  // ---------- 1. 加载所有设置 ----------

  function loadSettings() {
    chrome.storage.local.get([
      'autoGateBuster', 'enableCopy', 'showFloatingCapsule',
      'readerTheme', 'readerFontFamily', 'readerWidth',
      'customApiKey', 'customApiEndpoint',
      'isPro', 'activationCode', 'rules'
    ], (res) => {
      // 破壁设置
      toggleGateBuster.checked = res.autoGateBuster !== false;
      toggleEnableCopy.checked = res.enableCopy !== false;
      toggleCapsule.checked = res.showFloatingCapsule !== false;

      // 阅读器设置
      if (res.readerTheme) selectTheme.value = res.readerTheme;
      if (res.readerFontFamily) selectFont.value = res.readerFontFamily;
      if (res.readerWidth) selectWidth.value = res.readerWidth;

      // AI 配置
      if (res.customApiKey) inputApiKey.value = res.customApiKey;
      if (res.customApiEndpoint) inputApiEndpoint.value = res.customApiEndpoint;

      // 授权状态
      if (res.isPro) {
        licenseStatusText.innerHTML = '👑 <b style="color:#a5b4fc;">Pro 终身买断版已激活</b>（AI 精华提纯已解锁）';
        btnOptionsBuy.style.display = 'none';
      } else {
        licenseStatusText.innerHTML = '🌱 <b>免费版</b>（AI 精华提纯为 Pro 专属，去广告 / 破壁 / 阅读 / 导出全免费）';
        btnOptionsBuy.style.display = 'inline-flex';
      }

      // 渲染规则表格
      renderRulesTable(res.rules || {});
    });
  }

  // ---------- 2. 绑定设置变化 ----------

  toggleGateBuster.addEventListener('change', (e) => {
    chrome.storage.local.set({ autoGateBuster: e.target.checked });
  });
  toggleEnableCopy.addEventListener('change', (e) => {
    chrome.storage.local.set({ enableCopy: e.target.checked });
  });
  toggleCapsule.addEventListener('change', (e) => {
    chrome.storage.local.set({ showFloatingCapsule: e.target.checked });
  });

  selectTheme.addEventListener('change', (e) => {
    chrome.storage.local.set({ readerTheme: e.target.value });
  });
  selectFont.addEventListener('change', (e) => {
    chrome.storage.local.set({ readerFontFamily: e.target.value });
  });
  selectWidth.addEventListener('change', (e) => {
    chrome.storage.local.set({ readerWidth: e.target.value });
  });

  const btnTestAi = document.getElementById('btn-test-ai');

  btnSaveAi.addEventListener('click', () => {
    const key = inputApiKey.value.trim();
    const endpoint = inputApiEndpoint.value.trim();
    chrome.storage.local.set({
      customApiKey: key,
      customApiEndpoint: endpoint
    }, () => {
      alert('💾 AI 配置已成功保存！');
    });
  });

  if (btnTestAi) {
    btnTestAi.addEventListener('click', async () => {
      const key = inputApiKey.value.trim();
      const endpoint = inputApiEndpoint.value.trim() || 'https://api.deepseek.com/chat/completions';
      if (!key) {
        alert('⚠️ 请先输入您的 DeepSeek / OpenAI API Key 再进行测试。');
        return;
      }
      btnTestAi.disabled = true;
      btnTestAi.textContent = '⏳ 测试中...';
      try {
        const res = await CEE.fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5
          })
        }, 12000);
        if (res.ok) {
          alert('🎉 恭喜！API Key 连接测试成功，DeepSeek 大模型已就绪！');
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg = (errData.error && errData.error.message) || `HTTP ${res.status}`;
          alert(`❌ 连接失败: ${errMsg}。\n请确认 Key 是否正确或账户是否有可用余额。`);
        }
      } catch (err) {
        alert(`❌ 连接异常: ${err.message}。\n请检查网络连接或接口端点。`);
      } finally {
        btnTestAi.disabled = false;
        btnTestAi.textContent = '🧪 测试连接';
      }
    });
  }

  // ---------- 3. 购买与激活 ----------

  btnOptionsBuy.addEventListener('click', () => {
    chrome.tabs.create({ url: WAFFO_BUY_URL });
  });

  btnOptionsActivate.addEventListener('click', async () => {
    const code = inputLicenseCode.value.trim().toUpperCase();
    if (!code) {
      alert('请输入您的订单号或买断激活码。');
      return;
    }
    btnOptionsActivate.disabled = true;
    btnOptionsActivate.textContent = '激活中...';

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
          alert('🎉 恭喜！Pro 终身买断版已成功激活！');
          loadSettings();
        });
      } else {
        alert('❌ ' + (data.message || '无效或未支付的订单号。'));
      }
    } catch (e) {
      alert('连接验证服务器失败，请检查网络。');
    } finally {
      btnOptionsActivate.disabled = false;
      btnOptionsActivate.textContent = '激活';
    }
  });

  // ---------- 4. 规则管理与导入导出 ----------

  function renderRulesTable(rules) {
    const domains = Object.keys(rules);
    if (domains.length === 0) {
      rulesTableContainer.innerHTML = '<div style="text-align:center;padding:20px;color:#64748b;">暂无自定义规则</div>';
      return;
    }

    let rowsHtml = '';
    domains.forEach((dom) => {
      const list = rules[dom] || [];
      list.forEach((r) => {
        rowsHtml += `
          <tr>
            <td style="font-family:monospace;color:#a5b4fc;">${CEE.escapeHtml(dom)}</td>
            <td>${CEE.escapeHtml(r.name)}</td>
            <td style="font-family:monospace;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${CEE.escapeHtml(r.selector)}">${CEE.escapeHtml(r.selector)}</td>
            <td>
              <button class="btn btn-outline" style="padding:4px 8px;font-size:11px;color:#ef4444;" data-dom="${CEE.escapeHtml(dom)}" data-id="${CEE.escapeHtml(r.id)}">删除</button>
            </td>
          </tr>
        `;
      });
    });

    rulesTableContainer.innerHTML = `
      <table class="rules-table">
        <thead>
          <tr>
            <th>域名</th>
            <th>规则名称</th>
            <th>CSS 选择器</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;

    // 绑定删除
    rulesTableContainer.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.onclick = () => {
        const dom = btn.dataset.dom;
        const id = btn.dataset.id;
        chrome.storage.local.get(['rules'], (res) => {
          const allRules = CEE.normalizeRules(res.rules || {});
          const list = allRules[dom] || [];
          const filtered = list.filter(r => r.id !== id);
          if (filtered.length > 0) allRules[dom] = filtered;
          else delete allRules[dom];
          chrome.storage.local.set({ rules: allRules }, () => renderRulesTable(allRules));
        });
      };
    });
  }

  // 导出
  btnExportRules.addEventListener('click', () => {
    chrome.storage.local.get(['rules'], (res) => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(res.rules || {}, null, 2));
      const a = document.createElement('a');
      a.href = dataStr;
      a.download = `ai_ad_purifier_rules_${Date.now()}.json`;
      a.click();
    });
  });

  // 导入
  btnImportRules.addEventListener('click', () => fileImport.click());
  fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        chrome.storage.local.get(['rules'], (res) => {
          const current = res.rules || {};
          const merged = Object.assign({}, current, imported);
          const normalized = CEE.normalizeRules(merged);
          chrome.storage.local.set({ rules: normalized }, () => {
            alert('📥 规则已成功导入并合并！');
            loadSettings();
          });
        });
      } catch (err) {
        alert('导入失败：非有效 JSON 格式。');
      }
    };
    reader.readAsText(file);
  });

  // 清空
  btnClearAll.addEventListener('click', () => {
    if (confirm('确定要清空所有自定义规则吗？内置通用规则仍将继续生效。')) {
      chrome.storage.local.set({ rules: {} }, () => {
        loadSettings();
      });
    }
  });

  loadSettings();
});
