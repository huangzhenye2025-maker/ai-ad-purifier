(function() {
  const domain = window.location.hostname;
  let styleElement = null;

  // 1. Load and apply existing CSS rules to prevent flicker on load
  function injectSavedRules() {
    chrome.storage.local.get(['rules', 'globalEnabled'], function(result) {
      const globalEnabled = result.globalEnabled !== false;
      const allRules = result.rules || {};
      const domainRules = allRules[domain] || [];
      
      let css = '';
      if (globalEnabled) {
        domainRules.forEach(rule => {
          if (rule.enabled !== false) {
            css += `${rule.selector} { display: none !important; }\n`;
          }
        });
      }

      if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'cee-injected-styles';
        (document.head || document.documentElement).appendChild(styleElement);
      }
      styleElement.textContent = css;
    });
  }

  // Inject immediately at document_start
  injectSavedRules();

  // Re-inject on DOMContentLoaded just to ensure the style tag stays in document.head
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSavedRules);
  } else {
    injectSavedRules();
  }

  // 2. Listen for messages from the popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'get-simplified-dom') {
      try {
        const domString = getSimplifiedDOM();
        sendResponse({ dom: domString });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    }
    return true;
  });

  // 3. Condensed JSON tree DOM serializer for AI processing
  function getSimplifiedDOM() {
    let nodeCount = 0;
    const MAX_NODES = 350; // Limit node traversal to maintain strict token budget

    function cleanNode(node) {
      if (nodeCount > MAX_NODES) return null;

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        return text.length > 0 ? text.substring(0, 25) : null;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return null;
      }
      
      const tagName = node.tagName.toLowerCase();
      // Filter out code resources, styles, canvases, and layout noise
      if (['script', 'style', 'svg', 'noscript', 'iframe', 'canvas'].includes(tagName)) {
        return null;
      }
      
      nodeCount++;
      const obj = { tag: tagName };
      if (node.id) obj.id = node.id;
      if (node.className && typeof node.className === 'string') {
        const classes = node.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length > 0) obj.class = classes.join(' ');
      }
      if (node.getAttribute('aria-label')) obj.label = node.getAttribute('aria-label').substring(0, 25);
      
      const children = [];
      for (let i = 0; i < node.childNodes.length; i++) {
        if (nodeCount > MAX_NODES) break;
        const cleaned = cleanNode(node.childNodes[i]);
        if (cleaned) children.push(cleaned);
      }
      
      if (children.length > 0) {
        obj.children = children;
      }
      return obj;
    }
    
    const root = cleanNode(document.body);
    return JSON.stringify(root); // Valid, intact JSON string
  }

  // 4. Listen for storage changes to instantly update injected styles (no reload required)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.rules || changes.globalEnabled) {
      injectSavedRules();
    }
  });
})();
