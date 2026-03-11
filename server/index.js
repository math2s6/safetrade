require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');
const { startCron } = require('./jobs/expireUnboxing');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files (disable auto index.html so our route handles /)
app.use(express.static(path.join(__dirname, '../public'), { index: false }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Placeholder image generator
app.get('/api/placeholder/:id', (req, res) => {
  const colors = ['4f46e5', '7c3aed', 'db2777', 'dc2626', 'd97706', '059669', '0284c7', '7c3aed'];
  const color = colors[req.params.id % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#${color}"/><text x="50%" y="50%" font-family="Arial" font-size="48" fill="rgba(255,255,255,0.5)" text-anchor="middle" dy=".3em">📦</text></svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/unboxing', require('./routes/unboxing'));
app.use('/api/disputes', require('./routes/disputes'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/admin', require('./routes/admin'));

// B2B Routes
app.use('/api/b2b/auth', require('./routes/b2b-auth'));
app.use('/api/b2b', require('./routes/b2b-api'));
app.use('/api/company', require('./routes/b2b-dashboard'));
app.use('/api/demo', require('./routes/demo'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/company/export', require('./routes/b2b-export'));
app.use('/api/admin/b2b', require('./routes/admin-b2b'));
app.use('/api/company/billing', require('./routes/billing'));
app.use('/api/webhooks/stripe', require('./routes/stripe-webhook'));

// Redirect root to B2B landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'landing.html'));
});

// SPA fallback — serve actual HTML files if they exist, otherwise landing.html
app.get('*', (req, res) => {
  const filePath = path.join(__dirname, '../public', req.path);
  const fs = require('fs');
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  res.sendFile(path.join(__dirname, '../public', 'landing.html'));
});

app.use(errorHandler);

const db = require('./db');
const PORT = process.env.PORT || 3000;

db.ready.then(() => {
  app.listen(PORT, () => {
    console.log(`\nMarketplace démarrée sur http://localhost:${PORT}`);
    console.log(`Admin: admin@marketplace.com / admin123`);
    console.log(`Alice: alice@example.com / user123`);
    console.log(`Bob:   bob@example.com / user123\n`);
  });
  startCron();
});
