const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'jotty.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS snaps (
    id TEXT PRIMARY KEY,
    image_path TEXT NOT NULL,
    annotations TEXT DEFAULT '[]',
    creator_name TEXT NOT NULL,
    source_url TEXT,
    source_notes TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    forked_from TEXT,
    FOREIGN KEY (forked_from) REFERENCES snaps(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_id TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )
`);

// Add canvas dimension columns if they don't exist
try {
  db.exec(`ALTER TABLE snaps ADD COLUMN canvas_width INTEGER`);
  db.exec(`ALTER TABLE snaps ADD COLUMN canvas_height INTEGER`);
  db.exec(`ALTER TABLE snaps ADD COLUMN user_id TEXT REFERENCES users(id)`);
} catch {
  // columns already exist
}

module.exports = db;
