import { getSupabase } from "./supabase";
import { sendEmail, sendEmailViaSmtp, buildCodeEmail } from "./email";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

/**
 * Figure out the app's own base URL, used as redirectTo so the confirmation
 * link in the emailed code points at the app wherever it's actually running
 * (any port, any host). Priority: AUTH_REDIRECT_URL env override → the
 * request's Origin header → Host header. Returns a URL without a trailing
 * slash, or undefined if nothing usable is found.
 */
export function resolveAppUrl(req: Request): string | undefined {
  const fromEnv = (process.env.AUTH_REDIRECT_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const origin = req.headers.get("origin");
  if (origin && /^https?:\/\/.+/i.test(origin)) {
    try {
      const u = new URL(origin);
      if (u.protocol === "http:" || u.protocol === "https:") {
        return `${u.protocol}//${u.host}`;
      }
    } catch {
      // fall through to Host
    }
  }

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto") ||
      (host.startsWith("localhost") || host.startsWith("127.")
        ? "http"
        : "https");
    return `${proto}://${host}`;
  }
  return undefined;
}

/**
 * The installed supabase-js types don't list `shouldCreateUser` for magiclink
 * generateLink options, but the API accepts it (creates the user if missing).
 */
type GenerateLinkOptionsWithCreate = {
  shouldCreateUser?: boolean;
  data?: object;
  redirectTo?: string;
};

/**
 * Deliver a verification/reset code to an email address.
 *
 * - Demo accounts (DEMO_OTP_PREFIX): the code is returned in the API response
 *   instead of emailed — used by the recorded walkthrough videos.
 * - SMTP path (recommended; SMTP_HOST + SMTP_USER set): the code is generated
 *   via the admin API and emailed through any SMTP relay (Brevo, Gmail,
 *   SMTP2GO, …). Works with any provider, no domain needed, no per-hour cap
 *   (e.g. Brevo free: 300 emails/day to any address). The email includes both
 *   the code and a clickable confirmation link pointing at the app.
 * - Resend path (only when RESEND_FROM is set, i.e. a domain is verified):
 *   the same generated code, sent through Resend (100 emails/day). Skipped
 *   otherwise, because Resend's default sender (onboarding@resend.dev) can
 *   only deliver to the account owner's email.
 * - Fallback: Supabase's built-in email service sends the code. Reaches ANY
 *   address with no domain or custom sender, but caps at ~2 emails/hour for
 *   the whole project (free tier) — fine as a last resort, not for real use.
 */
