const router = require('express').Router();
const db = require('../db');

// Simple admin secret auth (set ADMIN_SECRET in .env)
function requireAdminSecret(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  const token = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || token !== secret) return res.status(401).json({ error: 'Non autorisé' });
  next();
}

router.use(requireAdminSecret);

router.get('/stats', async (req, res) => {
  const [companies, orders, unboxings, fraudPrevented, toReview] = await Promise.all([
    db.get('SELECT COUNT(*) as c FROM companies WHERE is_active = 1'),
    db.get('SELECT COUNT(*) as c FROM b2b_orders'),
    db.get('SELECT COUNT(*) as c FROM b2b_unboxings'),
    db.get('SELECT COALESCE(SUM(total_fraud_prevented),0) as c FROM companies'),
    db.get("SELECT COUNT(*) as c FROM b2b_orders WHERE status = 'unboxing_submitted'"),
  ]);
  const planCounts = await db.all("SELECT plan, COUNT(*) as c FROM companies WHERE is_active=1 GROUP BY plan");
  res.json({
    companies: companies.c,
    orders: orders.c,
    unboxings: unboxings.c,
    fraud_prevented: fraudPrevented.c,
    to_review: toReview.c,
    plans: planCounts,
  });
});

router.get('/companies', async (req, res) => {
  const companies = await db.all(`
    SELECT c.*,
      (SELECT COUNT(*) FROM b2b_orders WHERE company_id = c.id) as order_count,
      (SELECT COUNT(*) FROM b2b_orders WHERE company_id = c.id AND status = 'unboxing_submitted') as pending_review
    FROM companies c
    ORDER BY c.created_at DESC
  `);
  res.json(companies);
});

router.get('/orders', async (req, res) => {
  const { status, page = 1 } = req.query;
  let where = '1=1';
  const params = [];
  if (status) { where += ' AND o.status = ?'; params.push(status); }
  const orders = await db.all(
    `SELECT o.*, c.name as company_name FROM b2b_orders o JOIN companies c ON c.id = o.company_id WHERE ${where} ORDER BY o.created_at DESC LIMIT 50 OFFSET ?`,
    ...params, (parseInt(page) - 1) * 50
  );
  const total = await db.get(`SELECT COUNT(*) as c FROM b2b_orders o WHERE ${where}`, ...params);
  res.json({ orders, total: total.c });
});

router.put('/companies/:id/plan', async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!['starter', 'pro', 'enterprise'].includes(plan)) return res.status(400).json({ error: 'Plan invalide' });
    await db.run('UPDATE companies SET plan=? WHERE id=?', plan, req.params.id);
    res.json({ message: 'Plan mis à jour' });
  } catch(e) { next(e); }
});

router.put('/companies/:id/toggle', async (req, res, next) => {
  try {
    const company = await db.get('SELECT is_active FROM companies WHERE id = ?', req.params.id);
    if (!company) return res.status(404).json({ error: 'Introuvable' });
    await db.run('UPDATE companies SET is_active=? WHERE id=?', company.is_active ? 0 : 1, req.params.id);
    res.json({ message: company.is_active ? 'Compte désactivé' : 'Compte réactivé' });
  } catch(e) { next(e); }
});

module.exports = router;
