const cron = require('node-cron');
const db = require('../db');
const { releaseFunds } = require('../services/escrowService');
const { notify } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');

async function runExpiry() {
  const expired = await db.all(`
    SELECT * FROM orders
    WHERE status = 'unboxing_pending'
    AND unboxing_deadline < datetime('now')
    AND unboxing_auto_release = 0
  `);

  for (const order of expired) {
    try {
      await releaseFunds(order.id, 'Libération auto - délai 48h expiré');
      await db.run("UPDATE orders SET status='completed', unboxing_auto_release=1, updated_at=datetime('now') WHERE id=?", order.id);
      await db.run("UPDATE listings SET status='sold' WHERE id=?", order.listing_id);
      await notify(order.seller_id, 'funds_auto_released', { orderId: order.id });
      await notify(order.buyer_id, 'unboxing_expired', { orderId: order.id });
      console.log(`[CRON] Commande #${order.id} - fonds libérés (48h expirés)`);
    } catch (e) {
      console.error(`[CRON] Erreur commande #${order.id}:`, e.message);
    }
  }
}

async function runUnboxingReminders() {
  try {
    // B2B orders shipped 24-25h ago with no unboxing yet
    const toRemind = await db.all(`
      SELECT o.*, c.name as company_name
      FROM b2b_orders o
      JOIN companies c ON c.id = o.company_id
      WHERE o.status = 'shipped'
      AND o.updated_at BETWEEN datetime('now', '-25 hours') AND datetime('now', '-24 hours')
    `);

    for (const order of toRemind) {
      try {
        const appUrl = process.env.APP_URL || 'https://unboxproof.io';
        const unboxingUrl = `${appUrl}/unboxing-customer.html?order=${order.id}&code=${order.verification_code}`;
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:-apple-system,sans-serif;background:#f1f5f9;padding:24px}
.c{max-width:560px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08)}
.h{background:linear-gradient(135deg,#f59e0b,#d97706);padding:32px;text-align:center}
.h h1{color:white;font-size:20px;margin:0 0 6px}.h p{color:rgba(255,255,255,.8);font-size:14px;margin:0}
.b{padding:32px}
.b p{font-size:15px;color:#334155;line-height:1.7;margin:0 0 16px}
.code-box{background:#fef3c7;border:2px dashed #f59e0b;border-radius:12px;padding:20px;text-align:center;margin:20px 0}
.code{font-size:36px;font-weight:900;letter-spacing:8px;color:#92400e;font-family:monospace}
.code-label{font-size:13px;color:#92400e;margin-top:6px}
.deadline{background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 16px;font-size:14px;color:#dc2626;margin:16px 0;text-align:center;font-weight:600}
.footer{padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;font-size:13px;color:#94a3b8}
.footer a{color:#4f46e5;text-decoration:none}
</style></head><body><div class="c">
<div class="h"><h1>⏰ Rappel — Votre unboxing expire bientôt</h1><p>Il vous reste 24h pour protéger votre achat</p></div>
<div class="b">
<p>Vous avez reçu votre commande <strong>"${order.product_name}"</strong> chez <strong>${order.company_name}</strong>.</p>
<p>Vous n'avez pas encore réalisé votre unboxing sécurisé. <strong>Il vous reste 24h</strong> — après quoi la commande sera automatiquement validée.</p>
<div class="code-box">
<div class="code">${order.verification_code}</div>
<div class="code-label">Votre code à montrer dans la vidéo</div>
</div>
<div class="deadline">⚠️ Expire dans environ 24h</div>
<p style="text-align:center"><a href="${unboxingUrl}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:14px 28px;border-radius:12px;font-weight:700;font-size:15px;text-decoration:none">🎥 Faire mon unboxing maintenant →</a></p>
</div>
<div class="footer">© 2025 <strong>UnboxProof</strong> — <a href="${appUrl}">unboxproof.io</a></div>
</div></body></html>`;

        await sendEmail(order.customer_email, `⏰ Rappel — Votre unboxing "${order.product_name}" expire bientôt`, html);
        console.log(`[CRON] Rappel unboxing envoyé à ${order.customer_email} (commande #${order.id})`);
      } catch(e) {
        console.error(`[CRON] Erreur rappel #${order.id}:`, e.message);
      }
    }
  } catch(e) {
    console.error('[CRON] Erreur runUnboxingReminders:', e.message);
  }
}

async function resetMonthlyCounters() {
  try {
    await db.run('UPDATE companies SET monthly_orders_used = 0');
    console.log('[CRON] Compteurs mensuels réinitialisés');
  } catch(e) {
    console.error('[CRON] Erreur reset mensuel:', e.message);
  }
}

function startCron() {
  cron.schedule('*/15 * * * *', () => runExpiry().catch(console.error));
  cron.schedule('0 * * * *', () => runUnboxingReminders().catch(console.error));
  cron.schedule('0 0 1 * *', () => resetMonthlyCounters().catch(console.error)); // 1er du mois à minuit
  console.log('[CRON] Vérification expiration unboxing démarrée (toutes les 15min)');
  console.log('[CRON] Rappels unboxing démarrés (toutes les heures)');
  console.log('[CRON] Reset compteurs mensuels actif (1er du mois)');
  runExpiry().catch(console.error);
}

module.exports = { startCron };
