const db = require('../db');
const { notify } = require('./notificationService');

async function lockFunds(buyerId, sellerId, orderId, amount, platformFee, sellerPayout) {
  const buyer = await db.get('SELECT balance, escrow_balance FROM users WHERE id = ?', buyerId);
  if (!buyer || buyer.balance < amount) throw new Error('Solde insuffisant');
  await db.run('UPDATE users SET balance = balance - ?, escrow_balance = escrow_balance + ? WHERE id = ?', amount, amount, buyerId);
  await db.run(
    'INSERT INTO ledger (order_id, user_id, type, amount, balance_after, note) VALUES (?, ?, ?, ?, ?, ?)',
    orderId, buyerId, 'escrow_in', amount, buyer.balance - amount, 'Achat - fonds en séquestre'
  );
}

async function releaseFunds(orderId, note = '') {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) throw new Error('Commande introuvable');
  await db.run('UPDATE users SET balance = balance + ?, escrow_balance = escrow_balance - ? WHERE id = ?', order.seller_payout, order.amount, order.seller_id);
  await db.run('UPDATE users SET escrow_balance = escrow_balance - ? WHERE id = ?', order.amount, order.buyer_id);
  const seller = await db.get('SELECT balance FROM users WHERE id = ?', order.seller_id);
  await db.run(
    'INSERT INTO ledger (order_id, user_id, type, amount, balance_after, note) VALUES (?, ?, ?, ?, ?, ?)',
    orderId, order.seller_id, 'escrow_release', order.seller_payout, seller.balance, note || 'Libération des fonds'
  );
  await notify(order.seller_id, 'funds_released', { orderId, amount: order.seller_payout });
  await notify(order.buyer_id, 'order_completed', { orderId });
}

async function refundFunds(orderId, note = '') {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) throw new Error('Commande introuvable');
  await db.run('UPDATE users SET balance = balance + ?, escrow_balance = escrow_balance - ? WHERE id = ?', order.amount, order.amount, order.buyer_id);
  const buyer = await db.get('SELECT balance FROM users WHERE id = ?', order.buyer_id);
  await db.run(
    'INSERT INTO ledger (order_id, user_id, type, amount, balance_after, note) VALUES (?, ?, ?, ?, ?, ?)',
    orderId, order.buyer_id, 'escrow_refund', order.amount, buyer.balance, note || 'Remboursement'
  );
  await notify(order.buyer_id, 'order_refunded', { orderId, amount: order.amount });
  await notify(order.seller_id, 'order_refunded_seller', { orderId });
}

module.exports = { lockFunds, releaseFunds, refundFunds };
