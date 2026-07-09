// cloudflare-worker.js - Serverless Cloud License Manager for AI Ad Purifier
// Deploy this to Cloudflare Workers for free (up to 100k requests/day)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS headers to allow cross-origin requests from the Chrome Extension popup
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. ROUTE: /verify (Chrome Extension calls this to validate key)
    if (url.pathname === '/verify' && request.method === 'POST') {
      try {
        const { key } = await request.json();
        if (!key) {
          return new Response(JSON.stringify({ valid: false, message: 'Key is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Check if the license key exists in Cloudflare KV database
        const recordStr = await env.LICENSE_KV.get(key);
        if (recordStr) {
          const record = JSON.parse(recordStr);
          return new Response(JSON.stringify({ valid: true, email: record.email }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } else {
          return new Response(JSON.stringify({ valid: false, message: 'Invalid or inactive license key.' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      } catch (err) {
        return new Response(JSON.stringify({ valid: false, error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 2. ROUTE: /webhook (Waffo payment webhook listener)
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const payload = await request.json();
        
        // Handle successful payment events from Waffo Pancake
        if (payload.type === 'payment.succeeded' || payload.event === 'payment.succeeded' || (payload.order_id && payload.customer)) {
          // Extract buyer email from different potential Waffo payloads
          const customerEmail = payload.customer || payload.buyer_ref || (payload.data && payload.data.customer && payload.data.customer.email);
          if (!customerEmail) {
            return new Response('Error: No buyer email found in webhook payload.', { status: 400 });
          }

          // Generate a cryptographically secure unique license key
          const generatePart = () => Math.random().toString(36).substring(2, 6).toUpperCase();
          const uniqueKey = `PURIFIER-${generatePart()}-${generatePart()}-${generatePart()}`;

          // Save license key details to Cloudflare KV Database
          await env.LICENSE_KV.put(uniqueKey, JSON.stringify({
            email: customerEmail,
            orderId: payload.order_id || 'N/A',
            activatedAt: new Date().toISOString()
          }));

          // Send confirmation email with activation code using Resend Email API (Free tier sends 3k emails/month)
          if (env.RESEND_API_KEY) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.RESEND_API_KEY}`
              },
              body: JSON.stringify({
                from: 'AI Ad Purifier <onboarding@resend.dev>', // Setup your own domain on Resend later
                to: customerEmail,
                subject: 'Your AI Ad Purifier License Activation Code',
                html: `
                  <div style="font-family: sans-serif; padding: 24px; color: #1e293b;">
                    <h2>Thank you for purchasing AI Ad Purifier!</h2>
                    <p>Your unique premium license key has been generated successfully:</p>
                    <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 18px; font-weight: bold; text-align: center; margin: 20px 0; color: #4f46e5; border: 1px solid #e2e8f0; letter-spacing: 1px;">
                      ${uniqueKey}
                    </div>
                    <p>Paste this key into the extension popup screen to activate your lifetime premium protection.</p>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
                    <p style="font-size: 12px; color: #64748b;">If you need assistance, reply to this email or contact support.</p>
                  </div>
                `
              })
            });
          }

          return new Response(JSON.stringify({ success: true, key: uniqueKey }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        return new Response('Webhook received: Ignored event type', { status: 200 });
      } catch (err) {
        return new Response('Webhook handling failed: ' + err.message, { status: 500 });
      }
    }

    return new Response('AI Ad Purifier Cloud Backend: Not Found', { status: 404 });
  }
};
