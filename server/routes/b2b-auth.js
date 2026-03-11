const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
require('dotenv').config();

function signCompanyToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET + '_company', { expiresIn: '7d' });
}

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, website, industry } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Champs manquants' });
    const hash = await bcrypt.hash(password, 10);
    const r = await db.run('INSERT INTO companies (name, email, password_hash, website, industry) VALUES (?, ?, ?, ?, ?)', name, email.toLowerCase(), hash, website || '', industry || '');

    const key = 'sk_live_' + crypto.randomBytes(24).toString('hex');
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    await db.run('INSERT INTO api_keys (company_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?)', r.lastInsertRowid, keyHash, key.slice(0, 12) + '...', 'Production');

    const company = await db.get('SELECT id, name, email, plan, industry FROM companies WHERE id = ?', r.lastInsertRowid);
    res.status(201).json({ token: signCompanyToken(company.id), company, api_key: key, message: 'Sauvegardez votre API key — elle ne sera plus affichée.' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email déjà utilisé' });
    next(e);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const company = await db.get('SELECT * FROM companies WHERE email = ? AND is_active = 1', email?.toLowerCase());
    if (!company || !(await bcrypt.compare(password, company.password_hash))) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    const { password_hash, ...safe } = company;
    res.json({ token: signCompanyToken(company.id), company: safe });
  } catch (e) { next(e); }
});

router.get('/me', require('../middleware/companyAuth').requireCompanyAuth, (req, res) => {
  res.json(req.company);
});

module.exports = router;
