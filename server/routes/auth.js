const router = require('express').Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { signAccess } = require('../services/tokenService');
const { requireAuth } = require('../middleware/auth');
const { avatarUpload } = require('../middleware/upload');

router.post('/register', async (req, res, next) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password) return res.status(400).json({ error: 'Tous les champs sont requis' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min 6 caractères)' });
    const hash = await bcrypt.hash(password, 10);
    const r = await db.run('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)', email.toLowerCase(), username, hash);
    const user = await db.get('SELECT id, email, username, role, balance FROM users WHERE id = ?', r.lastInsertRowid);
    res.json({ token: signAccess({ id: user.id, role: user.role }), user });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email ou nom d\'utilisateur déjà utilisé' });
    next(e);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await db.get('SELECT * FROM users WHERE email = ? AND is_banned = 0', email?.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    const { password_hash, ...safe } = user;
    res.json({ token: signAccess({ id: user.id, role: user.role }), user: safe });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

router.put('/me', requireAuth, avatarUpload.single('avatar'), async (req, res, next) => {
  try {
    const { bio, username } = req.body;
    const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : undefined;
    const updates = [];
    const params = [];
    if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
    if (username) { updates.push('username = ?'); params.push(username); }
    if (avatarUrl) { updates.push('avatar_url = ?'); params.push(avatarUrl); }
    if (updates.length === 0) return res.json(req.user);
    updates.push('updated_at = datetime(\'now\')');
    params.push(req.user.id);
    await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params);
    const updated = await db.get('SELECT id, email, username, role, balance, escrow_balance, avatar_url, bio, rating_avg, rating_count FROM users WHERE id = ?', req.user.id);
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/me/topup', requireAuth, async (req, res, next) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0 || amount > 10000) return res.status(400).json({ error: 'Montant invalide (max 10 000€)' });
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', amount, req.user.id);
    const user = await db.get('SELECT balance FROM users WHERE id = ?', req.user.id);
    res.json({ balance: user.balance, message: `${amount}€ ajoutés à votre compte` });
  } catch (e) { next(e); }
});

module.exports = router;
