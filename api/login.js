import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + process.env.PASSWORD_SALT || 'ams-salt-2024').digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password, token } = req.body;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Verify existing session token
    if (action === 'verify-token') {
      if (!token) return res.status(400).json({ valid: false });
      const rows = await sql`
        SELECT u.email, u.plan FROM ams_sessions s
        JOIN ams_users u ON s.email = u.email
        WHERE s.token = ${token}
      `;
      if (rows.length === 0) return res.status(200).json({ valid: false });
      return res.status(200).json({ valid: true, email: rows[0].email, plan: rows[0].plan });
    }

    // Change password
    if (action === 'change-password') {
      const { newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

      const session = await sql`SELECT email FROM ams_sessions WHERE token = ${token}`;
      if (session.length === 0) return res.status(403).json({ error: 'Invalid session' });

      const newHash = hashPassword(newPassword);
      await sql`UPDATE ams_users SET password_hash = ${newHash} WHERE email = ${session[0].email}`;
      return res.status(200).json({ success: true });
    }

    // Login
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const users = await sql`SELECT * FROM ams_users WHERE email = ${email.toLowerCase()}`;
    if (users.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const user = users[0];
    const passwordHash = hashPassword(password);
    if (user.password_hash !== passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create session
    await sql`
      CREATE TABLE IF NOT EXISTS ams_sessions (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    const newToken = crypto.randomBytes(32).toString('hex');
    await sql`INSERT INTO ams_sessions (token, email) VALUES (${newToken}, ${email.toLowerCase()})`;

    return res.status(200).json({ success: true, token: newToken, plan: user.plan, email: user.email });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: err.message });
  }
}
