import nodemailer from "nodemailer";

// SMTP configuration is supplied through environment variables.
// Never hard-code SMTP credentials in source code.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: process.env.SMTP_USER
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
});

/** Send a plain-text email. SMTP errors are handled by the queue worker. */
export async function sendEmail({ to, subject, text }) {
  if (!process.env.EMAIL_FROM) {
    throw new Error("EMAIL_FROM is not configured.");
  }

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
  });
}

/** Validate SMTP connectivity during startup when configured. */
export async function verifyMailer() {
  if (!process.env.SMTP_HOST) {
    throw new Error("SMTP_HOST is not configured.");
  }
  return transporter.verify();
}
