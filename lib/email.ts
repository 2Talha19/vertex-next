/**
 * Send auth emails through Resend's REST API (free tier: 100 emails/day).
 * Requires RESEND_API_KEY in .env.local. The default sender
 * (onboarding@resend.dev) can only deliver to the account owner's email until
 * a custom domain is verified in Resend — override with RESEND_FROM.
 * When Resend can't deliver (e.g. non-owner recipient), lib/auth.ts falls back
 * to Supabase's built-in email, which reaches any address without a domain.
 */

import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";

const RESEND_URL = "https://api.resend.com/emails";

/**
 * The Vertex crest, embedded as a data URI so email clients (which block
 * remote images by default) still show the logo. Read once at module load.
 */
const LOGO_DATA_URI = (() => {
  try {
    // Resolve from this module's location (../public) so it works no matter
    // what the process cwd is — including the Docker standalone runtime.
    const p = path.resolve(__dirname, "../public/logo.png");
    const b64 = fs.readFileSync(p).toString("base64");
    return `data:image/png;base64,${b64}`;
  } catch {
    return "";
  }
})();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, error: "RESEND_API_KEY is not set" };
  }
  const from = process.env.RESEND_FROM || "Vertex <onboarding@resend.dev>";
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend API ${res.status}: ${body.slice(0, 160)}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the email service." };
  }
}

/**
 * Send through a generic SMTP relay (Brevo, Gmail, SMTP2GO, MailerSend, …).
 * Configured via SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS /
 * SMTP_FROM in .env.local. This is the preferred path: works with any
 * provider, no domain needed, and no per-hour cap like Supabase's built-in
 * email (e.g. Brevo free: 300 emails/day to any address).
 */
export async function sendEmailViaSmtp(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  if (!host || !user) {
    return { ok: false, error: "SMTP_HOST / SMTP_USER are not set" };
  }
  const pass = process.env.SMTP_PASS || "";
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
  const from = process.env.SMTP_FROM || `Vertex <${user}>`;
  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    transport.close();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `SMTP ${host}: ${msg.slice(0, 160)}` };
  }
}

/** Branded HTML for the verification / password-reset code email. */
export function buildCodeEmail(
  code: string,
  name: string | undefined,
  kind: "verify" | "reset",
  link?: string
): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const heading =
    kind === "reset" ? "Reset your password" : "Verify your email";
  const body =
    kind === "reset"
      ? "Use the code below to choose a new password for your Vertex account. It expires in one hour."
      : "Thanks for signing up for Vertex. Use the code below to verify your email address. It expires in one hour.";
  const linkHtml = link
    ? `<p style="margin:16px 0 0;text-align:center;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 24px;border-radius:8px;">${
        kind === "reset" ? "Reset my password" : "Verify my email"
      }</a></p>
    <p style="color:#64748b;font-size:12px;text-align:center;margin:10px 0 0;">Or enter the code above on the sign-up screen.</p>`
    : "";
  const logoHtml = LOGO_DATA_URI
    ? `<img src="${LOGO_DATA_URI}" alt="Vertex" width="52" height="52" style="width:52px;height:52px;border-radius:13px;border:1px solid rgba(255,255,255,.16);box-shadow:0 4px 14px rgba(0,0,0,.35);display:inline-block;" />`
    : `<span style="width:52px;height:52px;border-radius:13px;background:linear-gradient(135deg,#3b82f6,#7c3aed);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:bold;">✦</span>`;

  const footerLogoHtml = LOGO_DATA_URI
    ? `<img src="${LOGO_DATA_URI}" alt="Vertex" width="22" height="22" style="width:22px;height:22px;border-radius:6px;vertical-align:middle;margin-right:6px;" />`
    : `<span style="color:#64748b;font-weight:bold;">✦</span>`;

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:440px;margin:24px auto;background:#1e293b;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px;">
      <!-- Brand header: logo + wordmark, centered so it's unmistakable -->
      <div style="text-align:center;margin-bottom:24px;">
        ${logoHtml}
        <div style="color:#ffffff;font-size:21px;font-weight:700;margin-top:10px;letter-spacing:.02em;">Vertex</div>
        <div style="color:#64748b;font-size:12px;margin-top:2px;">Ask Peham's Docs</div>
      </div>
      <h1 style="color:#fff;font-size:18px;margin:0 0 10px;">${heading}</h1>
      <p style="color:#cbd5e1;font-size:14px;line-height:1.6;margin:0 0 18px;">${greeting} ${body}</p>
      <div style="background:#0f172a;border:1px dashed rgba(96,165,250,.5);border-radius:12px;padding:18px;text-align:center;">
        <div style="color:#94a3b8;font-size:12px;letter-spacing:.08em;margin-bottom:6px;">YOUR CODE</div>
        <div style="color:#60a5fa;font-size:34px;font-weight:700;letter-spacing:10px;">${escapeHtml(code)}</div>
      </div>
      ${linkHtml}
      <p style="color:#64748b;font-size:12px;line-height:1.6;margin:18px 0 0;">Didn't request this? You can safely ignore this email.</p>
      <!-- Brand footer: small logo + origin line -->
      <div style="border-top:1px solid rgba(255,255,255,.08);margin-top:22px;padding-top:16px;text-align:center;">
        ${footerLogoHtml}<span style="color:#94a3b8;font-size:12px;">Sent by Vertex — internal knowledge assistant</span>
      </div>
    </div>
  </body>
</html>`;
}
