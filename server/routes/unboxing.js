const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { unboxingUpload } = require('../middleware/upload');
const { releaseFunds } = require('../services/escrowService');
const { notify } = require('../services/notificationService');

router.get('/:orderId/code', requireAuth, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (order.buyer_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
  if (!['unboxing_pending', 'unboxing_uploaded'].includes(order.status)) {
    return res.status(400).json({ error: 'Code non disponible pour cette commande' });
  }
  const listing = await db.get('SELECT title FROM listings WHERE id = ?', order.listing_id);
  const thumbnail = await db.get('SELECT url FROM listing_images WHERE listing_id = ? ORDER BY sort_order LIMIT 1', order.listing_id);
  res.json({
    verification_code: order.verification_code,
    deadline: order.unboxing_deadline,
    order_summary: { id: order.id, title: listing?.title, thumbnail: thumbnail?.url, amount: order.amount }
  });
});

router.post('/:orderId/submit', requireAuth,
  (req, res, next) => { req.params.orderId = req.params.orderId; next(); },
  unboxingUpload.fields([{ name: 'video', maxCount: 1 }, { name: 'photos', maxCount: 10 }]),
  async (req, res, next) => {
    try {
      const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.orderId);
      if (!order) return res.status(404).json({ error: 'Commande introuvable' });
      if (order.buyer_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
      if (order.status !== 'unboxing_pending') return res.status(400).json({ error: `Statut invalide: ${order.status}` });
      if (new Date() > new Date(order.unboxing_deadline)) return res.status(400).json({ error: 'Délai d\'unboxing expiré' });

      const videoFile = req.files?.video?.[0];
      const photoFiles = req.files?.photos || [];
      if (!videoFile && photoFiles.length === 0) return res.status(400).json({ error: 'Au moins une photo ou une vidéo est requise' });

      const videoUrl = videoFile ? `/uploads/unboxing/${req.params.orderId}/${videoFile.filename}` : null;
      const photoUrls = JSON.stringify(photoFiles.map(f => `/uploads/unboxing/${req.params.orderId}/${f.filename}`));
      const codeVisible = req.body.code_visible_confirmed === 'true' || req.body.code_visible_confirmed === true ? 1 : 0;
      const conditionMatches = req.body.condition_matches === 'true' ? 1 : req.body.condition_matches === 'false' ? 0 : null;

      await db.run(`INSERT INTO unboxing_submissions (order_id, buyer_id, video_url, photo_urls, code_visible_confirmed, condition_matches, buyer_notes) VALUES (?, ?, ?, ?, ?, ?, ?)`, order.id, req.user.id, videoUrl, photoUrls, codeVisible, conditionMatches, req.body.buyer_notes || '');
      await db.run("UPDATE orders SET status='unboxing_uploaded', updated_at=datetime('now') WHERE id=?", order.id);
      await notify(order.seller_id, 'unboxing_submitted', { orderId: order.id });
      await notify(order.buyer_id, 'unboxing_uploaded', { orderId: order.id });
      res.json({ message: 'Unboxing soumis. Confirmez si tout est correct ou ouvrez un litige.' });
    } catch (e) { next(e); }
  }
);

router.post('/:orderId/confirm', requireAuth, async (req, res, next) => {
  try {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (order.buyer_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
    if (order.status !== 'unboxing_uploaded') return res.status(400).json({ error: `Statut invalide: ${order.status}` });
    await releaseFunds(order.id, 'Confirmé par l\'acheteur');
    await db.run("UPDATE orders SET status='completed', updated_at=datetime('now') WHERE id=?", order.id);
    await db.run("UPDATE listings SET status='sold' WHERE id=?", order.listing_id);
    res.json({ message: 'Transaction complétée. Les fonds ont été libérés au vendeur.' });
  } catch (e) { next(e); }
});

router.get('/:orderId', requireAuth, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (order.buyer_id !== req.user.id && order.seller_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorisé' });
  }
  const submission = await db.get('SELECT * FROM unboxing_submissions WHERE order_id = ?', order.id);
  if (!submission) return res.status(404).json({ error: 'Aucune soumission' });
  res.json({ ...submission, photo_urls: JSON.parse(submission.photo_urls) });
});

module.exports = router;
