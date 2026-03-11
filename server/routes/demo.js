const router = require('express').Router();
const db = require('../db');
const { generateVerificationCode } = require('../services/tokenService');
const { analyzeUnboxing } = require('../services/aiService');
const { unboxingUpload } = require('../middleware/upload');

const DEMO_COMPANY_ID = 1;

router.post('/order', async (req, res, next) => {
  try {
    const { product_name, customer_email, order_amount } = req.body;
    const { code, hash } = generateVerificationCode(Date.now() + Math.random());
    const extId = 'DEMO-' + Date.now();
    const r = await db.run(
      `INSERT INTO b2b_orders (company_id, external_order_id, customer_email, customer_name, product_name, order_amount, verification_code, verification_code_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      DEMO_COMPANY_ID, extId, customer_email || 'demo@example.com', 'Demo User', product_name || 'Produit démo', parseFloat(order_amount) || 99, code, hash
    );
    res.json({ order_id: r.lastInsertRowid, verification_code: code, external_order_id: extId });
  } catch(e) { next(e); }
});

router.patch('/orders/:id/ship', async (req, res, next) => {
  try {
    await db.run("UPDATE b2b_orders SET status='shipped', tracking_number=?, updated_at=datetime('now') WHERE id=?", req.body.tracking_number || 'FR700000000', req.params.id);
    res.json({ message: 'Expédié', status: 'shipped' });
  } catch(e) { next(e); }
});

router.patch('/orders/:id/deliver', async (req, res, next) => {
  try {
    const order = await db.get('SELECT * FROM b2b_orders WHERE id = ?', req.params.id);
    if (!order) return res.status(404).json({ error: 'Introuvable' });
    await db.run("UPDATE b2b_orders SET status='unboxing_pending', unboxing_deadline=datetime('now','+48 hours'), updated_at=datetime('now') WHERE id=?", req.params.id);
    res.json({ message: 'Livraison confirmée', verification_code: order.verification_code, unboxing_url: `${req.protocol}://${req.get('host')}/unboxing-customer.html?order=${order.id}` });
  } catch(e) { next(e); }
});

router.post('/orders/:id/submit',
  unboxingUpload.fields([{ name: 'photos', maxCount: 5 }]),
  async (req, res, next) => {
    try {
      const photoFiles = req.files?.photos || [];
      const codeVisible = req.body.code_visible === 'true' ? 1 : 0;
      const conditionOk = req.body.condition_ok !== 'false' ? 1 : 0;
      const analysis = analyzeUnboxing({ hasVideo: false, photoCount: photoFiles.length > 0 ? photoFiles.length : 1, codeVisible: codeVisible === 1, conditionOk: conditionOk === 1 });
      const photoUrls = JSON.stringify(photoFiles.map(f => `/uploads/unboxing/demo_${req.params.id}/${f.filename}`));
      try {
        await db.run('INSERT OR REPLACE INTO b2b_unboxings (b2b_order_id, company_id, photo_urls, code_visible, condition_ok, ai_confidence) VALUES (?, ?, ?, ?, ?, ?)', req.params.id, DEMO_COMPANY_ID, photoUrls, codeVisible, conditionOk, analysis.confidence);
      } catch(e) {}
      await db.run("UPDATE b2b_orders SET status='unboxing_submitted', updated_at=datetime('now') WHERE id=?", req.params.id);
      res.json({ success: true, ai_confidence: analysis.confidence, ai_label: analysis.label, ai_recommendation: analysis.recommendation, flags: analysis.flags, positives: analysis.positives });
    } catch(e) { next(e); }
  }
);

router.post('/orders/:id/complete', async (req, res, next) => {
  try {
    await db.run("UPDATE b2b_orders SET status='completed', updated_at=datetime('now') WHERE id=?", req.params.id);
    res.json({ message: 'Commande complétée !' });
  } catch(e) { next(e); }
});

module.exports = router;
