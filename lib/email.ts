/**
 * Send auth emails through Resend's REST API (free tier: 100 emails/day).
 * Requires RESEND_API_KEY in .env.local. The default sender
 * (onboarding@resend.dev) can only deliver to the account owner's email until
 * a custom domain is verified in Resend — override with RESEND_FROM.
 */

const RESEND_URL = "https://api.resend.com/emails";

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

/** Branded HTML for the verification / password-reset code email. */
export function buildCodeEmail(
  code: string,
  name: string | undefined,
  kind: "verify" | "reset"
): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const heading =
    kind === "reset" ? "Reset your password" : "Verify your email";
  const body =
    kind === "reset"
      ? "Use the code below to choose a new password for your Vertex account. It expires in one hour."
      : "Thanks for signing up for Vertex. Use the code below to verify your email address. It expires in one hour.";
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:440px;margin:24px auto;background:#1e293b;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
        <span style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#3b82f6,#7c3aed);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:bold;">✦</span>
        <span style="color:#fff;font-size:18px;font-weight:700;">Vertex</span>
      </div>
      <h1 style="color:#fff;font-size:18px;margin:0 0 10px;">${heading}</h1>
      <p style="color:#cbd5e1;font-size:14px;line-height:1.6;margin:0 0 18px;">${greeting} ${body}</p>
      <div style="background:#0f172a;border:1px dashed rgba(96,165,250,.5);border-radius:12px;padding:18px;text-align:center;">
        <div style="color:#94a3b8;font-size:12px;letter-spacing:.08em;margin-bottom:6px;">YOUR CODE</div>
        <div style="color:#60a5fa;font-size:34px;font-weight:700;letter-spacing:10px;">${escapeHtml(code)}</div>
      </div>
      <p style="color:#64748b;font-size:12px;line-height:1.6;margin:18px 0 0;">Didn't request this? You can safely ignore this email.</p>
    </div>
  </body>
</html>`;
}
