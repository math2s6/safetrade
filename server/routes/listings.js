const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { listingUpload } = require('../middleware/upload');

router.get('/', async (req, res) => {
  const { q, category, condition, minPrice, maxPrice, page = 1, limit = 20 } = req.query;
  let where = ["l.status = 'active'"];
  const params = [];
  if (q) { where.push("(l.title LIKE ? OR l.description LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  if (category) { where.push("l.category = ?"); params.push(category); }
  if (condition) { where.push("l.condition = ?"); params.push(condition); }
  if (minPrice) { where.push("l.price >= ?"); params.push(parseFloat(minPrice)); }
  if (maxPrice) { where.push("l.price <= ?"); params.push(parseFloat(maxPrice)); }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const sql = `
    SELECT l.*, u.username as seller_name, u.rating_avg as seller_rating, u.avatar_url as seller_avatar,
           (SELECT url FROM listing_images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as thumbnail
    FROM listings l JOIN users u ON u.id = l.seller_id
    WHERE ${where.join(' AND ')}
    ORDER BY l.created_at DESC LIMIT ? OFFSET ?
  `;
  const total = await db.get(`SELECT COUNT(*) as c FROM listings l WHERE ${where.join(' AND ')}`, ...params);
  const listings = await db.all(sql, ...params, parseInt(limit), offset);
  res.json({ listings, total: total.c, page: parseInt(page), pages: Math.ceil(total.c / parseInt(limit)) });
});

router.get('/by-seller/:userId', async (req, res) => {
  const listings = await db.all(`
    SELECT l.*, (SELECT url FROM listing_images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) as thumbnail
    FROM listings l WHERE l.seller_id = ? AND l.status != 'removed' ORDER BY l.created_at DESC
  `, req.params.userId);
  res.json(listings);
});

router.get('/:id', async (req, res) => {
  const listing = await db.get(`
    SELECT l.*, u.username as seller_name, u.rating_avg as seller_rating, u.avatar_url as seller_avatar, u.bio as seller_bio, u.rating_count as seller_rating_count, u.id as seller_user_id
    FROM listings l JOIN users u ON u.id = l.seller_id WHERE l.id = ?
  `, req.params.id);
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable' });
  const images = await db.all('SELECT * FROM listing_images WHERE listing_id = ? ORDER BY sort_order', listing.id);
  await db.run('UPDATE listings SET views = views + 1 WHERE id = ?', listing.id);
  res.json({ ...listing, images });
});

router.post('/', requireAuth, listingUpload.array('images', 10), async (req, res, next) => {
  try {
    const { title, description, price, category, condition } = req.body;
    if (!title || !description || !price || !category || !condition) return res.status(400).json({ error: 'Champs manquants' });
    const r = await db.run('INSERT INTO listings (seller_id, title, description, price, category, condition) VALUES (?, ?, ?, ?, ?, ?)', req.user.id, title, description, parseFloat(price), category, condition);
    const files = req.files || [];
    for (let i = 0; i < files.length; i++) {
      await db.run('INSERT INTO listing_images (listing_id, url, sort_order) VALUES (?, ?, ?)', r.lastInsertRowid, `/uploads/listings/${files[i].filename}`, i);
    }
    if (files.length === 0) {
      await db.run('INSERT INTO listing_images (listing_id, url, sort_order) VALUES (?, ?, 0)', r.lastInsertRowid, `/api/placeholder/${r.lastInsertRowid}`);
    }
    res.status(201).json({ id: r.lastInsertRowid, message: 'Annonce créée' });
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const listing = await db.get('SELECT * FROM listings WHERE id = ?', req.params.id);
    if (!listing) return res.status(404).json({ error: 'Annonce introuvable' });
    if (listing.seller_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Non autorisé' });
    const { title, description, price, category, condition } = req.body;
    await db.run('UPDATE listings SET title=COALESCE(?,title), description=COALESCE(?,description), price=COALESCE(?,price), category=COALESCE(?,category), condition=COALESCE(?,condition), updated_at=datetime(\'now\') WHERE id=?', title, description, price ? parseFloat(price) : null, category, condition, req.params.id);
    res.json({ message: 'Annonce mise à jour' });
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const listing = await db.get('SELECT * FROM listings WHERE id = ?', req.params.id);
    if (!listing) return res.status(404).json({ error: 'Annonce introuvable' });
    if (listing.seller_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Non autorisé' });
    await db.run("UPDATE listings SET status = 'removed' WHERE id = ?", req.params.id);
    res.json({ message: 'Annonce supprimée' });
  } catch (e) { next(e); }
});

module.exports = router;
