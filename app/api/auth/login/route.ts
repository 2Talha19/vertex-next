/**
 * POST /api/auth/login — email + password login (Supabase Auth).
 * Body: { email, password }
 */
import { NextResponse } from "next/server";
import { loginWithPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  const email = (body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const result = await loginWithPassword(email, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    user: result.user,
    token: result.token,
    refreshToken: result.refreshToken,
  });
}
