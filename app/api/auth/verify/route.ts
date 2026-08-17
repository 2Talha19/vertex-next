/**
 * POST /api/auth/verify — check the 6-digit code emailed to the user.
 * Body: { email, code }
 * Returns the confirmed user so the client can start a session.
 */
import { NextResponse } from "next/server";
import { verifyOtpCode } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    code?: string;
  };
  const email = (body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!/^\d{6,8}$/.test(code)) {
    return NextResponse.json({ error: "Enter the code from the email (6 or 8 digits)." }, { status: 400 });
  }

  const result = await verifyOtpCode(email, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    user: result.user,
    token: result.token,
    refreshToken: result.refreshToken,
  });
}
