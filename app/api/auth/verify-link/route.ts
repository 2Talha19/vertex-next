/**
 * POST /api/auth/verify-link — consume the token_hash from the confirmation
 * link in the emailed code. Body: { tokenHash, type }
 */
import { NextResponse } from "next/server";
import { verifyLink } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    tokenHash?: string;
    type?: string;
  };
  const tokenHash = String(body.tokenHash || "").trim();
  const type = String(body.type || "email").trim();

  if (!tokenHash) {
    return NextResponse.json({ error: "Invalid confirmation link." }, { status: 400 });
  }

  const result = await verifyLink(tokenHash, type);
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