async function deliverCode(
  email: string,
  opts: { name?: string; createUser: boolean; kind: "verify" | "reset" },
  redirectUrl?: string
) {
  const sb = getSupabase();
  let smtpError: string | undefined;
  let resendError: string | undefined;

  // Demo mode: when DEMO_OTP_PREFIX is set, codes for matching emails are
  // returned in the API response instead of emailed — no real email is sent
  // (no bounce risk for the recorded walkthrough videos).
  const demoPrefix = (process.env.DEMO_OTP_PREFIX || "").toLowerCase().trim();
  const isDemo = !!demoPrefix && email.toLowerCase().startsWith(demoPrefix);

  const createOptions = {
    shouldCreateUser: opts.createUser,
    data: opts.name ? { name: opts.name } : undefined,
  } as GenerateLinkOptionsWithCreate;

  // Demo accounts: surface the code on screen instead of emailing it.
  if (isDemo) {
    try {
      const { data, error } = await sb.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: createOptions,
      });
      const otp = data?.properties?.email_otp as string | undefined;
      if (!error && otp && /^\d{6,8}$/.test(otp)) {
        return { ok: true as const, codeLength: otp.length, demoCode: otp };
      }
    } catch {
      // fall through to the error below
    }
    return {
      ok: false as const,
      error: "Could not generate a demo code — check DEMO_OTP_PREFIX in .env.local.",
    };
  }

  // Our own senders (SMTP → Resend): generate the OTP once via the admin API
  // so the email can include BOTH the code and a clickable confirmation link
  // that points at the app wherever it's running (no Supabase Site URL or
  // Redirect-URL allowlist involved). SMTP works with any provider (Brevo,
  // Gmail, SMTP2GO…) with no per-hour cap — the recommended path for letting
  // everyone sign up. If none of our senders works, we fall back to Supabase's
  // built-in email below.
  const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
  const resendConfigured = !!(
    process.env.RESEND_API_KEY &&
    process.env.RESEND_FROM
  );
  const subject =
    opts.kind === "reset"
      ? "Reset your Vertex password"
      : "Your Vertex verification code";

  if (smtpConfigured || resendConfigured) {
    let otp: string | undefined;
    let html: string | undefined;
    try {
      const { data, error } = await sb.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: createOptions,
      });
      if (!error) {
        const code = data?.properties?.email_otp as string | undefined;
        if (code && /^\d{6,8}$/.test(code)) {
          otp = code;
          html = buildCodeEmail(
            code,
            opts.name,
            opts.kind,
            buildConfirmLink(data?.properties?.action_link, redirectUrl)
          );
        }
      }
    } catch {
      // fall through to Supabase's built-in email
    }

    if (otp && html) {
      if (smtpConfigured) {
        const sent = await sendEmailViaSmtp({ to: email, subject, html });
        if (sent.ok) return { ok: true as const, codeLength: otp.length };
        smtpError = sent.error;
      }
      if (resendConfigured) {
        const sent = await sendEmail({ to: email, subject, html });
        if (sent.ok) return { ok: true as const, codeLength: otp.length };
        resendError = sent.error;
      }
    }
  }

  // Default path: Supabase's own email service sends the code — reaches ANY
  // address with no domain or custom sender (free tier caps at ~2 emails/hour
  // per address, ~1-minute wait between requests to the same email). When a
  // redirectUrl is known (the URL the user is actually on), pass it as
  // redirectTo so the emailed confirmation link points at the app wherever
  // it's running — any port, any host (the URL must be in the Supabase
  // Redirect URLs allowlist; if not, we retry without it so the code still
  // gets emailed).
  const sendOptions: {
    shouldCreateUser: boolean;
    data?: object;
    redirectTo?: string;
  } = {
    shouldCreateUser: opts.createUser,
    data: opts.name ? { name: opts.name } : undefined,
  };
  if (redirectUrl) sendOptions.redirectTo = redirectUrl;

  let { error } = await sb.auth.signInWithOtp({ email, options: sendOptions });
  if (
    error &&
    redirectUrl &&
    /redirect/i.test(error.message || "") &&
    /not allowed|invalid|allowlist/i.test(error.message || "")
  ) {
    // The redirect URL isn't in the Supabase allowlist — retry without it so
    // the code still gets emailed (the link will fall back to the Site URL).
    const { error: retryError } = await sb.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: opts.createUser,
        data: opts.name ? { name: opts.name } : undefined,
      },
    });
    error = retryError;
  }
  if (error) {
    const transient = /rate limit|too many requests|only request this after/i.test(
      error?.message || ""
    );
    if (smtpError) {
      // SMTP is configured but failed, and Supabase's built-in email couldn't
      // send either — tell them exactly what to check.
      return {
        ok: false as const,
        error: `Could not send the code — SMTP failed (${smtpError}) and Supabase's built-in email also failed (${friendly(error)}). Check SMTP_HOST / SMTP_USER / SMTP_PASS in .env.local.`,
      };
    }
    if (resendError && !transient) {
      // Resend is configured but failed for a real reason, and Supabase's
      // built-in email couldn't send either — tell them what to check.
      return {
        ok: false as const,
        error: `Could not send the code: ${friendly(error)} Resend is configured but failed (${resendError}) — check RESEND_API_KEY and RESEND_FROM in .env.local.`,
      };
    }
    return { ok: false as const, error: friendly(error) };
  }
  return { ok: true as const, codeLength: await probeCodeLength(email) };
}

