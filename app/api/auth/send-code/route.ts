/**
 * POST /api/auth/send-code — email a 6-digit verification code (Supabase OTP).
 * Body: { email, name? }
 */
import { NextResponse } from "next/server";
import { sendOtpCode } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
  };
  const email = (body.email || "").trim().toLowerCase();
  const name = (body.name || "").trim().slice(0, 40);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const result = await sendOtpCode(email, name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, email, codeLength: result.codeLength });
}
