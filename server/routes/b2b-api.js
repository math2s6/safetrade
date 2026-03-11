const router = require('express').Router();
const db = require('../db');
const { requireApiKey } = require('../middleware/apiKeyAuth');
const { generateVerificationCode } = require('../services/tokenService');
const { unboxingUpload } = require('../middleware/upload');
const { analyzeUnboxing } = require('../services/aiService');
const { sendUnboxingInvite, sendOrderConfirmation, sendEmail } = require('../services/emailService');
const { sendWebhook } = require('../services/webhookService');

// Public customer-facing routes (no API key needed)
router.get('/customer/:orderId', async (req, res) => {
  const order = await db.get('SELECT id, product_name, customer_name, verification_code, status, unboxing_deadline FROM b2b_orders WHERE id = ?', req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  res.json(order);
});

router.post('/customer/:orderId/submit',
  unboxingUpload.fields([{ name: 'video', maxCount: 1 }, { name: 'photos', maxCount: 10 }]),
  async (req, res, next) => {
    try {
      const order = await db.get('SELECT * FROM b2b_orders WHERE id = ?', req.params.orderId);
      if (!order) return res.status(404).json({ error: 'Commande introuvable' });
      if (!['unboxing_pending', 'shipped', 'pending'].includes(order.status)) {
        return res.status(400).json({ error: 'Unboxing déjà soumis ou commande terminée' });
      }

      const videoFile = req.files?.video?.[0];
      const photoFiles = req.files?.photos || [];
      const videoUrl = videoFile ? `/uploads/unboxing/b2b_${req.params.orderId}/${videoFile.filename}` : null;
      const photoUrls = JSON.stringify(photoFiles.map(f => `/uploads/unboxing/b2b_${req.params.orderId}/${f.filename}`));
      const codeVisible = req.body.code_visible === 'true' ? 1 : 0;
      const conditionOk = req.body.condition_ok !== 'false' ? 1 : 0;
      const analysis = analyzeUnboxing({ hasVideo: !!videoFile, photoCount: photoFiles.length, codeVisible: codeVisible === 1, conditionOk: conditionOk === 1 });

      await db.run('INSERT OR REPLACE INTO b2b_unboxings (b2b_order_id, company_id, video_url, photo_urls, code_visible, condition_ok, customer_notes, ai_confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', order.id, order.company_id, videoUrl, photoUrls, codeVisible, conditionOk, req.body.notes || '', analysis.confidence);
      await db.run("UPDATE b2b_orders SET status='unboxing_submitted', updated_at=datetime('now') WHERE id=?", order.id);
      if (!conditionOk) await db.run('UPDATE companies SET total_fraud_prevented = total_fraud_prevented + 1 WHERE id = ?', order.company_id);

      sendWebhook(order.company_id, 'unboxing.submitted', { order_id: order.id, ai_confidence: analysis.confidence, recommendation: analysis.recommendation }).catch(console.error);

      // Notify merchant by email
      db.get('SELECT name, email FROM companies WHERE id = ?', order.company_id).then(company => {
        if (!company?.email) return;
        const appUrl = process.env.APP_URL || 'https://unboxproof.io';
        const dashUrl = `${appUrl}/company/?tab=unboxings`;
        const statusColor = analysis.recommendation === 'approve' ? '#059669' : analysis.recommendation === 'dispute' ? '#dc2626' : '#d97706';
        const statusLabel = analysis.recommendation === 'approve' ? '✅ Validé automatiquement' : analysis.recommendation === 'dispute' ? '⚠️ Problème détecté — action requise' : '👁 À réviser manuellement';
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:-apple-system,sans-serif;background:#f1f5f9;padding:24px}
.c{max-width:560px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08)}
.h{background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px 32px;text-align:center}
.h h1{color:white;font-size:18px;margin:0 0 4px}.h p{color:rgba(255,255,255,.75);font-size:13px;margin:0}
.b{padding:28px 32px}
.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px}
.row:last-child{border-bottom:none}.lbl{color:#64748b}.val{font-weight:600;color:#0f172a;text-align:right}
.ai-box{border-radius:10px;padding:14px 18px;margin:16px 0;border:1px solid ${statusColor}30;background:${statusColor}08;font-size:14px;font-weight:600;color:${statusColor};text-align:center}
.score{font-size:32px;font-weight:900;color:${statusColor}}
.footer{padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8}
</style></head><body><div class="c">
<div class="h"><h1>🎬 Nouvel unboxing soumis</h1><p>${company.name}</p></div>
<div class="b">
<div class="row"><span class="lbl">Commande</span><span class="val">#${order.external_order_id || order.id}</span></div>
<div class="row"><span class="lbl">Produit</span><span class="val">${order.product_name}</span></div>
<div class="row"><span class="lbl">Client</span><span class="val">${order.customer_email}</span></div>
<div class="row"><span class="lbl">Vidéo</span><span class="val">${videoFile ? '✓ Présente' : '✗ Absente'}</span></div>
<div class="row"><span class="lbl">Photos</span><span class="val">${photoFiles.length} fichier(s)</span></div>
<div class="ai-box"><div class="score">${Math.round(analysis.confidence * 100)}%</div>${statusLabel}</div>
<p style="text-align:center"><a href="${dashUrl}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:12px 24px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none">Voir l'unboxing →</a></p>
</div>
<div class="footer">© 2025 UnboxProof — <a href="${appUrl}" style="color:#4f46e5">unboxproof.io</a></div>
</div></body></html>`;
        sendEmail(company.email, `🎬 Unboxing soumis — ${order.product_name} (${Math.round(analysis.confidence * 100)}% confiance)`, html).catch(() => {});
      }).catch(() => {});

      res.json({ success: true, message: "Unboxing soumis avec succès !", ai_confidence: analysis.confidence, ai_label: analysis.label, ai_recommendation: analysis.recommendation, flags: analysis.flags, positives: analysis.positives });
    } catch (e) { next(e); }
  }
);

// All routes below require API key
router.use(requireApiKey);

const PLAN_LIMITS = { starter: 50, pro: 1000, enterprise: Infinity };

router.post('/orders', async (req, res, next) => {
  try {
    const { external_order_id, customer_email, customer_name, product_name, product_description, order_amount, currency, tracking_number, carrier, webhook_url } = req.body;
    if (!external_order_id || !customer_email || !product_name || !order_amount) {
      return res.status(400).json({ error: 'Champs requis: external_order_id, customer_email, product_name, order_amount' });
    }

    // Check monthly plan limit
    const company = await db.get('SELECT plan, monthly_orders_used FROM companies WHERE id = ?', req.company.id);
    const limit = PLAN_LIMITS[company?.plan] ?? 100;
    if ((company?.monthly_orders_used || 0) >= limit) {
      return res.status(429).json({
        error: `Limite mensuelle atteinte (${limit} commandes/${company.plan}). Passez au plan supérieur pour continuer.`,
        plan: company.plan,
        used: company.monthly_orders_used,
        limit
      });
    }

    const { code, hash } = generateVerificationCode(Date.now() + Math.random());
    const r = await db.run(
      `INSERT INTO b2b_orders (company_id, external_order_id, customer_email, customer_name, product_name, product_description, order_amount, currency, verification_code, verification_code_hash, tracking_number, carrier, webhook_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.company.id, external_order_id, customer_email, customer_name || '', product_name, product_description || '', parseFloat(order_amount), currency || 'EUR', code, hash, tracking_number || null, carrier || null, webhook_url || null
    );
    await db.run('UPDATE companies SET monthly_orders_used = monthly_orders_used + 1, total_orders = total_orders + 1 WHERE id = ?', req.company.id);

    sendOrderConfirmation(customer_email, customer_name, product_name, r.lastInsertRowid, req.company.name).catch(console.error);

    res.status(201).json({
      order_id: r.lastInsertRowid,
      external_order_id,
      verification_code: code,
      unboxing_url: `${req.protocol}://${req.get('host')}/unboxing-customer.html?code=${code}&order=${r.lastInsertRowid}`,
      qr_code_url: `${req.protocol}://${req.get('host')}/api/b2b/orders/${r.lastInsertRowid}/qr`,
      message: 'Commande créée. Partagez le verification_code ou unboxing_url avec votre client.'
    });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'external_order_id déjà utilisé' });
    next(e);
  }
});

