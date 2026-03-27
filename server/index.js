const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const ConnectSQLite = require('connect-sqlite3')(session);
const passport = require('./auth');
const snapsRouter = require('./routes/snaps');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3005;

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable must be set in production');
}

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:3004',
  credentials: true,
}));
app.use(express.json());

// Sessions (stored in SQLite)
app.use(session({
  store: new ConnectSQLite({ db: 'sessions.db', dir: path.join(__dirname) }),
  secret: process.env.SESSION_SECRET || 'jotty-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Serve built client
app.use(express.static(path.join(__dirname, '../client/dist')));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/snaps', snapsRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// SPA fallback — must be after API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
