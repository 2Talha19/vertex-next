import { getSupabase } from "./supabase";
import { sendEmail, buildCodeEmail } from "./email";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

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
 * Primary path (when RESEND_API_KEY is set): generate the code ourselves via
 * the admin API (no Supabase email involved) and send it through Resend
 * (free tier: 100 emails/day). If Resend isn't configured or fails, fall back
 * to Supabase's built-in email (2/hour limit on the free provider).
 */
async function deliverCode(
  email: string,
  opts: { name?: string; createUser: boolean; kind: "verify" | "reset" }
) {
  const sb = getSupabase();
  const resendKey = process.env.RESEND_API_KEY;
  let resendError: string | undefined;

  if (resendKey) {
    try {
      const { data, error } = await sb.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: {
          shouldCreateUser: opts.createUser,
          data: opts.name ? { name: opts.name } : undefined,
        } as GenerateLinkOptionsWithCreate,
      });
      if (!error) {
        const otp = data?.properties?.email_otp as string | undefined;
        if (otp && /^\d{6,8}$/.test(otp)) {
          const sent = await sendEmail({
            to: email,
            subject:
              opts.kind === "reset"
                ? "Reset your Vertex password"
                : "Your Vertex verification code",
            html: buildCodeEmail(otp, opts.name, opts.kind),
          });
          if (sent.ok) return { ok: true as const, codeLength: otp.length };
          resendError = sent.error;
        }
      }
    } catch {
      // Fall through to Supabase's built-in email.
    }
  }

  // Fallback: let Supabase email it (2/hour on the free built-in provider).
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: opts.createUser,
      data: opts.name ? { name: opts.name } : undefined,
    },
  });
  if (error) {
    // If Resend was configured but failed, that's the more useful signal.
    if (resendError) {
      return {
        ok: false as const,
        error: `Email sending failed — ${resendError}. Check your RESEND_API_KEY.`,
      };
    }
    return { ok: false as const, error: friendly(error) };
  }
  return { ok: true as const, codeLength: await probeCodeLength(email) };
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

export async function sendOtpCode(email: string, name?: string) {
  try {
    const sb = getSupabase();

    // If the account already exists and is confirmed, tell them to sign in.
    try {
      const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = data?.users?.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );
      if (existing && (existing.confirmed_at || existing.email_confirmed_at)) {
        return {
          ok: false as const,
          error: "An account with this email already exists — sign in instead.",
        };
      }
    } catch {
      // List may be unavailable — proceed and let generateLink decide.
    }

    return await deliverCode(email, {
      name,
      createUser: true,
      kind: "verify",
    });
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
    };
  } catch {
    return { ok: false as const, error: "Could not reach the auth service." };
  }
}

/**
 * Send a password-reset code to an existing account's email (Supabase OTP).
 * Fails cleanly if no account has that email.
 */
export async function sendResetCode(email: string) {
  try {
    return await deliverCode(email, { createUser: false, kind: "reset" });
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
    };
  } catch {
    return { ok: false as const, error: "Could not reach the auth service." };
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
    return "Too many verification emails — the free Supabase email service allows about 2 per hour. Add a free Resend API key (RESEND_API_KEY in .env.local) for 100 emails/day, then try again.";
  if (/only request this after (\d+) second/i.test(m))
    return "Please wait a moment before requesting another code.";
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
