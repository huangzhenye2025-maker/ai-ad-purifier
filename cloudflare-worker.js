// cloudflare-worker.js - Serverless Cloud License Manager & AI Assistant for AI Ad Purifier
// Deploy to Cloudflare Workers (free tier, up to 100k requests/day).
// Mirrors server.js business logic (Workers + KV + WebCrypto).

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-waffo-signature, x-webhook-secret',
};

const DEEPSEEK_SYSTEM_PROMPT =
  'You are a professional web ad-blocking and layout-cleaning AI. Analyze the provided condensed web DOM to identify ads, sponsored content, promotion banners, and popups.\n[SELECTOR REQUIREMENT]:\n1. ONLY return standard CSS selectors compatible with standard browser document.querySelectorAll().\n2. NEVER use non-standard play-wright pseudo-classes or custom attributes like :contains(), :has-text(), [has-text], or :text().\n3. If an ad element is wrapped inside a layout grid cell or parent item (such as ytd-rich-item-renderer, li, or container div), you MUST prefer using CSS :has() relational selector to target and hide the outermost cell grid. Example: `ytd-rich-item-renderer:has(ytd-ad-slot-renderer)` or `ytd-rich-item-renderer:has(ytd-display-ad-renderer)`. This ensures that the browser automatically performs native grid reflow and collapses any layout empty spaces!\nReturn ONLY a JSON array containing these selectors. Example: ["ytd-rich-item-renderer:has(ytd-ad-slot-renderer)", "#sponsor-banner"]\nNever wrap the output in markdown code blocks like ```json. Do not include any intro or outro explanation text.';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const rateLimitMap = new Map();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return a === b;
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function tryConsumeRateLimit(key) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  let hits = rateLimitMap.get(key) || [];
  hits = hits.filter((t) => t > windowStart);
  if (hits.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(key, hits);
    return false;
  }
  hits.push(now);
  rateLimitMap.set(key, hits);
  return true;
}

function isPaymentSucceeded(payload) {
  return (
    payload.type === 'payment.succeeded' ||
    payload.event === 'payment.succeeded' ||
    payload.payment === 'payment.succeeded'
  );
}

const CANCEL_EVENTS = ['payment.refunded', 'subscription.cancelled', 'subscription.ended', 'subscription.revoked'];

function isCancelEvent(payload) {
  return (
    CANCEL_EVENTS.includes(payload.type) ||
    CANCEL_EVENTS.includes(payload.event) ||
    payload.status === 'refunded' ||
    payload.status === 'cancelled'
  );
}

