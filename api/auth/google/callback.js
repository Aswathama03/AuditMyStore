import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

async function getDb() {
  const sql = neon(process.env.POSTGRES_URL);
  // Create users table if not exists
  await sql`
    CREATE TABLE IF NOT EXISTS ams_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar TEXT,
      password_hash TEXT,
      plan TEXT DEFAULT 'free',
      google_id TEXT,
      stripe_session_id TEXT,
      welcome_sent BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ams_sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  return sql;
}

async function sendWelcomeEmail(email, name) {
  const firstName = name?.split(' ')[0] || 'there';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'Debbie at AuditMyStore <onboarding@resend.dev>',
      to: email,
      subject: `Welcome to AuditMyStore, ${firstName}! 🚀`,
      html: `
        <div style="font-family:'Helvetica Neue',sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
          <!-- Header -->
          <div style="background:linear-gradient(135deg,#ea580c,#f97316);padding:36px 32px;text-align:center">
            <div style="background:rgba(255,255,255,0.2);display:inline-block;padding:10px 20px;border-radius:10px;margin-bottom:16px">
              <span style="color:white;font-weight:800;font-size:18px;letter-spacing:-0.5px">AuditMyStore</span>
            </div>
            <h1 style="color:white;margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px">Welcome aboard, ${firstName}! 🎉</h1>
          </div>
          <!-- Body -->
          <div style="padding:32px">
            <p style="color:#334155;font-size:16px;line-height:1.7;margin:0 0 20px">Hi ${firstName},</p>
            <p style="color:#334155;font-size:16px;line-height:1.7;margin:0 0 20px">
              You've just unlocked access to the most powerful AI-driven Shopify store analyzer on the market. I'm <strong>Debbie</strong>, your personal AI Shopify consultant — and I'm here to help you find hidden revenue opportunities and double your sales.
            </p>
            <!-- What you can do -->
            <div style="background:#f8fafc;border-radius:12px;padding:24px;margin:24px 0">
              <h3 style="color:#0f172a;margin:0 0 16px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Here's what you can do right now:</h3>
              <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
                <span style="font-size:20px">🔍</span>
                <div><strong style="color:#0f172a">Analyze any Shopify store</strong><br><span style="color:#64748b;font-size:14px">Paste any URL and get a full health score, revenue gaps and quick wins in 60 seconds.</span></div>
              </div>
              <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
                <span style="font-size:20px">📧</span>
                <div><strong style="color:#0f172a">Get email sequences written</strong><br><span style="color:#64748b;font-size:14px">Debbie will write your welcome, abandoned cart and post-purchase emails.</span></div>
              </div>
              <div style="display:flex;align-items:flex-start;gap:12px">
                <span style="font-size:20px">📣</span>
                <div><strong style="color:#0f172a">Generate ad copy</strong><br><span style="color:#64748b;font-size:14px">Facebook, Instagram and Google ads — written specifically for your store.</span></div>
              </div>
            </div>
            <p style="color:#334155;font-size:16px;line-height:1.7;margin:0 0 28px">
              You start with <strong>2 free audits</strong>. Upgrade to Pro for unlimited audits, real revenue data, and full access to all Debbie's features.
            </p>
            <!-- CTA -->
            <div style="text-align:center;margin:28px 0">
              <a href="${process.env.APP_URL}/app" style="background:linear-gradient(135deg,#ea580c,#f97316);color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">
                Analyze My First Store →
              </a>
            </div>
            <p style="color:#94a3b8;font-size:13px;text-align:center;margin:0">
              Questions? Just reply to this email — I read every one.<br/>
              <strong style="color:#64748b">— Debbie, AuditMyStore AI Consultant</strong>
            </p>
          </div>
          <!-- Footer -->
          <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center">
            <p style="color:#94a3b8;font-size:12px;margin:0">© 2026 AuditMyStore. You're receiving this because you signed up at auditmystore.vercel.app</p>
          </div>
        </div>
      `
    })
  });
}

export default async function handler(req, res) {
  const { code, error } = req.query;
  const appUrl = process.env.APP_URL;

  if (error) return res.redirect(302, `${appUrl}/login?error=google_denied`);
  if (!code) return res.redirect(302, `${appUrl}/login?error=no_code`);

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${appUrl}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token from Google');

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const googleUser = await userRes.json();
    const { email, name, picture, id: googleId } = googleUser;

    if (!email) throw new Error('No email from Google');

    const sql = await getDb();

    // Upsert user
    const existing = await sql`SELECT id, plan, welcome_sent FROM ams_users WHERE email = ${email}`;
    let isNew = false;

    if (existing.length === 0) {
      await sql`
        INSERT INTO ams_users (email, name, avatar, google_id, plan)
        VALUES (${email}, ${name || ''}, ${picture || ''}, ${googleId}, 'free')
      `;
      isNew = true;
    } else {
      // Update Google info if missing
      await sql`
        UPDATE ams_users SET name = COALESCE(NULLIF(name,''), ${name || ''}),
        avatar = COALESCE(NULLIF(avatar,''), ${picture || ''}),
        google_id = COALESCE(NULLIF(google_id,''), ${googleId})
        WHERE email = ${email}
      `;
    }

    // Send welcome email if new user
    if (isNew) {
      try { await sendWelcomeEmail(email, name); } catch (e) { console.error('Welcome email failed:', e); }
      await sql`UPDATE ams_users SET welcome_sent = TRUE WHERE email = ${email}`;
    }

    // Create session
    const token = crypto.randomBytes(32).toString('hex');
    await sql`INSERT INTO ams_sessions (token, email) VALUES (${token}, ${email}) ON CONFLICT DO NOTHING`;

    // Get plan
    const user = await sql`SELECT plan FROM ams_users WHERE email = ${email}`;
    const plan = user[0]?.plan || 'free';

    // Redirect to app with session
    res.redirect(302, `${appUrl}/app?session_token=${token}&name=${encodeURIComponent(name||email)}&plan=${plan}&new=${isNew ? '1' : '0'}`);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect(302, `${appUrl}/login?error=oauth_failed`);
  }
}
