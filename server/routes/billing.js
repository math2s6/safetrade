const router = require('express').Router();
const db = require('../db');
const { requireCompanyAuth } = require('../middleware/companyAuth');

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY manquant');
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const PLANS = {
  pro: {
    name: 'Pro',
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
  },
  enterprise: {
    name: 'Enterprise',
    monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
    annual: process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL,
  }
};

// GET current billing status
router.get('/', requireCompanyAuth, async (req, res) => {
  const company = await db.get(
    'SELECT plan, stripe_status, stripe_subscription_id, monthly_orders_used FROM companies WHERE id = ?',
    req.company.id
  );
  const planLimits = { starter: 50, pro: 1000, enterprise: null };
  res.json({
    plan: company.plan,
    stripe_status: company.stripe_status,
    has_subscription: !!company.stripe_subscription_id,
    monthly_used: company.monthly_orders_used,
    monthly_limit: planLimits[company.plan] || 50,
  });
});

// POST create checkout session (upgrade)
router.post('/checkout', requireCompanyAuth, async (req, res, next) => {
  try {
    const stripe = getStripe();
    const { plan, interval = 'monthly' } = req.body;

    if (!PLANS[plan]) return res.status(400).json({ error: 'Plan invalide. Choisissez: pro ou enterprise' });
    const priceId = PLANS[plan][interval];
    if (!priceId) return res.status(400).json({ error: `Prix Stripe non configuré pour ${plan}/${interval}` });

    const company = await db.get('SELECT * FROM companies WHERE id = ?', req.company.id);
    const appUrl = process.env.APP_URL || 'https://unboxproof.io';

    // Get or create Stripe customer
    let customerId = company.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: company.email,
        name: company.name,
        metadata: { company_id: String(company.id) }
      });
      customerId = customer.id;
      await db.run('UPDATE companies SET stripe_customer_id = ? WHERE id = ?', customerId, company.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/company/?billing=success`,
      cancel_url: `${appUrl}/company/?billing=cancelled`,
      metadata: { company_id: String(company.id), plan },
      subscription_data: {
        metadata: { company_id: String(company.id), plan }
      },
      allow_promotion_codes: true,
    });

    res.json({ url: session.url });
  } catch(e) { next(e); }
});

// POST open billing portal (manage subscription)
router.post('/portal', requireCompanyAuth, async (req, res, next) => {
  try {
    const stripe = getStripe();
    const company = await db.get('SELECT stripe_customer_id FROM companies WHERE id = ?', req.company.id);
    if (!company.stripe_customer_id) {
      return res.status(400).json({ error: 'Aucun abonnement actif. Souscrivez d\'abord un plan.' });
    }
    const appUrl = process.env.APP_URL || 'https://unboxproof.io';
    const session = await stripe.billingPortal.sessions.create({
      customer: company.stripe_customer_id,
      return_url: `${appUrl}/company/`,
    });
    res.json({ url: session.url });
  } catch(e) { next(e); }
});

module.exports = router;