async function sendActivationEmail(env, to, orderId) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'AI Ad Purifier <onboarding@resend.dev>',
      to: to,
      subject: 'AI Ad Purifier & Deep Reader - Pro Lifetime Activated',
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #1e293b;">
          <h2>Your AI Deep Reader Pro Lifetime Access is Ready!</h2>
          <p>Thank you for purchasing the Lifetime Edition ($9.9). You can activate with your Order ID:</p>
          <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 18px; font-weight: bold; text-align: center; margin: 20px 0; color: #4f46e5; border: 1px solid #e2e8f0; letter-spacing: 1px;">
            ${orderId}
          </div>
          <p>Paste this Order ID into the extension popup screen to unlock all Pro features permanently.</p>
        </div>
      `
    })
  });
}

// 1. ROUTE: /verify (Chrome Extension validates Order ID)
async function handleVerify(request, env) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ valid: false, message: 'Invalid JSON body.' }, 400, CORS_HEADERS);
    }

    const { key } = body || {};
    if (!key) {
      return json({ valid: false, message: 'Order ID is required' }, 400, CORS_HEADERS);
    }

    const cleanKey = String(key).trim().toUpperCase();
    const recordStr = await env.LICENSE_KV.get(cleanKey);
    const record = recordStr ? JSON.parse(recordStr) : null;

    const isActivePaid =
      record &&
      record.status === 'paid' &&
      (!record.paidUntil || new Date(record.paidUntil).getTime() > Date.now());

    if (isActivePaid) {
      return json({
        valid: true,
        email: record.email,
        status: 'paid',
        isLifetime: !record.paidUntil || record.isLifetime === true,
        expiresAt: record.paidUntil || null
      }, 200, CORS_HEADERS);
    }

    return json({
      valid: false,
      message: '无效或未支付的订单号，请检查您的购买凭证。',
      status: record ? record.status : null,
      expiresAt: null
    }, 200, CORS_HEADERS);
  } catch (err) {
    console.error('Error in /verify:', err.message);
    return json({ valid: false, error: err.message }, 500, CORS_HEADERS);
  }
}

// 2. ROUTE: /webhook (Waffo payment hook)
async function handleWebhook(request, env) {
  const secret = env.WAFFO_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook] WAFFO_WEBHOOK_SECRET is not configured; refusing to process any webhook events.');
    return json({ error: 'webhook secret not configured' }, 503, CORS_HEADERS);
  }

  const raw = await request.text();
  const signatureHeader = (env.WAFFO_SIGNATURE_HEADER || 'x-waffo-signature').toLowerCase();
  const tokenHeader = (env.WAFFO_SECRET_HEADER || 'x-webhook-secret').toLowerCase();

  const expectedHex = await hmacSha256Hex(secret, raw);
  const signature = request.headers.get(signatureHeader);
  const signatureOk = !!signature && safeEqual(String(signature).toLowerCase(), expectedHex);

  const token = request.headers.get(tokenHeader);
  const tokenOk = !!token && safeEqual(String(token), secret);

  if (!signatureOk && !tokenOk) {
    return json({ error: 'invalid signature' }, 401, CORS_HEADERS);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    return new Response('Error: invalid JSON payload.', { status: 400, headers: CORS_HEADERS });
  }

  try {
    if (isPaymentSucceeded(payload)) {
      const customerEmail = payload.customer || payload.buyer_ref || (payload.data && payload.data.customer && payload.data.customer.email);
      if (!customerEmail) {
        return new Response('Error: No buyer email found.', { status: 400, headers: CORS_HEADERS });
      }

      const orderId = payload.order_id || (payload.data && payload.data.order_id);
      if (!orderId) {
        return new Response('Error: No order ID found in payload.', { status: 400, headers: CORS_HEADERS });
      }

      const cleanKey = String(orderId).trim().toUpperCase();
      const nowIso = new Date().toISOString();

      await env.LICENSE_KV.put(cleanKey, JSON.stringify({
        key: cleanKey,
        email: customerEmail,
        orderId: orderId,
        status: 'paid',
        isLifetime: true,
        paidUntil: null,
        createdAt: nowIso,
        updatedAt: nowIso
      }));

      if (env.RESEND_API_KEY) {
        try {
          await sendActivationEmail(env, customerEmail, orderId);
        } catch (mailErr) {
          console.error('[webhook] Failed to send activation email:', mailErr.message);
        }
      }

      return json({ success: true, orderId: orderId, lifetime: true }, 200, CORS_HEADERS);
    }

    if (isCancelEvent(payload)) {
      const newStatus =
        payload.type === 'payment.refunded' ||
        payload.event === 'payment.refunded' ||
        payload.status === 'refunded'
          ? 'refunded'
          : 'cancelled';

      const orderId = payload.order_id || (payload.data && payload.data.order_id);
      if (orderId) {
        const cleanKey = String(orderId).trim().toUpperCase();
        const recordStr = await env.LICENSE_KV.get(cleanKey);
        if (recordStr) {
          const record = JSON.parse(recordStr);
          record.status = newStatus;
          record.updatedAt = new Date().toISOString();
          await env.LICENSE_KV.put(cleanKey, JSON.stringify(record));
        }
      }

      return json({ success: true, status: newStatus }, 200, CORS_HEADERS);
    }

    return new Response('Event ignored', { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    console.error('[webhook] Error processing webhook:', err.message);
    return new Response('Webhook failed: ' + err.message, { status: 500, headers: CORS_HEADERS });
  }
}

// 3. ROUTE: /summarize (AI Deep Digest)
async function handleSummarize(request, env) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'Missing parameters.' }, 400, CORS_HEADERS);
    }

    const { key, text, title } = body || {};
    if (!text) {
      return json({ error: 'Missing text content.' }, 400, CORS_HEADERS);
    }

    const cleanKey = String(key || 'FREE_GUEST').trim().toUpperCase();
    if (!tryConsumeRateLimit(cleanKey)) {
      return json({ error: '请求过于频繁，请稍后再试。' }, 429, CORS_HEADERS);
    }

    const deepseekKey = env.DEEPSEEK_API_KEY;
    if (!deepseekKey) {
      return json({ error: 'DeepSeek API key is not configured on the server.' }, 500, CORS_HEADERS);
    }

    const prompt = `请对以下文章进行深度精华提纯，并严格按如下 JSON 结构返回（不要包裹任何 markdown 代码块或解释）：
{
  "summary": "3-5句话精准提炼核心主旨",
  "keypoints": ["核心论点1", "核心论点2", "核心论点3", "核心论点4"],
  "insights": ["实践建议或落地启发1", "实践建议或落地启发2"],
  "glossary": [{"term": "专业术语1", "def": "简明通俗释义"}],
  "mindmap": "# 文章导图\\n## 核心支柱1\\n- 论据A\\n- 论据B\\n## 核心支柱2\\n- 论据C"
}

