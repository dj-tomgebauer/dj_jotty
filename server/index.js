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

app.use(cors());
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

// API routes
app.use('/api/auth', authRouter);
app.use('/api/snaps', snapsRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
