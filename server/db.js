require('dotenv').config();
const { createClient } = require('@libsql/client');

const client = createClient(
  process.env.TURSO_URL
    ? { url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN || '' }
    : { url: 'file:marketplace.db' }
);

const db = {
  async get(sql, ...args) {
    const r = await client.execute({ sql, args });
    return r.rows[0] ?? null;
  },
  async all(sql, ...args) {
    const r = await client.execute({ sql, args });
    return r.rows;
  },
  async run(sql, ...args) {
    const r = await client.execute({ sql, args });
    return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.rowsAffected };
  },
  prepare(sql) {
    return {
      get: (...args) => db.get(sql, ...args),
      all: (...args) => db.all(sql, ...args),
      run: (...args) => db.run(sql, ...args),
    };
  }
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  balance REAL NOT NULL DEFAULT 1000.00,
  escrow_balance REAL NOT NULL DEFAULT 0.00,
  rating_avg REAL NOT NULL DEFAULT 0.00,
  rating_count INTEGER NOT NULL DEFAULT 0,
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price REAL NOT NULL,
  category TEXT NOT NULL,
  condition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listing_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  platform_fee REAL NOT NULL DEFAULT 0.00,
  seller_payout REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  tracking_number TEXT,
  carrier TEXT,
  shipped_at TEXT,
  delivered_at TEXT,
  unboxing_deadline TEXT,
  unboxing_auto_release INTEGER DEFAULT 0,
  verification_code TEXT NOT NULL,
  verification_code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS unboxing_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  video_url TEXT,
  photo_urls TEXT NOT NULL DEFAULT '[]',
  code_visible_confirmed INTEGER NOT NULL DEFAULT 0,
  admin_code_verified INTEGER,
  condition_matches INTEGER,
  buyer_notes TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  admin_notes TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dispute_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_id INTEGER NOT NULL REFERENCES disputes(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER REFERENCES listings(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  rater_id INTEGER NOT NULL REFERENCES users(id),
  rated_id INTEGER NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  balance_after REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  logo_url TEXT,
  website TEXT,
  industry TEXT,
  plan TEXT NOT NULL DEFAULT 'starter',
  is_active INTEGER NOT NULL DEFAULT 1,
  monthly_orders_used INTEGER NOT NULL DEFAULT 0,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_fraud_prevented INTEGER NOT NULL DEFAULT 0,
  webhook_url TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Default',
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  requests_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS b2b_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  external_order_id TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  product_name TEXT NOT NULL,
  product_description TEXT,
  order_amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  verification_code TEXT NOT NULL,
  verification_code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tracking_number TEXT,
  carrier TEXT,
  webhook_url TEXT,
  unboxing_deadline TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, external_order_id)
);

CREATE TABLE IF NOT EXISTS b2b_unboxings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  b2b_order_id INTEGER NOT NULL UNIQUE REFERENCES b2b_orders(id),
  company_id INTEGER NOT NULL REFERENCES companies(id),
  video_url TEXT,
  photo_urls TEXT NOT NULL DEFAULT '[]',
  code_visible INTEGER,
  condition_ok INTEGER,
  customer_notes TEXT,
  ai_confidence REAL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  resolution TEXT
);

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  company TEXT,
  volume TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_company ON b2b_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)
