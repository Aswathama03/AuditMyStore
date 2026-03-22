import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

async function getDb() {
  const sql = neon(process.env.POSTGRES_URL);
  await sql`
    CREATE TABLE IF NOT EXISTS ams_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL,
      stripe_customer_id TEXT,
      stripe_session_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  return sql;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + process.env.PASSWORD_SALT || 'ams-salt-2024').digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, session_id, name } = req.body;
  if (!email || !password || !session_id) {
    return res.status(400).json({ error: 'Email, password and session_id required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const sql = await getDb();

    // Allow direct email signup (free plan) or paid session
    let plan = 'free';
    if (session_id !== 'email-signup') {
      const license = await sql`SELECT plan, email FROM ams_licenses WHERE session_id = ${session_id}`;
      if (license.length === 0) {
        return res.status(403).json({ error: 'Invalid session — payment not verified' });
      }
      plan = license[0].plan || 'monthly';
    }
    const passwordHash = hashPassword(password);

    // Check if email already registered
    const existing = await sql`SELECT id, plan FROM ams_users WHERE email = ${email.toLowerCase()}`;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered — please log in instead' });
    }

    await sql`
      INSERT INTO ams_users (email, name, password_hash, plan, stripe_session_id)
      VALUES (${email.toLowerCase()}, ${name || ''}, ${passwordHash}, ${plan}, ${session_id})
    `;

    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    await sql`
      CREATE TABLE IF NOT EXISTS ams_sessions (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`INSERT INTO ams_sessions (token, email) VALUES (${token}, ${email.toLowerCase()})`;

    return res.status(200).json({ success: true, token, plan, email: email.toLowerCase(), name: name || email.split('@')[0] });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: err.message });
  }
}
