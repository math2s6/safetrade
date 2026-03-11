const cron = require('node-cron');
const db = require('../db');
const { releaseFunds } = require('../services/escrowService');
const { notify } = require('../services/notificationService');

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

function startCron() {
  cron.schedule('*/15 * * * *', () => runExpiry().catch(console.error));
  console.log('[CRON] Vérification expiration unboxing démarrée (toutes les 15min)');
  runExpiry().catch(console.error);
}

module.exports = { startCron };
