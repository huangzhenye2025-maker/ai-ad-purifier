// server.js - Node.js Express Backend for AI Ad Purifier (Deploy to Render)
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// System prompt for DeepSeek (kept verbatim - SELECTOR REQUIREMENT)
const DEEPSEEK_SYSTEM_PROMPT =
  'You are a professional web ad-blocking and layout-cleaning AI. Analyze the provided condensed web DOM to identify ads, sponsored content, promotion banners, and popups.\n[SELECTOR REQUIREMENT]:\n1. ONLY return standard CSS selectors compatible with standard browser document.querySelectorAll().\n2. NEVER use non-standard play-wright pseudo-classes or custom attributes like :contains(), :has-text(), [has-text], or :text().\n3. If an ad element is wrapped inside a layout grid cell or parent item (such as ytd-rich-item-renderer, li, or container div), you MUST prefer using CSS :has() relational selector to target and hide the outermost cell grid. Example: `ytd-rich-item-renderer:has(ytd-ad-slot-renderer)` or `ytd-rich-item-renderer:has(ytd-display-ad-renderer)`. This ensures that the browser automatically performs native grid reflow and collapses any layout empty spaces!\nReturn ONLY a JSON array containing these selectors. Example: ["ytd-rich-item-renderer:has(ytd-ad-slot-renderer)", "#sponsor-banner"]\nNever wrap the output in markdown code blocks like ```json. Do not include any intro or outro explanation text.';

// Rate limiting config for /analyze (in-memory sliding window; single-instance only)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds
const RATE_LIMIT_MAX = 20; // max requests per window per key
const rateLimitMap = new Map(); // key -> [timestamps]

// Enable CORS
app.use(cors({ origin: '*' }));

// Fail-closed secret gate: /webhook refuses everything when WAFFO_WEBHOOK_SECRET is
// missing. Registered BEFORE body parsing so it always returns 503 and never processes events.
app.use('/webhook', (req, res, next) => {
  if (!process.env.WAFFO_WEBHOOK_SECRET) {
    console.warn('[webhook] WAFFO_WEBHOOK_SECRET is not configured; refusing to process any webhook events.');
    return res.status(503).json({ error: 'webhook secret not configured' });
  }
  next();
});

