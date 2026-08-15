// cloudflare-worker.js - Serverless Cloud License Manager for AI Ad Purifier
// Deploy to Cloudflare Workers (free tier, up to 100k requests/day).
// Mirrors server.js business logic exactly (Workers + KV + WebCrypto).

// CORS headers so the Chrome Extension popup can call us cross-origin
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-waffo-signature, x-webhook-secret',
};

// System prompt for DeepSeek (kept verbatim - SELECTOR REQUIREMENT)
const DEEPSEEK_SYSTEM_PROMPT =
  'You are a professional web ad-blocking and layout-cleaning AI. Analyze the provided condensed web DOM to identify ads, sponsored content, promotion banners, and popups.\n[SELECTOR REQUIREMENT]:\n1. ONLY return standard CSS selectors compatible with standard browser document.querySelectorAll().\n2. NEVER use non-standard play-wright pseudo-classes or custom attributes like :contains(), :has-text(), [has-text], or :text().\n3. If an ad element is wrapped inside a layout grid cell or parent item (such as ytd-rich-item-renderer, li, or container div), you MUST prefer using CSS :has() relational selector to target and hide the outermost cell grid. Example: `ytd-rich-item-renderer:has(ytd-ad-slot-renderer)` or `ytd-rich-item-renderer:has(ytd-display-ad-renderer)`. This ensures that the browser automatically performs native grid reflow and collapses any layout empty spaces!\nReturn ONLY a JSON array containing these selectors. Example: ["ytd-rich-item-renderer:has(ytd-ad-slot-renderer)", "#sponsor-banner"]\nNever wrap the output in markdown code blocks like ```json. Do not include any intro or outro explanation text.';

// Rate limiting config for /analyze (in-memory sliding window; single-isolate only)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds
const RATE_LIMIT_MAX = 20; // max requests per window per key
const rateLimitMap = new Map(); // key -> [timestamps]

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

// Constant-time-ish string comparison.
// NOTE: Workers has no built-in timing-safe compare API. We do a length check first
// plus a plain string equality check - this rejects length-mismatched inputs quickly
// and only compares same-length strings, but it is NOT cryptographically constant-time
// (a documented limitation of the Workers runtime).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return a === b;
}

// HMAC-SHA256 via WebCrypto, returned as lowercase hex
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

// Sliding-window rate limiter; returns true if the request is allowed.
// NOTE: in-memory Map -> only applies per isolate (single worker instance).
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

// Compute subscription expiry: use payload duration (days) if numeric, else default 30 days.
function computePaidUntil(payload) {
  const days = payload.period_days || (payload.data && payload.data.period_days) || payload.duration_days;
  const daysNum = Number(days);
  const validDays = Number.isFinite(daysNum) && daysNum > 0 ? daysNum : 30;
  return new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString();
}

// Accept all three spellings of the payment-success event
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

// Send the activation email (subject: Premium Activated) with the Order ID.
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
      subject: 'AI Ad Purifier - Premium Activated',
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #1e293b;">
          <h2>Your AI Ad Purifier Premium Access is Ready!</h2>
          <p>Thank you for your purchase. You can now activate the extension directly using your Waffo Order ID:</p>
          <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 18px; font-weight: bold; text-align: center; margin: 20px 0; color: #4f46e5; border: 1px solid #e2e8f0; letter-spacing: 1px;">
            ${orderId}
          </div>
          <p>Paste this Order ID into the extension popup screen to unlock your premium ad block protection.</p>
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

    // License key convention: normalize to trimmed uppercase (Waffo ORD_...)
    const cleanKey = String(key).trim().toUpperCase();

    const recordStr = await env.LICENSE_KV.get(cleanKey);
    const record = recordStr ? JSON.parse(recordStr) : null;

    const isActivePaid =
      record &&
      record.status === 'paid' &&
      (!record.paidUntil || new Date(record.paidUntil).getTime() > Date.now());

    if (isActivePaid) {
      return json({ valid: true, email: record.email, status: 'paid', expiresAt: record.paidUntil || null }, 200, CORS_HEADERS);
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

// 2. ROUTE: /webhook (Waffo payment hook - signature verified, fail-closed)
async function handleWebhook(request, env) {
  const secret = env.WAFFO_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook] WAFFO_WEBHOOK_SECRET is not configured; refusing to process any webhook events.');
    return json({ error: 'webhook secret not configured' }, 503, CORS_HEADERS);
  }

  // Always read the RAW body first; the HMAC must cover exactly what was sent.
  const raw = await request.text();

  const signatureHeader = (env.WAFFO_SIGNATURE_HEADER || 'x-waffo-signature').toLowerCase();
  const tokenHeader = (env.WAFFO_SECRET_HEADER || 'x-webhook-secret').toLowerCase();

  const expectedHex = await hmacSha256Hex(secret, raw);
  const signature = request.headers.get(signatureHeader);
  const signatureOk = !!signature && safeEqual(String(signature).toLowerCase(), expectedHex);

  const token = request.headers.get(tokenHeader);
  const tokenOk = !!token && safeEqual(String(token), secret);

  // Fail-closed: reject unless at least one verification method passes.
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
    // --- payment.succeeded (accepts type/event/payment field spellings) ---
    if (isPaymentSucceeded(payload)) {
      const customerEmail = payload.customer || payload.buyer_ref || (payload.data && payload.data.customer && payload.data.customer.email);
      if (!customerEmail) {
        return new Response('Error: No buyer email found.', { status: 400, headers: CORS_HEADERS });
      }

      const orderId = payload.order_id || (payload.data && payload.data.order_id);
      if (!orderId) {
        return new Response('Error: No order ID found in payload.', { status: 400, headers: CORS_HEADERS });
      }

      // The Order ID IS the license key (no more PURIFIER-XXXX activation codes)
      const cleanKey = String(orderId).trim().toUpperCase();
      const paidUntil = computePaidUntil(payload);
      const nowIso = new Date().toISOString();

      await env.LICENSE_KV.put(cleanKey, JSON.stringify({
        key: cleanKey,
        email: customerEmail,
        orderId: orderId,
        status: 'paid',
        paidUntil: paidUntil,
        createdAt: nowIso,
        updatedAt: nowIso
      }));

      // Send activation email with the Order ID (best-effort; never fail the webhook on mail errors)
      if (env.RESEND_API_KEY) {
        try {
          await sendActivationEmail(env, customerEmail, orderId);
        } catch (mailErr) {
          console.error('[webhook] Failed to send activation email:', mailErr.message);
        }
      }

      return json({ success: true, orderId: orderId }, 200, CORS_HEADERS);
    }

    // --- refund / cancellation: flip status, keep the record ---
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
          await env.LICENSE_KV.put(cleanKey, JSON.stringify(record)); // keep record, only flip status
        }
      }

      return json({ success: true, status: newStatus }, 200, CORS_HEADERS);
    }

    // --- any other event: acknowledged but ignored ---
    return new Response('Event ignored', { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    console.error('[webhook] Error processing webhook:', err.message);
    return new Response('Webhook failed: ' + err.message, { status: 500, headers: CORS_HEADERS });
  }
}

