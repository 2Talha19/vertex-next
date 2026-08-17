/**
 * POST /api/auth/refresh — exchange a refresh token for a fresh session.
 * Body: { refreshToken }
 * Used by the client to silently renew the access token before it expires
 * (proactive timer) or on a 401 (retry once before logging out).
 */
import { NextResponse } from "next/server";
import { refreshSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    refreshToken?: string;
  };
  const refreshToken = String(body.refreshToken || "").trim();
  if (!refreshToken) {
    return NextResponse.json(
      { error: "Missing refresh token." },
      { status: 400 }
    );
  }

  const result = await refreshSessionToken(refreshToken);
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