// JSON parsing. verify() captures the RAW request body, required for webhook HMAC verification.
app.use(express.json({
  limit: '200kb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Database Connection
let db = null;
const mongoUri = process.env.MONGO_URI;

async function connectDb() {
  if (db) return db;
  if (!mongoUri) {
    console.error("Error: MONGO_URI environment variable is missing.");
    return null;
  }
  const client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db('ad_purifier');
  console.log("Connected to MongoDB successfully.");
  return db;
}

// Constant-time string comparison (length check + timingSafeEqual)
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Webhook signature verification (either method passing is enough):
//   1. x-waffo-signature == HMAC-SHA256(raw body, secret) hex lowercase
//   2. x-webhook-secret  == secret (plaintext token)
function verifyWebhookSignature(req, secret) {
  const signatureHeader = (process.env.WAFFO_SIGNATURE_HEADER || 'x-waffo-signature').toLowerCase();
  const tokenHeader = (process.env.WAFFO_SECRET_HEADER || 'x-webhook-secret').toLowerCase();

  const signature = req.headers[signatureHeader];
  if (signature) {
    const rawBody = req.rawBody || Buffer.from('');
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (safeEqual(String(signature).toLowerCase(), expected)) {
      return true;
    }
  }

  const token = req.headers[tokenHeader];
  if (token && safeEqual(String(token), secret)) {
    return true;
  }

  return false;
}

// Sliding-window rate limiter; returns true if the request is allowed.
// NOTE: in-memory Map -> only applies per single process/instance.
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
async function sendActivationEmail(to, orderId) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
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

// Health Check / Home Route
app.get('/', (req, res) => {
  res.send('AI Ad Purifier Cloud Backend (Render Edition) is running!');
});

// Public Privacy Policy page (required by Chrome Web Store for <all_urls> + DNR permissions).
// Serves the content of PRIVACY_POLICY.md as a plain, dependency-free HTML page.
function privacyPageHtml() {
  let md = '';
  try {
    md = fs.readFileSync(path.join(__dirname, 'PRIVACY_POLICY.md'), 'utf8');
  } catch (e) {
    md = 'Privacy Policy unavailable. Please contact support.';
  }
  const esc = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Ad Purifier - Privacy Policy</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; line-height: 1.75; color: #1e293b; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; }
</style>
</head>
<body><pre>${esc}</pre></body>
</html>`;
}

app.get('/privacy', (req, res) => {
  res.type('html').send(privacyPageHtml());
});

// 1. ROUTE: POST /verify (Chrome Extension validates Order ID)
app.post('/verify', async (req, res) => {
  try {
    const { key } = req.body || {};
    if (!key) {
      return res.status(400).json({ valid: false, message: 'Order ID is required' });
    }

    // License key convention: normalize to trimmed uppercase (Waffo ORD_...)
    const cleanKey = String(key).trim().toUpperCase();

    const database = await connectDb();
    if (!database) {
      return res.status(500).json({ valid: false, message: 'Database connection failed' });
    }

    const record = await database.collection('licenses').findOne({ key: cleanKey });
    const isActivePaid =
      record &&
      record.status === 'paid' &&
      (!record.paidUntil || new Date(record.paidUntil).getTime() > Date.now());

    if (isActivePaid) {
      return res.json({ valid: true, email: record.email, status: 'paid', expiresAt: record.paidUntil || null });
    }

    return res.json({
      valid: false,
      message: '无效或未支付的订单号，请检查您的购买凭证。',
      status: record ? record.status : null,
      expiresAt: null
    });
  } catch (err) {
    console.error('Error in /verify:', err.message);
    res.status(500).json({ valid: false, error: err.message });
  }
});

// 2. ROUTE: POST /webhook (Waffo payment hook - signature verified, fail-closed)
app.post('/webhook', async (req, res) => {
  // Verify the signature against the raw body BEFORE touching the payload.
  // (The body is always read by express.json middleware before we reach this point.)
  if (!verifyWebhookSignature(req, process.env.WAFFO_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  try {
    const payload = req.body;

    // --- payment.succeeded (accepts type/event/payment field spellings) ---
    if (isPaymentSucceeded(payload)) {
      const customerEmail = payload.customer || payload.buyer_ref || (payload.data && payload.data.customer && payload.data.customer.email);
      if (!customerEmail) {
        return res.status(400).send('Error: No buyer email found.');
      }

      const orderId = payload.order_id || (payload.data && payload.data.order_id);
      if (!orderId) {
        return res.status(400).send('Error: No order ID found in payload.');
      }

      // The Order ID IS the license key (no more PURIFIER-XXXX activation codes)
      const cleanKey = String(orderId).trim().toUpperCase();
      const paidUntil = computePaidUntil(payload);
      const nowIso = new Date().toISOString();

      const database = await connectDb();
      if (!database) {
        return res.status(500).send('Database connection failed');
      }

      await database.collection('licenses').updateOne(
        { key: cleanKey },
        {
          $set: {
            email: customerEmail,
            orderId: orderId,
            status: 'paid',
            paidUntil: paidUntil,
            updatedAt: nowIso
          },
          $setOnInsert: { createdAt: nowIso }
        },
        { upsert: true }
      );

      // Send activation email with the Order ID (best-effort; never fail the webhook on mail errors)
      if (process.env.RESEND_API_KEY) {
        try {
          await sendActivationEmail(customerEmail, orderId);
        } catch (mailErr) {
          console.error('[webhook] Failed to send activation email:', mailErr.message);
        }
      }

      return res.json({ success: true, orderId: orderId });
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
        const database = await connectDb();
        if (!database) {
          return res.status(500).send('Database connection failed');
        }
        await database.collection('licenses').updateOne(
          { key: cleanKey },
          { $set: { status: newStatus, updatedAt: new Date().toISOString() } }
        );
      }

      return res.json({ success: true, status: newStatus });
    }

    // --- any other event: acknowledged but ignored ---
    res.send('Event ignored');
  } catch (err) {
    console.error('[webhook] Error processing webhook:', err.message);
    res.status(500).send('Webhook failed: ' + err.message);
  }
});

// 3. ROUTE: POST /analyze (Chrome Extension calls this to run DeepSeek secure analysis; paid only)
app.post('/analyze', async (req, res) => {
  try {
    const { key, dom } = req.body || {};
    if (!key || !dom) {
      return res.status(400).json({ error: 'Missing required parameters (key or dom).' });
    }

    const cleanKey = String(key).trim().toUpperCase();

    const database = await connectDb();
    if (!database) {
      return res.status(500).json({ error: 'Database connection failed.' });
    }

    // Paid-only gate
    const record = await database.collection('licenses').findOne({ key: cleanKey });
    if (!record || record.status !== 'paid') {
      return res.status(403).json({
        error: 'Unauthorized: DeepSeek AI 智能净化为付费高级版专属功能（$7.99/月）。',
        code: 'unauthorized'
      });
    }
    if (record.paidUntil && new Date(record.paidUntil).getTime() <= Date.now()) {
      return res.status(403).json({ error: '订阅已过期，请续订后继续使用。', code: 'expired' });
    }

    // Rate limit per key (webhook handling is NOT rate-limited; only /analyze is)
    if (!tryConsumeRateLimit(cleanKey)) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试。', code: 'rate_limited' });
    }

    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (!deepseekKey) {
      return res.status(500).json({ error: 'DeepSeek API key is not configured on the server.' });
    }

    // Call DeepSeek Chat API with a hard 20s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
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
        signal: controller.signal
      });
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        return res.status(504).json({ error: 'AI 分析超时，请稍后再试。' });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
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
      return res.json({ selectors });
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
        return res.json({ selectors });
      }

      throw new Error(`DeepSeek response parse failure: ${parseErr.message}`);
    }
  } catch (err) {
    console.error('Error in /analyze:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