/**
 * Build an app-hosted confirmation link from the magic-link token Supabase
 * generates — so our branded emails can include a clickable link that points
 * at the app on whatever host/port it runs (no Supabase Site URL or Redirect
 * URLs allowlist involved).
 */
function buildConfirmLink(
  actionLink: string | undefined,
  appUrl: string | undefined
): string | undefined {
  if (!appUrl || !actionLink) return undefined;
  try {
    const u = new URL(actionLink);
    const token =
      u.searchParams.get("token") || u.searchParams.get("token_hash") || "";
    const type = u.searchParams.get("type") || "email";
    if (!token) return undefined;
    return `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(
      token
    )}&type=${encodeURIComponent(type)}`;
  } catch {
    return undefined;
  }
}

/**
 * Send a verification code to an email address (Supabase Auth OTP).
 * Creates the (unverified) account on first signup; re-sends the code if the
 * account already exists.
 * Also probes the project's OTP length (6 or 8 digits) so the UI can render
 * exactly the right number of boxes — without sending an extra email.
 */
/**
 * Probe the project's OTP length (6 or 8 digits) without sending an email,
 * by generating an unsent magiclink token and reading its plaintext OTP.
 */
async function probeCodeLength(email: string): Promise<number> {
  let codeLength = 6;
  try {
    const sb = getSupabase();
    const { data } = await sb.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const otp = data?.properties?.email_otp as string | undefined;
    if (otp && /^\d{6,8}$/.test(otp)) codeLength = otp.length;
  } catch {
    // keep the default
  }
  return codeLength;
}

export async function sendOtpCode(
  email: string,
  name?: string,
  redirectUrl?: string
) {
  try {
    const sb = getSupabase();

    // Demo accounts may already exist from earlier runs — let demo codes
    // through so the recorded walkthrough can re-verify them.
    const demoPrefix = (process.env.DEMO_OTP_PREFIX || "").toLowerCase().trim();
    const isDemo = demoPrefix && email.toLowerCase().startsWith(demoPrefix);

    // If the account already exists and is confirmed, tell them to sign in.
    try {
      const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = data?.users?.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );
      if (existing && (existing.confirmed_at || existing.email_confirmed_at) && !isDemo) {
        return {
          ok: false as const,
          error: "An account with this email already exists — sign in instead.",
        };
      }
    } catch {
      // List may be unavailable — proceed and let generateLink decide.
    }

    return await deliverCode(
      email,
      {
        name,
        createUser: true,
        kind: "verify",
      },
      redirectUrl
    );
  } catch {
    return { ok: false as const, error: "Could not reach the auth service." };
  }
}

/** Verify a 6-digit email code. Returns the confirmed account on success. */
export async function verifyOtpCode(email: string, code: string) {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    if (error || !data.user?.email) {
      return { ok: false as const, error: friendly(error) };
    }
    return {
      ok: true as const,
      user: toAuthUser(data.user),
      token: data.session?.access_token ?? null,
      refreshToken: data.session?.refresh_token ?? null,
    };
  } catch {
    return { ok: false as const, error: "Could not reach the auth service." };
  }
}

/**
 * Send a password-reset code to an existing account's email (Supabase OTP).
 * Fails cleanly if no account has that email.
 */
export async function sendResetCode(email: string, redirectUrl?: string) {
  try {
    return await deliverCode(
      email,
      { createUser: false, kind: "reset" },
      redirectUrl
    );
  } catch {
    return { ok: false as const, error: "Could not reach the auth service." };
  }
}

