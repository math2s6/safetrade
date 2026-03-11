const router = require('express').Router();
const db = require('../db');

router.post('/', async (req, res) => {
  const { email, company, volume } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email invalide' });
  try {
    await db.run('INSERT INTO waitlist (email, company, volume) VALUES (?, ?, ?)', email, company || '', volume || '');
    res.json({ success: true, message: 'Vous êtes sur la liste !' });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.json({ success: true, message: 'Déjà inscrit !' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/count', async (req, res) => {
  try {
    const result = await db.get('SELECT COUNT(*) as count FROM waitlist');
    res.json({ count: result.count });
  } catch(e) {
    res.json({ count: 0 });
  }
});

module.exports = router;