文章标题：${title || ''}
文章正文：
${String(text).slice(0, 4500)}`;

    let response;
    try {
      response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 2048
        }),
        signal: AbortSignal.timeout(25000)
      });
    } catch (err) {
      return json({ error: 'AI 提纯超时，请稍后再试。' }, 504, CORS_HEADERS);
    }

    if (!response.ok) {
      throw new Error(`DeepSeek API connection failed (HTTP ${response.status}).`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    const match = content.match(/\{[\s\S]*\}/);
    if (match) content = match[0];

    const digest = JSON.parse(content);
    return json({ success: true, digest }, 200, CORS_HEADERS);
  } catch (err) {
    console.error('Error in /summarize:', err.message);
    return json({ error: err.message }, 500, CORS_HEADERS);
  }
}

// 4. ROUTE: /analyze (DeepSeek DOM cleaner)
async function handleAnalyze(request, env) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'Missing required parameters (key or dom).' }, 400, CORS_HEADERS);
    }

    const { key, dom } = body || {};
    if (!key || !dom) {
      return json({ error: 'Missing required parameters (key or dom).' }, 400, CORS_HEADERS);
    }

    const cleanKey = String(key).trim().toUpperCase();
    if (!tryConsumeRateLimit(cleanKey)) {
      return json({ error: '请求过于频繁，请稍后再试。', code: 'rate_limited' }, 429, CORS_HEADERS);
    }

    const deepseekKey = env.DEEPSEEK_API_KEY;
    if (!deepseekKey) {
      return json({ error: 'DeepSeek API key is not configured on the server.' }, 500, CORS_HEADERS);
    }

    let response;
    try {
      response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: DEEPSEEK_SYSTEM_PROMPT },
            { role: 'user', content: dom }
          ],
          temperature: 0.1,
          max_tokens: 2048
        }),
        signal: AbortSignal.timeout(20000)
      });
    } catch (err) {
      return json({ error: 'AI 分析超时，请稍后再试。' }, 504, CORS_HEADERS);
    }

    if (!response.ok) {
      throw new Error(`DeepSeek API connection failed (HTTP ${response.status}).`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();

    const arrayMatch = content.match(/\[\s*[\s\S]*?\s*\]/);
    if (arrayMatch) content = arrayMatch[0];

    try {
      const selectors = JSON.parse(content);
      return json({ selectors }, 200, CORS_HEADERS);
    } catch (parseErr) {
      const stringMatches = content.match(/"([^"\\]|\\.)*"/g);
      if (stringMatches && stringMatches.length > 0) {
        const selectors = stringMatches.map((str) => {
          try {
            return JSON.parse(str);
          } catch (e) {
            return str.slice(1, -1);
          }
        });
        return json({ selectors }, 200, CORS_HEADERS);
      }
      throw new Error(`DeepSeek response parse failure: ${parseErr.message}`);
    }
  } catch (err) {
    console.error('Error in /analyze:', err.message);
    return json({ error: err.message }, 500, CORS_HEADERS);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/privacy' && request.method === 'GET') {
      if (env.PRIVACY_HTML) {
        return new Response(env.PRIVACY_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS }
        });
      }
      return new Response('Privacy policy not configured.', { status: 404, headers: CORS_HEADERS });
    }

    if (url.pathname === '/verify' && request.method === 'POST') {
      return handleVerify(request, env);
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    if (url.pathname === '/summarize' && request.method === 'POST') {
      return handleSummarize(request, env);
    }

    if (url.pathname === '/analyze' && request.method === 'POST') {
      return handleAnalyze(request, env);
    }

    return new Response('AI Ad Purifier Cloud Backend: Not Found', { status: 404, headers: CORS_HEADERS });
  }
};
