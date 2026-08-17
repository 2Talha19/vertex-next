"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BrandMark } from "../brand";

/**
 * Consumes the emailed confirmation link (?token_hash=...&type=email),
 * verifies server-side, stores the session, and sends the user into the app.
 * Rendered at both /auth/confirm (Supabase's default email path) and
 * /auth/callback.
 */
function LinkHandlerInner() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tokenHash = params.get("token_hash");
    const type = params.get("type") ?? "email";
    if (!tokenHash) {
      setError("This confirmation link is missing its token.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenHash, type }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data.user) {
          throw new Error(data.error || "Verification failed.");
        }
        // Same session shape the main app expects (Home reads it on mount).
        localStorage.setItem(
          "vertex-user",
          JSON.stringify({
            email: data.user.email,
            name: data.user.name,
            token: data.token,
          })
        );
        window.location.href = "/";
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <BrandMark large />
        <h1
          className="auth-title"
          aria-label="Vertex"
          style={{ justifyContent: "center" }}
        >
          {"Vertex".split("").map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </h1>
        {error ? (
          <>
            <p className="verify-hint" style={{ margin: "14px 0 4px" }}>
              {error}
            </p>
            <button
              type="button"
              className="auth-submit"
              onClick={() => (window.location.href = "/")}
            >
              Back to Vertex
            </button>
          </>
        ) : (
          <p className="verify-hint" style={{ margin: "14px 0 4px" }}>
            Verifying your email…
          </p>
        )}
      </div>
    </div>
  );
}

export default function LinkHandler() {
  return (
    <Suspense
      fallback={
        <div className="boot-screen">
          <BrandMark />
        </div>
      }
    >
      <LinkHandlerInner />
    </Suspense>
  );
}
