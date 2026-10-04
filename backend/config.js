const isProduction = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error("JWT_SECRET must be set before starting the API.");
}
if (isProduction && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters in production.");
}

const frontendOriginValues = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const configuredOrigins = frontendOriginValues.map((origin) => {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin.replace(/\/$/, "")) {
    throw new Error("FRONTEND_URL values must be origins without paths or query strings.");
  }
  return parsedOrigin.origin;
});

if (isProduction) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set in production.");
  }
  if (!configuredOrigins.length) {
    throw new Error("FRONTEND_URL must contain the allowed frontend origin.");
  }
  for (const origin of configuredOrigins) {
    if (new URL(origin).protocol !== "https:") {
      throw new Error("Production FRONTEND_URL origins must use HTTPS.");
    }
  }
  if (process.env.EMAIL_PROVIDER !== "smtp") {
    throw new Error("EMAIL_PROVIDER=smtp must be configured in production.");
  }
  for (const variable of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"]) {
    if (!process.env[variable]) {
      throw new Error(`${variable} must be set for production email delivery.`);
    }
  }
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535.");
  }
}

const allowedOrigins = new Set(
  configuredOrigins.length
    ? configuredOrigins
    : ["http://localhost:5500", "http://127.0.0.1:5500"],
);
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error("TRUST_PROXY_HOPS must be a non-negative integer.");
}

module.exports = {
  allowedOrigins,
  frontendUrl: configuredOrigins[0] || "http://localhost:5500",
  isProduction,
  jwtSecret,
  trustProxyHops,
};
