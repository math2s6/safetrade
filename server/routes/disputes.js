const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('../services/notificationService');

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { orderId, reason, description } = req.body;
    const order = await db.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (order.buyer_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
    if (order.status !== 'unboxing_uploaded') return res.status(400).json({ error: 'Litige impossible à ce stade' });
    const existing = await db.get('SELECT id FROM disputes WHERE order_id = ?', orderId);
    if (existing) return res.status(409).json({ error: 'Un litige existe déjà' });

    const r = await db.run('INSERT INTO disputes (order_id, buyer_id, seller_id, reason, description) VALUES (?, ?, ?, ?, ?)', orderId, req.user.id, order.seller_id, reason, description);
    await db.run("UPDATE orders SET status='disputed', updated_at=datetime('now') WHERE id=?", orderId);
    await notify(order.seller_id, 'dispute_opened', { orderId, disputeId: r.lastInsertRowid });

    const admins = await db.all("SELECT id FROM users WHERE role = 'admin'");
    for (const a of admins) {
      await notify(a.id, 'dispute_opened_admin', { orderId, disputeId: r.lastInsertRowid });
    }

    res.status(201).json({ disputeId: r.lastInsertRowid, message: 'Litige ouvert. Un admin va examiner votre dossier.' });
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res) => {
  const dispute = await db.get(`
    SELECT d.*, o.amount, o.verification_code,
           b.username as buyer_name, s.username as seller_name,
           l.title as listing_title
    FROM disputes d
    JOIN orders o ON o.id = d.order_id
    JOIN users b ON b.id = d.buyer_id
    JOIN users s ON s.id = d.seller_id
    JOIN listings l ON l.id = o.listing_id
    WHERE d.id = ?
  `, req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Litige introuvable' });
  if (dispute.buyer_id !== req.user.id && dispute.seller_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorisé' });
  }
  const messages = await db.all(`
    SELECT dm.*, u.username FROM dispute_messages dm JOIN users u ON u.id = dm.sender_id WHERE dm.dispute_id = ? ORDER BY dm.created_at
  `, dispute.id);
  const unboxing = await db.get('SELECT * FROM unboxing_submissions WHERE order_id = ?', dispute.order_id);
  if (unboxing) unboxing.photo_urls = JSON.parse(unboxing.photo_urls);
  res.json({ ...dispute, messages, unboxing });
});

router.post('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const dispute = await db.get('SELECT * FROM disputes WHERE id = ?', req.params.id);
    if (!dispute) return res.status(404).json({ error: 'Litige introuvable' });
    if (dispute.buyer_id !== req.user.id && dispute.seller_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Non autorisé' });
    }
    await db.run('INSERT INTO dispute_messages (dispute_id, sender_id, message) VALUES (?, ?, ?)', dispute.id, req.user.id, req.body.message);
    res.json({ message: 'Message envoyé' });
  } catch (e) { next(e); }
});

module.exports = router;
