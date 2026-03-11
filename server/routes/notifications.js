const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const notifs = await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', req.user.id);
  const unread = await db.get('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0', req.user.id);
  res.json({ notifications: notifs.map(n => ({ ...n, payload: JSON.parse(n.payload) })), unread: unread.c });
});

router.put('/read-all', requireAuth, async (req, res) => {
  await db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', req.user.id);
  res.json({ message: 'Toutes les notifications lues' });
});

router.put('/:id/read', requireAuth, async (req, res) => {
  await db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ message: 'OK' });
});

module.exports = router;
