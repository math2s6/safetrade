const router = require('express').Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { releaseFunds, refundFunds } = require('../services/escrowService');
const { notify } = require('../services/notificationService');

router.get('/stats', requireAdmin, async (req, res) => {
  const [users, listings, orders, completed, disputed, revenue, unboxingPending] = await Promise.all([
    db.get('SELECT COUNT(*) as c FROM users'),
    db.get("SELECT COUNT(*) as c FROM listings WHERE status = 'active'"),
    db.get('SELECT COUNT(*) as c FROM orders'),
    db.get("SELECT COUNT(*) as c FROM orders WHERE status = 'completed'"),
    db.get("SELECT COUNT(*) as c FROM orders WHERE status = 'disputed'"),
    db.get("SELECT COALESCE(SUM(platform_fee),0) as r FROM orders WHERE status = 'completed'"),
    db.get("SELECT COUNT(*) as c FROM orders WHERE status = 'unboxing_pending'"),
  ]);
  res.json({
    users: users.c, listings: listings.c, orders: orders.c,
    completed: completed.c, disputed: disputed.c,
    revenue: revenue.r, unboxingPending: unboxingPending.c,
  });
});

router.get('/disputes', requireAdmin, async (req, res) => {
  const disputes = await db.all(`
    SELECT d.*, o.amount, o.verification_code,
           b.username as buyer_name, s.username as seller_name, l.title
    FROM disputes d JOIN orders o ON o.id = d.order_id
    JOIN users b ON b.id = d.buyer_id JOIN users s ON s.id = d.seller_id
    JOIN listings l ON l.id = o.listing_id
    WHERE d.status = 'open' ORDER BY d.created_at
  `);
  res.json(disputes);
});

router.post('/disputes/:id/resolve', requireAdmin, async (req, res, next) => {
  try {
    const { resolution, admin_notes } = req.body;
    if (!['buyer', 'seller'].includes(resolution)) return res.status(400).json({ error: 'Resolution: buyer ou seller' });
    const dispute = await db.get('SELECT * FROM disputes WHERE id = ?', req.params.id);
    if (!dispute || dispute.status !== 'open') return res.status(404).json({ error: 'Litige introuvable ou déjà résolu' });

    if (resolution === 'buyer') {
      await refundFunds(dispute.order_id, 'Litige: remboursement acheteur');
      await db.run("UPDATE orders SET status='refunded', updated_at=datetime('now') WHERE id=?", dispute.order_id);
    } else {
      await releaseFunds(dispute.order_id, 'Litige: libération vendeur');
      await db.run("UPDATE orders SET status='completed', updated_at=datetime('now') WHERE id=?", dispute.order_id);
      await db.run("UPDATE listings SET status='sold' WHERE id = (SELECT listing_id FROM orders WHERE id = ?)", dispute.order_id);
    }
    await db.run(`UPDATE disputes SET status=?, admin_notes=?, resolved_by=?, resolved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`, resolution === 'buyer' ? 'resolved_buyer' : 'resolved_seller', admin_notes || '', req.user.id, dispute.id);
    await notify(dispute.buyer_id, 'dispute_resolved', { disputeId: dispute.id, resolution });
    await notify(dispute.seller_id, 'dispute_resolved', { disputeId: dispute.id, resolution });

    res.json({ message: `Litige résolu en faveur du ${resolution === 'buyer' ? 'acheteur' : 'vendeur'}` });
  } catch (e) { next(e); }
});

router.get('/unboxing/pending', requireAdmin, async (req, res) => {
  const submissions = await db.all(`
    SELECT us.*, o.verification_code, o.amount,
           b.username as buyer_name, s.username as seller_name, l.title
    FROM unboxing_submissions us
    JOIN orders o ON o.id = us.order_id
    JOIN users b ON b.id = us.buyer_id
    JOIN users s ON s.id = o.seller_id
    JOIN listings l ON l.id = o.listing_id
    WHERE us.admin_code_verified IS NULL ORDER BY us.submitted_at
  `);
  res.json(submissions.map(s => ({ ...s, photo_urls: JSON.parse(s.photo_urls) })));
});

router.post('/unboxing/:id/verify', requireAdmin, async (req, res, next) => {
  try {
    const { verified } = req.body;
    await db.run('UPDATE unboxing_submissions SET admin_code_verified = ?, reviewed_at = datetime(\'now\'), reviewed_by = ? WHERE id = ?', verified ? 1 : 0, req.user.id, req.params.id);
    res.json({ message: 'Vérification enregistrée' });
  } catch (e) { next(e); }
});

router.get('/users', requireAdmin, async (req, res) => {
  const users = await db.all('SELECT id, email, username, role, balance, escrow_balance, rating_avg, rating_count, is_banned, created_at FROM users ORDER BY created_at DESC');
  res.json(users);
});

router.put('/users/:id/ban', requireAdmin, async (req, res, next) => {
  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    await db.run('UPDATE users SET is_banned = ? WHERE id = ?', user.is_banned ? 0 : 1, user.id);
    res.json({ message: user.is_banned ? 'Utilisateur débanné' : 'Utilisateur banni' });
  } catch (e) { next(e); }
});

module.exports = router;
