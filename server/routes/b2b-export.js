const router = require('express').Router();
const db = require('../db');
const { requireCompanyAuth } = require('../middleware/companyAuth');

router.use(requireCompanyAuth);

// GET /api/company/export/orders.csv
router.get('/orders.csv', (req, res) => {
  const { status } = req.query;
  let where = 'o.company_id = ?';
  const params = [req.company.id];
  if (status) { where += ' AND o.status = ?'; params.push(status); }

  const orders = db.prepare(`
    SELECT o.id, o.external_order_id, o.customer_name, o.customer_email,
           o.product_name, o.order_amount, o.currency, o.status,
           o.tracking_number, o.carrier,
           o.created_at, o.updated_at,
           u.ai_confidence, u.code_visible, u.condition_ok, u.resolution
    FROM b2b_orders o
    LEFT JOIN b2b_unboxings u ON u.b2b_order_id = o.id
    WHERE ${where}
    ORDER BY o.created_at DESC
  `).all(...params);

  const headers = ['ID', 'ID Externe', 'Client', 'Email', 'Produit', 'Montant', 'Devise', 'Statut', 'Suivi', 'Transporteur', 'Confiance IA', 'Code Visible', 'État OK', 'Résolution', 'Créé le', 'Mis à jour le'];
  const rows = orders.map(o => [
    o.id, o.external_order_id, o.customer_name, o.customer_email,
    o.product_name, o.order_amount, o.currency, o.status,
    o.tracking_number || '', o.carrier || '',
    o.ai_confidence ? Math.round(o.ai_confidence * 100) + '%' : '',
    o.code_visible === 1 ? 'Oui' : o.code_visible === 0 ? 'Non' : '',
    o.condition_ok === 1 ? 'Oui' : o.condition_ok === 0 ? 'Non' : '',
    o.resolution || '',
    o.created_at, o.updated_at
  ]);

  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="safetrade-orders-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('\uFEFF' + csv); // BOM for Excel
});

module.exports = router;
