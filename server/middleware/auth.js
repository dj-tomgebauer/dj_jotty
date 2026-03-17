// Auth middleware — not enforced on any routes yet.
// When ready to require login, add requireAuth to routes.

// Requires the user to be logged in
function requireAuth(req, res, next) {
  if (req.user) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

// Optionally attaches user to request (no enforcement)
function optionalAuth(req, res, next) {
  // req.user is already set by passport session if logged in
  next();
}

module.exports = { requireAuth, optionalAuth };
