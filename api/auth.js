import crypto from 'crypto';

// Scopes covering orders, analytics, customers, products, and marketing
const SCOPES = [
  'read_orders',
  'read_all_orders',
  'read_analytics',
  'read_customers',
  'read_products',
  'read_inventory',
  'read_reports',
  'read_marketing_events',
  'read_checkouts',
  'read_price_rules',
  'read_discounts',
].join(',');

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { shop } = req.query;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  // Sanitize shop domain
  const shopDomain = shop
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .trim()
    .toLowerCase();

  // Validate it looks like a Shopify domain or custom domain
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}$/.test(shopDomain)) {
    return res.status(400).json({ error: 'Invalid shop domain' });
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const appUrl = process.env.APP_URL; // e.g. https://yourapp.vercel.app

  if (!clientId || !appUrl) {
    return res.status(500).json({ error: 'Missing SHOPIFY_CLIENT_ID or APP_URL env vars' });
  }

  // Generate a random nonce to prevent CSRF
  const state = crypto.randomBytes(16).toString('hex');

  const redirectUri = `${appUrl}/api/callback`;

  const authUrl =
    `https://${shopDomain}/admin/oauth/authorize` +
    `?client_id=${clientId}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  // Store state in a short-lived cookie for CSRF validation in the callback
  res.setHeader(
    'Set-Cookie',
    `shopify_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
  );

  return res.redirect(302, authUrl);
}