/** Verify the emailed code, then set the new password on the account. */
export async function resetPassword(
  email: string,
  code: string,
  newPassword: string
) {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    if (error || !data.user?.id) {
      return { ok: false as const, error: friendly(error) };
    }
    const { error: pwErr } = await sb.auth.admin.updateUserById(data.user.id, {
      password: newPassword,
    });
    if (pwErr) return { ok: false as const, error: friendly(pwErr) };
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Could not reach the auth service." };
  }
}

/**
 * Complete verification from the magic link in the emailed code.
 * The email contains a link like ?token_hash=...&type=email — this consumes
 * it so both the manual code AND the link work.
 */
export async function verifyLink(
  tokenHash: string,
  type: string
) {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as never,
    });
    if (error || !data.user?.email) {
      return { ok: false as const, error: friendly(error) };
    }
    return {
      ok: true as const,
      user: toAuthUser(data.user),
      token: data.session?.access_token ?? null,
      refreshToken: data.session?.refresh_token ?? null,
    };
  } catch {
    return { ok: false as const, error: "Could not reach the auth service." };
  }
}

/** Sign in with email + password (only verified accounts can pass). */
export async function loginWithPassword(email: string, password: string) {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user?.email) {
      return { ok: false as const, error: friendly(error) };
    }
    return {
      ok: true as const,
      user: toAuthUser(data.user),
      token: data.session?.access_token ?? null,
      refreshToken: data.session?.refresh_token ?? null,
    };
  } catch {
    return { ok: false as const, error: "Could not reach the auth service." };
  }
}

/**
 * Exchange a refresh token for a fresh session (silent renewal). Called
 * before the access token expires (proactive timer) or on a 401 (retry once
 * before giving up). Returns the new access + refresh token pair.
 */
export async function refreshSessionToken(refreshToken: string) {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session?.access_token || !data.user?.email) {
      return { ok: false as const, error: friendly(error) };
    }
    return {
      ok: true as const,
      user: toAuthUser(data.user),
      token: data.session.access_token,
      refreshToken: data.session.refresh_token ?? null,
    };
  } catch {
    return { ok: false as const, error: "Could not reach the auth service." };
  }
}

/**
 * Validate the Bearer token sent with protected API calls (/api/chat,
 * /api/upload). Returns the auth'd user or null (401).
 */
export async function requireUser(req: Request): Promise<AuthUser | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user?.email) return null;
    return toAuthUser(data.user);
  } catch {
    return null;
  }
}

function toAuthUser(user: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}): AuthUser {
  const email = user.email ?? "";
  const metaName = user.user_metadata?.name;
  return {
    id: user.id,
    email,
    name:
      typeof metaName === "string" && metaName.trim()
        ? metaName.trim()
        : email.split("@")[0],
  };
}

/** Map Supabase auth errors to friendly, human-readable messages. */
function friendly(error: { message?: string } | null | undefined): string {
  const m = (error?.message || "").toLowerCase();
  if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/email not confirmed/i.test(m))
    return "This email hasn't been verified yet — check your inbox for the code.";
  if (/already registered|user already/i.test(m))
    return "An account with this email already exists. Sign in instead.";
  if (/rate limit|too many requests|over_email_send_rate_limit/i.test(m))
    return "Too many verification emails — the free Supabase email service allows about 2 per hour per address, so wait an hour and try again.";
  if (/only request this after (\d+) second/i.test(m))
    return "Supabase limits code requests to about one per minute per email — wait a moment, then request another code.";
  if (/invalid otp|token has expired|invalid token/i.test(m))
    return "That code is invalid or expired. Request a new one.";
  if (/max otp attempts/i.test(m))
    return "Too many wrong attempts. Request a new code.";
  if (/password should be at least/i.test(m))
    return "Password must be at least 6 characters.";
  if (/unable to validate email/i.test(m)) return "Enter a valid email address.";
  if (/user not found|no user found|signups not allowed for otp/i.test(m))
    return "No account found with that email — check the address or sign up instead.";
  return error?.message || "Something went wrong.";
}
