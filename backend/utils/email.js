const nodemailer = require("nodemailer");
const config = require("../config");

let transporter;

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function sendPasswordResetEmail({ email, name, token }) {
  if (process.env.EMAIL_PROVIDER !== "smtp") {
    if (config.isProduction) {
      throw new Error("SMTP email delivery is not configured.");
    }
    return false;
  }

  const resetUrl = new URL("/reset-password/", config.frontendUrl);
  resetUrl.searchParams.set("token", token);
  const recipientName = escapeHtml(name || "there");
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Reset your school account password",
    text: `Hello ${name || "there"}, use this link within 30 minutes to reset your password: ${resetUrl}`,
    html: `<p>Hello ${recipientName},</p><p>Use the link below within 30 minutes to reset your school account password.</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  });
  return true;
}

module.exports = { sendPasswordResetEmail };
