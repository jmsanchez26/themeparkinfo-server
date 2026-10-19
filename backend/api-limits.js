const { rateLimit } = require('express-rate-limit');

function createPublicApiLimiter() {
  return rateLimit({
    windowMs: 60000, limit: 180,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: true, message: 'Too many park-data requests. Please try again shortly.' },
    handler(req, res, next, options) {
      res.set('Cache-Control', 'no-store');
      res.status(options.statusCode).json(options.message);
    }
  });
}

module.exports = { createPublicApiLimiter };
