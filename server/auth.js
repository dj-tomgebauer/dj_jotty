const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// Serialize user ID into session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user || null);
});

// Google OAuth strategy — only registered if credentials are configured
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
  }, (accessToken, refreshToken, profile, done) => {
    const googleId = profile.id;
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName;
    const avatarUrl = profile.photos?.[0]?.value;

    if (!email) {
      return done(new Error('No email returned from Google'));
    }

    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);

    if (!user) {
      const id = uuidv4();
      db.prepare(
        'INSERT INTO users (id, google_id, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)'
      ).run(id, googleId, email, name, avatarUrl || null);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }

    done(null, user);
  }));

  console.log('Google OAuth strategy registered');
} else {
  console.log('Google OAuth not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable)');
}

module.exports = passport;
