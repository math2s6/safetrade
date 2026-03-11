const db = require('../db');

async function notify(userId, type, payload = {}) {
  try {
    await db.run(`INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)`, userId, type, JSON.stringify(payload));
  } catch (e) {
    console.error('Notification error:', e.message);
  }
}

module.exports = { notify };
