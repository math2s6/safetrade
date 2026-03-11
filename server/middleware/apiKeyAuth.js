const crypto = require('crypto');
const db = require('../db');

async function requireApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'API key manquante. Utilisez le header: Authorization: Bearer sk_live_...' });

  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const apiKey = await db.get(
    'SELECT ak.*, c.id as company_id, c.name as company_name, c.plan, c.is_active FROM api_keys ak JOIN companies c ON c.id = ak.company_id WHERE ak.key_hash = ? AND ak.is_active = 1',
    keyHash
  );
  if (!apiKey || !apiKey.is_active) return res.status(401).json({ error: 'API key invalide ou désactivée' });

  await db.run("UPDATE api_keys SET last_used_at = datetime('now'), requests_count = requests_count + 1 WHERE id = ?", apiKey.id);
  req.company = { id: apiKey.company_id, name: apiKey.company_name, plan: apiKey.plan };
  next();
}

module.exports = { requireApiKey };
