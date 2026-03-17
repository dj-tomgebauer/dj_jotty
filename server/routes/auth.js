const express = require('express');
const passport = require('passport');

const router = express.Router();

// GET /api/auth/me - Return current user (or null)
router.get('/me', (req, res) => {
  if (req.user) {
    const { id, email, name, avatar_url } = req.user;
    res.json({ id, email, name, avatar_url });
  } else {
    res.json(null);
  }
});

// GET /api/auth/google - Start Google OAuth flow
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
}));

// GET /api/auth/google/callback - Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/');
  }
);

// POST /api/auth/logout - Log out
router.post('/logout', (req, res) => {
  req.logout(() => {
    res.json({ ok: true });
  });
});

module.exports = router;
