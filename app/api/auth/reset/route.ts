/**
 * POST /api/auth/reset — verify the emailed code and set a new password.
 * Body: { email, code, newPassword }
 */
import { NextResponse } from "next/server";
import { resetPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    code?: string;
    newPassword?: string;
  };
  const email = (body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  const newPassword = String(body.newPassword || "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!/^\d{6,8}$/.test(code)) {
    return NextResponse.json({ error: "Enter the code from the email (6 or 8 digits)." }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: "New password must be at least 6 characters." }, { status: 400 });
  }

  const result = await resetPassword(email, code, newPassword);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
