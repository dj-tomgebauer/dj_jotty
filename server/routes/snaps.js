const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    // Prefer the original extension, but fall back to MIME-derived extension
    // (clipboard pastes may have names like "image" or "blob" with no extension)
    const origExt = path.extname(file.originalname).toLowerCase();
    const ext = origExt && ['.png', '.jpg', '.jpeg', '.webp'].includes(origExt)
      ? origExt
      : MIME_TO_EXT[file.mimetype] || '.png';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.png', '.jpg', '.jpeg', '.webp'];
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext) || allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPG, and WEBP files are allowed'));
    }
  },
});

// GET /api/snaps - List all snaps
router.get('/', (req, res) => {
  const snaps = db.prepare('SELECT id, image_path, annotations, canvas_width, canvas_height, creator_name, source_url, created_at, forked_from FROM snaps ORDER BY created_at DESC').all();
  snaps.forEach(s => { s.annotations = JSON.parse(s.annotations); });
  res.json(snaps);
});

// POST /api/snaps - Create a new snap
router.post('/', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required' });
  }

  const id = uuidv4();
  const { creator_name, source_url, source_notes } = req.body;

  if (!creator_name) {
    return res.status(400).json({ error: 'creator_name is required' });
  }

  const image_path = `/uploads/${req.file.filename}`;

  const stmt = db.prepare(`
    INSERT INTO snaps (id, image_path, creator_name, source_url, source_notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, image_path, creator_name, source_url || null, source_notes || null);

  const snap = db.prepare('SELECT * FROM snaps WHERE id = ?').get(id);
  res.status(201).json(snap);
});

// GET /api/snaps/:id - Get a snap
router.get('/:id', (req, res) => {
  const snap = db.prepare('SELECT * FROM snaps WHERE id = ?').get(req.params.id);
  if (!snap) {
    return res.status(404).json({ error: 'Snap not found' });
  }
  snap.annotations = JSON.parse(snap.annotations);
  res.json(snap);
});

// PUT /api/snaps/:id/annotations - Update annotations
router.put('/:id/annotations', (req, res) => {
  const snap = db.prepare('SELECT * FROM snaps WHERE id = ?').get(req.params.id);
  if (!snap) {
    return res.status(404).json({ error: 'Snap not found' });
  }

  const { annotations, canvas_width, canvas_height } = req.body;
  if (!Array.isArray(annotations)) {
    return res.status(400).json({ error: 'annotations must be an array' });
  }

  db.prepare('UPDATE snaps SET annotations = ?, canvas_width = ?, canvas_height = ? WHERE id = ?')
    .run(JSON.stringify(annotations), canvas_width || null, canvas_height || null, req.params.id);

  res.json({ ...snap, annotations, canvas_width, canvas_height });
});

// POST /api/snaps/:id/fork - Fork a snap
router.post('/:id/fork', (req, res) => {
  const parent = db.prepare('SELECT * FROM snaps WHERE id = ?').get(req.params.id);
  if (!parent) {
    return res.status(404).json({ error: 'Snap not found' });
  }

  const { creator_name, include_annotations } = req.body;
  if (!creator_name) {
    return res.status(400).json({ error: 'creator_name is required' });
  }

  const id = uuidv4();
  const annotations = include_annotations ? parent.annotations : '[]';

  db.prepare(`
    INSERT INTO snaps (id, image_path, annotations, creator_name, source_url, source_notes, forked_from)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, parent.image_path, annotations, creator_name, parent.source_url, parent.source_notes, parent.id);

  const snap = db.prepare('SELECT * FROM snaps WHERE id = ?').get(id);
  snap.annotations = JSON.parse(snap.annotations);
  res.status(201).json(snap);
});

// GET /api/snaps/:id/history - Get fork chain
router.get('/:id/history', (req, res) => {
  const history = [];
  let currentId = req.params.id;

  while (currentId) {
    const snap = db.prepare('SELECT * FROM snaps WHERE id = ?').get(currentId);
    if (!snap) break;
    snap.annotations = JSON.parse(snap.annotations);
    history.push(snap);
    currentId = snap.forked_from;
  }

  res.json(history);
});

module.exports = router;
