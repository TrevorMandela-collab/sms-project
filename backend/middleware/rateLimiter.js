const { rateLimit } = require("express-rate-limit");

function createRateLimiter(windowMs, limit, code, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        success: false,
        error: { code, message },
      }),
  });
}

const authRateLimit = createRateLimiter(
  15 * 60 * 1000,
  10,
  "AUTH_RATE_LIMITED",
  "Too many authentication attempts. Try again later.",
);

const passwordResetRateLimit = createRateLimiter(
  15 * 60 * 1000,
  5,
  "PASSWORD_RESET_RATE_LIMITED",
  "Too many password reset requests. Try again later.",
);

const loginRateLimit = createRateLimiter(
  15 * 60 * 1000,
  10,
  "LOGIN_RATE_LIMITED",
  "Too many login attempts. Try again later.",
);

module.exports = { authRateLimit, loginRateLimit, passwordResetRateLimit };