`;

async function init() {
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
  await client.batch(statements.map(sql => ({ sql, args: [] })), 'write');

  const bcrypt = require('bcrypt');
  const crypto = require('crypto');
  const { generateVerificationCode } = require('./services/tokenService');

  const userCount = await db.get('SELECT COUNT(*) as c FROM users');
  if (Number(userCount.c) === 0) {
    const adminHash = await bcrypt.hash('admin123', 10);
    const userHash = await bcrypt.hash('user123', 10);

    await db.run(`INSERT INTO users (email, username, password_hash, role, balance) VALUES (?, ?, ?, 'admin', 9999)`, 'admin@marketplace.com', 'admin', adminHash);
    await db.run(`INSERT INTO users (email, username, password_hash, balance) VALUES (?, ?, ?, 500)`, 'alice@example.com', 'alice', userHash);
    await db.run(`INSERT INTO users (email, username, password_hash, balance) VALUES (?, ?, ?, 200)`, 'bob@example.com', 'bob', userHash);

    const items = [
      { title: 'iPhone 13 Pro - Excellent état', desc: 'iPhone 13 Pro 256Go, couleur graphite. Aucune rayure. Vendu avec chargeur original et coque.', price: 650, cat: 'Electronics', cond: 'like_new', seller: 2 },
      { title: 'Nike Air Max 90 Taille 42', desc: 'Sneakers Nike Air Max 90 blanches, taille 42. Portées seulement 3 fois.', price: 85, cat: 'Clothing', cond: 'like_new', seller: 3 },
      { title: 'MacBook Pro 2020 M1', desc: 'MacBook Pro 13 pouces M1 2020, 8Go RAM, 256Go SSD. Batterie 95%.', price: 890, cat: 'Electronics', cond: 'good', seller: 2 },
      { title: 'Livre "Clean Code" - Robert Martin', desc: 'Livre technique en anglais, très bon état. Quelques annotations au crayon.', price: 20, cat: 'Books', cond: 'good', seller: 3 },
      { title: 'Vélo de route Trek Domane AL2', desc: 'Vélo de route taille M, cadre aluminium. Parfait pour le quotidien.', price: 450, cat: 'Sports', cond: 'good', seller: 2 },
      { title: 'PS5 + 2 manettes', desc: 'PlayStation 5 édition standard avec 2 manettes DualSense. Tout fonctionne.', price: 380, cat: 'Electronics', cond: 'good', seller: 3 },
      { title: 'Canapé 3 places gris', desc: 'Canapé tissu gris 3 places. Dimensions : 220x90cm. À venir chercher.', price: 250, cat: 'Home', cond: 'fair', seller: 2 },
      { title: 'AirPods Pro 2ème génération', desc: 'AirPods Pro gen 2 avec boîtier de charge MagSafe. Autonomie parfaite.', price: 170, cat: 'Electronics', cond: 'like_new', seller: 3 },
    ];

    for (const item of items) {
      const r = await db.run(`INSERT INTO listings (seller_id, title, description, price, category, condition) VALUES (?, ?, ?, ?, ?, ?)`, item.seller, item.title, item.desc, item.price, item.cat, item.cond);
      await db.run(`INSERT INTO listing_images (listing_id, url, sort_order) VALUES (?, ?, 0)`, r.lastInsertRowid, `/api/placeholder/${r.lastInsertRowid}`);
    }
  }

  const companyCount = await db.get('SELECT COUNT(*) as c FROM companies');
  if (Number(companyCount.c) === 0) {
    const hash = await bcrypt.hash('nike123', 10);
    const hash2 = await bcrypt.hash('adidas123', 10);

    const nikeR = await db.run(`INSERT INTO companies (name, email, password_hash, website, industry, plan) VALUES (?, ?, ?, ?, ?, ?)`, 'Nike', 'contact@nike-demo.com', hash, 'nike.com', 'Sportswear', 'enterprise');
    await db.run(`INSERT INTO companies (name, email, password_hash, website, industry, plan) VALUES (?, ?, ?, ?, ?, ?)`, 'Adidas', 'contact@adidas-demo.com', hash2, 'adidas.com', 'Sportswear', 'pro');
    const nikeId = nikeR.lastInsertRowid;

    const nikeKey = 'sk_live_' + crypto.randomBytes(24).toString('hex');
    const nikeKeyHash = crypto.createHash('sha256').update(nikeKey).digest('hex');
    await db.run(`INSERT INTO api_keys (company_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?)`, nikeId, nikeKeyHash, nikeKey.slice(0, 12) + '...', 'Production');

    const statuses = ['completed', 'completed', 'unboxing_submitted', 'unboxing_pending', 'disputed'];
    const products = ['Air Max 90 Blanc T42', 'Jordan 1 Retro High OG', 'Nike Dri-FIT Running', 'Air Force 1 Low T41', 'Nike Tech Fleece'];
    const customers = ['jean.dupont@gmail.com', 'marie.martin@gmail.com', 'pierre.durand@gmail.com', 'sophie.bernard@gmail.com', 'lucas.petit@gmail.com'];

    for (let i = 0; i < 5; i++) {
      const { code, hash: codeHash } = generateVerificationCode(Date.now() + i);
      const orderR = await db.run(
        `INSERT INTO b2b_orders (company_id, external_order_id, customer_email, customer_name, product_name, order_amount, status, verification_code, verification_code_hash, tracking_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        nikeId, `NIKE-2024-${1000 + i}`, customers[i], customers[i].split('@')[0],
        products[i], 80 + i * 30, statuses[i], code, codeHash, `FR${700000000 + i}`
      );
      if (['completed', 'unboxing_submitted', 'disputed'].includes(statuses[i])) {
        const photos = JSON.stringify([`/api/placeholder/${i + 10}`, `/api/placeholder/${i + 20}`]);
        await db.run(
          `INSERT INTO b2b_unboxings (b2b_order_id, company_id, photo_urls, code_visible, condition_ok, ai_confidence) VALUES (?, ?, ?, ?, ?, ?)`,
          orderR.lastInsertRowid, nikeId, photos, 1, statuses[i] !== 'disputed' ? 1 : 0, 0.92 - i * 0.1
        );
      }
    }
    await db.run(`UPDATE companies SET total_orders = 5, total_fraud_prevented = 2, monthly_orders_used = 5 WHERE id = ?`, nikeId);
  }

  console.log(`✅ Base de données prête (${process.env.TURSO_URL ? 'Turso' : 'SQLite local'})`);
}

db.ready = init().catch(err => {
  console.error('❌ Database init failed:', err);
  process.exit(1);
});

module.exports = db;
