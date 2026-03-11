const router = require('express').Router();
const db = require('../db');

const PLAN_FROM_PRICE = {}; // populated dynamically from env

function planFromMetadata(metadata) {
  return metadata?.plan || 'pro';
}

// Must use raw body for Stripe signature verification
router.post('/', require('express').raw({ type: 'application/json' }), async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) return res.sendStatus(200);

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = webhookSecret
      ? stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
      : JSON.parse(req.body);
  } catch(e) {
    console.error('[Stripe] Webhook signature error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const companyId = session.metadata?.company_id;
        const plan = session.metadata?.plan || 'pro';
        if (!companyId) break;
        await db.run(
          "UPDATE companies SET plan=?, stripe_subscription_id=?, stripe_status='active' WHERE id=?",
          plan, session.subscription, companyId
        );
        console.log(`[Stripe] ✅ Upgrade ${plan} — company #${companyId}`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const companyId = sub.metadata?.company_id;
        if (!companyId) break;
        const plan = planFromMetadata(sub.metadata);
        const status = sub.status; // active, past_due, canceled, etc.
        await db.run(
          'UPDATE companies SET stripe_status=?, plan=? WHERE stripe_subscription_id=?',
          status, status === 'active' ? plan : 'starter', sub.id
        );
        console.log(`[Stripe] 🔄 Subscription updated: ${status} — company #${companyId}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await db.run(
          "UPDATE companies SET plan='starter', stripe_status='cancelled', stripe_subscription_id=NULL WHERE stripe_subscription_id=?",
          sub.id
        );
        console.log(`[Stripe] ❌ Subscription cancelled: ${sub.id}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription).catch(() => null);
        if (sub?.metadata?.company_id) {
          await db.run(
            "UPDATE companies SET stripe_status='past_due' WHERE id=?",
            sub.metadata.company_id
          );
          console.log(`[Stripe] ⚠️ Payment failed — company #${sub.metadata.company_id}`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await db.run(
            "UPDATE companies SET stripe_status='active' WHERE stripe_subscription_id=?",
            invoice.subscription
          );
        }
        break;
      }
    }
  } catch(e) {
    console.error('[Stripe] Webhook handler error:', e.message);
  }

  res.sendStatus(200);
});

module.exports = router;
