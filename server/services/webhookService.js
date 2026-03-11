const db = require('../db');

async function sendWebhook(companyId, event, data) {
  try {
    const company = await db.get('SELECT webhook_url, name FROM companies WHERE id = ?', companyId);
    if (!company?.webhook_url) return;

    const payload = {
      event,
      company: company.name,
      timestamp: new Date().toISOString(),
      data
    };

    const res = await fetch(company.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-UnboxProof-Event': event, 'X-UnboxProof-Version': '1.0' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });

    console.log(`🔔 Webhook [${event}] → ${company.webhook_url} (${res.status})`);
  } catch(e) {
    console.error(`🔔 Webhook error [${event}]:`, e.message);
  }
}

module.exports = { sendWebhook };