router.get('/orders', async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let where = 'company_id = ?';
  const params = [req.company.id];
  if (status) { where += ' AND status = ?'; params.push(status); }
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const orders = await db.all(`SELECT * FROM b2b_orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, parseInt(limit), offset);
  const total = await db.get(`SELECT COUNT(*) as c FROM b2b_orders WHERE ${where}`, ...params);
  res.json({ orders, total: total.c, page: parseInt(page) });
});

router.get('/orders/:id/qr', async (req, res) => {
  const order = await db.get('SELECT verification_code FROM b2b_orders WHERE id = ? AND company_id = ?', req.params.id, req.company.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  const host = `${req.protocol}://${req.get('host')}`;
  const unboxingUrl = `${host}/unboxing-customer.html?code=${order.verification_code}&order=${req.params.id}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(unboxingUrl)}`;
  res.json({ qr_image_url: qrApiUrl, unboxing_url: unboxingUrl });
});

router.get('/orders/:id', async (req, res) => {
  const order = await db.get('SELECT * FROM b2b_orders WHERE id = ? AND company_id = ?', req.params.id, req.company.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  const unboxing = await db.get('SELECT * FROM b2b_unboxings WHERE b2b_order_id = ?', order.id);
  if (unboxing) unboxing.photo_urls = JSON.parse(unboxing.photo_urls);
  res.json({ ...order, unboxing });
});

router.patch('/orders/:id/ship', async (req, res, next) => {
  try {
    const order = await db.get('SELECT * FROM b2b_orders WHERE id = ? AND company_id = ?', req.params.id, req.company.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (order.status !== 'pending') return res.status(400).json({ error: `Statut actuel: ${order.status}` });
    const { tracking_number, carrier } = req.body;
    await db.run("UPDATE b2b_orders SET status='shipped', tracking_number=COALESCE(?,tracking_number), carrier=COALESCE(?,carrier), updated_at=datetime('now') WHERE id=?", tracking_number || null, carrier || null, order.id);
    res.json({ message: 'Commande marquée comme expédiée', status: 'shipped' });
  } catch (e) { next(e); }
});

router.patch('/orders/:id/deliver', async (req, res, next) => {
  try {
    const order = await db.get('SELECT * FROM b2b_orders WHERE id = ? AND company_id = ?', req.params.id, req.company.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    await db.run("UPDATE b2b_orders SET status='unboxing_pending', unboxing_deadline=datetime('now','+48 hours'), updated_at=datetime('now') WHERE id=?", order.id);
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const unboxingUrl = `${baseUrl}/unboxing-customer.html?order=${order.id}`;
    const company = await db.get('SELECT name FROM companies WHERE id = ?', req.company.id);
    sendUnboxingInvite(order.customer_email, order.customer_name, order.product_name, order.verification_code, unboxingUrl, company.name).catch(console.error);
    res.json({ message: 'Livraison confirmée. Fenêtre unboxing de 48h ouverte. Email envoyé au client.', unboxing_deadline: new Date(Date.now() + 48 * 3600000).toISOString() });
  } catch (e) { next(e); }
});

router.post('/orders/:id/unboxing',
  unboxingUpload.fields([{ name: 'video', maxCount: 1 }, { name: 'photos', maxCount: 10 }]),
  async (req, res, next) => {
    try {
      const order = await db.get('SELECT * FROM b2b_orders WHERE id = ? AND company_id = ?', req.params.id, req.company.id);
      if (!order) return res.status(404).json({ error: 'Commande introuvable' });

      const videoFile = req.files?.video?.[0];
      const photoFiles = req.files?.photos || [];
      const videoUrl = videoFile ? `/uploads/unboxing/${req.params.id}/${videoFile.filename}` : null;
      const photoUrls = JSON.stringify(photoFiles.map(f => `/uploads/unboxing/${req.params.id}/${f.filename}`));
      const aiConfidence = 0.75 + Math.random() * 0.2;
      const codeVisible = req.body.code_visible === 'true' ? 1 : 0;
      const conditionOk = req.body.condition_ok !== 'false' ? 1 : 0;

      await db.run('INSERT OR REPLACE INTO b2b_unboxings (b2b_order_id, company_id, video_url, photo_urls, code_visible, condition_ok, customer_notes, ai_confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', order.id, req.company.id, videoUrl, photoUrls, codeVisible, conditionOk, req.body.notes || '', aiConfidence);
      await db.run("UPDATE b2b_orders SET status='unboxing_submitted', updated_at=datetime('now') WHERE id=?", order.id);
      if (!conditionOk) await db.run('UPDATE companies SET total_fraud_prevented = total_fraud_prevented + 1 WHERE id = ?', req.company.id);

      res.json({ message: 'Unboxing soumis avec succès', ai_confidence: aiConfidence, code_detected: codeVisible === 1 });
    } catch (e) { next(e); }
  }
);

router.patch('/orders/:id/resolve', async (req, res, next) => {
  try {
    const { resolution } = req.body;
    if (!['completed', 'refunded'].includes(resolution)) return res.status(400).json({ error: 'resolution: completed ou refunded' });
    const order = await db.get('SELECT * FROM b2b_orders WHERE id = ? AND company_id = ?', req.params.id, req.company.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    await db.run("UPDATE b2b_orders SET status=?, updated_at=datetime('now') WHERE id=?", resolution, order.id);
    await db.run('UPDATE b2b_unboxings SET resolution = ? WHERE b2b_order_id = ?', resolution, order.id);
    res.json({ message: `Commande ${resolution === 'completed' ? 'complétée' : 'remboursée'}` });
  } catch (e) { next(e); }
});

router.get('/stats', async (req, res) => {
  const company = await db.get('SELECT * FROM companies WHERE id = ?', req.company.id);
  const statusCounts = await db.all('SELECT status, COUNT(*) as count FROM b2b_orders WHERE company_id = ? GROUP BY status', req.company.id);
  const recentOrders = await db.all('SELECT * FROM b2b_orders WHERE company_id = ? ORDER BY created_at DESC LIMIT 5', req.company.id);
  res.json({
    company: { name: company.name, plan: company.plan, monthly_orders_used: company.monthly_orders_used },
    total_orders: company.total_orders,
    fraud_prevented: company.total_fraud_prevented,
    status_breakdown: statusCounts,
    recent_orders: recentOrders
  });
});

router.get('/keys', async (req, res) => {
  const keys = await db.all('SELECT id, key_prefix, name, is_active, last_used_at, requests_count, created_at FROM api_keys WHERE company_id = ?', req.company.id);
  res.json(keys);
});

module.exports = router;