// 3. ROUTE: /analyze (DeepSeek secure proxy; paid only)
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

    const recordStr = await env.LICENSE_KV.get(cleanKey);
    const record = recordStr ? JSON.parse(recordStr) : null;

    // Paid-only gate
    if (!record || record.status !== 'paid') {
      return json({
        error: 'Unauthorized: DeepSeek AI 智能净化为付费高级版专属功能（$7.99/月）。',
        code: 'unauthorized'
      }, 403, CORS_HEADERS);
    }
    if (record.paidUntil && new Date(record.paidUntil).getTime() <= Date.now()) {
      return json({ error: '订阅已过期，请续订后继续使用。', code: 'expired' }, 403, CORS_HEADERS);
    }

    // Rate limit per key (webhook handling is NOT rate-limited; only /analyze is)
    if (!tryConsumeRateLimit(cleanKey)) {
      return json({ error: '请求过于频繁，请稍后再试。', code: 'rate_limited' }, 429, CORS_HEADERS);
    }

    const deepseekKey = env.DEEPSEEK_API_KEY;
    if (!deepseekKey) {
      return json({ error: 'DeepSeek API key is not configured on the server.' }, 500, CORS_HEADERS);
    }

    // Call DeepSeek Chat API with a hard 20s timeout
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
        signal: AbortSignal.timeout(20000) // hard 20s timeout
      });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        return json({ error: 'AI 分析超时，请稍后再试。' }, 504, CORS_HEADERS);
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(`DeepSeek API connection failed (HTTP ${response.status}).`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();

    // Extract the first [...] JSON array from the response
    const arrayMatch = content.match(/\[\s*[\s\S]*?\s*\]/);
    if (arrayMatch) {
      content = arrayMatch[0];
    }

    try {
      const selectors = JSON.parse(content);
      return json({ selectors }, 200, CORS_HEADERS);
    } catch (parseErr) {
      // Fallback: pull out every fully-formed double-quoted string as a selector
      const stringMatches = content.match(/"([^"\\]|\\.)*"/g);
      if (stringMatches && stringMatches.length > 0) {
        const selectors = stringMatches.map((str) => {
          try {
            return JSON.parse(str); // safely unescape quotes and backslashes
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

    // Handle CORS preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Public Privacy Policy page (required by Chrome Web Store for <all_urls> + DNR permissions).
    // Deploy with PRIVACY_HTML env/secret containing the full privacy HTML, or use the Render backend at /privacy.
    if (url.pathname === '/privacy' && request.method === 'GET') {
      if (env.PRIVACY_HTML) {
        return new Response(env.PRIVACY_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS }
        });
      }
      return new Response(
        'Privacy policy not configured. Set the PRIVACY_HTML environment variable on this Worker ' +
        '(or use the Render backend: https://ai-ad-purifier.onrender.com/privacy).',
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // 1. ROUTE: /verify (Chrome Extension validates key)
    if (url.pathname === '/verify' && request.method === 'POST') {
      return handleVerify(request, env);
    }

    // 2. ROUTE: /webhook (Waffo payment webhook listener)
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    // 3. ROUTE: /analyze (DeepSeek secure proxy)
    if (url.pathname === '/analyze' && request.method === 'POST') {
      return handleAnalyze(request, env);
    }

    return new Response('AI Ad Purifier Cloud Backend: Not Found', { status: 404, headers: CORS_HEADERS });
  }
};
