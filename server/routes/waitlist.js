const router = require('express').Router();
const db = require('../db');

// Create waitlist table if not exists
try {
  db.prepare(`CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    company TEXT,
    volume TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )`).run();
} catch(e) {}

router.post('/', (req, res) => {
  const { email, company, volume } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email invalide' });
  try {
    db.prepare('INSERT INTO waitlist (email, company, volume) VALUES (?, ?, ?)').run(email, company || '', volume || '');
    res.json({ success: true, message: 'Vous êtes sur la liste !' });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.json({ success: true, message: 'Déjà inscrit !' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/count', (req, res) => {
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM waitlist').get();
    res.json({ count: result.count });
  } catch(e) {
    res.json({ count: 0 });
  }
});

module.exports = router;
