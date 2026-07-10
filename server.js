// server.js - Node.js Express Backend for AI Ad Purifier (Deploy to Render)
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors({ origin: '*' }));
app.use(express.json());

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

// Health Check / Home Route
app.get('/', (req, res) => {
  res.send('AI Ad Purifier Cloud Backend (Render Edition) is running!');
});

// 1. ROUTE: POST /verify (Chrome Extension validates Order ID)
app.post('/verify', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) {
      return res.status(400).json({ valid: false, message: 'Order ID is required' });
    }

    const database = await connectDb();
    if (!database) {
      return res.status(500).json({ valid: false, message: 'Database connection failed' });
    }

    // Look up the order ID directly (case-insensitive)
    const license = await database.collection('licenses').findOne({ key: key.toUpperCase().trim() });
    if (license) {
      return res.json({ valid: true, email: license.email });
    } else {
      return res.json({ valid: false, message: 'Invalid or unpaid Order ID. Please check your purchase receipt.' });
    }
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

// 2. ROUTE: POST /webhook (Waffo payment succeeded hook)
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;

    if (payload.type === 'payment.succeeded' || payload.event === 'payment.succeeded' || (payload.order_id && payload.customer)) {
      const customerEmail = payload.customer || payload.buyer_ref || (payload.data && payload.data.customer && payload.data.customer.email);
      if (!customerEmail) {
        return res.status(400).send('Error: No buyer email found.');
      }

      // Extract the order ID from Waffo payment notification
      const orderId = payload.order_id || (payload.data && payload.data.order_id);
      if (!orderId) {
        return res.status(400).send('Error: No order ID found in payload.');
      }

      const cleanKey = orderId.toUpperCase().trim();

      const database = await connectDb();
      if (!database) {
        return res.status(500).send('Database connection failed');
      }

      // Save order ID to MongoDB as the active license key
      await database.collection('licenses').updateOne(
        { key: cleanKey },
        {
          $set: {
            email: customerEmail,
            orderId: orderId,
            createdAt: new Date(),
            status: 'paid'
          }
        },
        { upsert: true }
      );

      // Optionally send a congratulatory email containing the Order ID
      const resendApiKey = process.env.RESEND_API_KEY;
      if (resendApiKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`
          },
          body: JSON.stringify({
            from: 'AI Ad Purifier <onboarding@resend.dev>',
            to: customerEmail,
            subject: 'AI Ad Purifier - Premium Activated',
            html: `
              <div style="font-family: sans-serif; padding: 24px; color: #1e293b;">
                <h2>Your AI Ad Purifier Premium Access is Ready!</h2>
                <p>Thank you for your purchase. You can now activate the extension directly using your Waffo Order ID:</p>
                <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 18px; font-weight: bold; text-align: center; margin: 20px 0; color: #4f46e5; border: 1px solid #e2e8f0; letter-spacing: 1px;">
                  ${orderId}
                </div>
                <p>Paste this Order ID into the extension popup screen to unlock your lifetime premium ad block protection.</p>
              </div>
            `
          })
        });
      }

      return res.json({ success: true, orderId: orderId });
    }

    res.send('Event ignored');
  } catch (err) {
    res.status(500).send('Webhook failed: ' + err.message);
  }
});

// 3. ROUTE: POST /analyze (Chrome Extension calls this to run DeepSeek secure analysis)
app.post('/analyze', async (req, res) => {
  try {
    const { key, dom } = req.body;
    if (!key || !dom) {
      return res.status(400).json({ error: 'Missing required parameters (key or dom).' });
    }

    const database = await connectDb();
    if (!database) {
      return res.status(500).json({ error: 'Database connection failed.' });
    }

    // Verify client is activated by checking database for the Order ID
    const license = await database.collection('licenses').findOne({ key: key.toUpperCase().trim() });
    if (!license) {
      return res.status(403).json({ error: 'Unauthorized: Invalid or unpaid Order ID.' });
    }

    // Call DeepSeek Chat API securely using key from environment variables
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (!deepseekKey) {
      return res.status(500).json({ error: 'DeepSeek API key is not configured on the server.' });
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekKey}`
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
            content: dom
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API connection failed (HTTP ${response.status}).`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    
    const arrayMatch = content.match(/\[\s*[\s\S]*?\s*\]/);
    if (arrayMatch) {
      content = arrayMatch[0];
    }

    const selectors = JSON.parse(content);
    res.json({ selectors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
