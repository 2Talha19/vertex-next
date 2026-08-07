"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrandMark } from "./brand";

type Citation = {
  label: string;
  source: string;
  chunk_index: number;
  similarity: number;
  content: string;
};

type Attachment = {
  name: string;
  chunks: number;
  kind: "pdf" | "image" | "text";
};

type Message = {
  role: "user" | "bot";
  text: string;
  time: string;
  status?: string;
  citations?: Citation[];
  attachment?: Attachment;
};

type SessionDoc = {
  source: string;
  chunks: number;
  kind: Attachment["kind"];
};

type SavedChat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  sessionDocs: SessionDoc[];
  activeSource: string | null;
};

type User = {
  email: string;
  name: string;
};

const GREETING = `**Hello — I'm Vertex for Ask Peham's Docs.**

A router picks the right helper for each message:

- **Docs agent** — answers from your uploads, with citations
- **Chat agent** — normal conversation
- **Weather agent** — weather questions

📎 Upload a file (or drag & drop it onto the chat), then ask. Images are read instantly via hosted Gemini OCR — no local server needed.`;

const SUGGESTIONS = [
  "When are office hours?",
  "What are private notes?",
  "Summarize the handbook",
  "How do I check in daily?",
];

const AUTH_KEY = "vertex-user";
const MAX_CHATS = 30;

function storageKeyFor(email: string) {
  return `vertex-chats-${email.toLowerCase()}`;
}
function currentKeyFor(email: string) {
  return `vertex-current-${email.toLowerCase()}`;
}

function now() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileKind(name: string): Attachment["kind"] {
  const n = name.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|jfif|jpe)$/.test(n)) return "image";
  if (n.endsWith(".pdf")) return "pdf";
  return "text";
}

function isSupportedFile(file: File): boolean {
  const n = file.name.toLowerCase();
  const t = file.type || "";
  if (/\.(png|jpe?g|webp|gif|jfif|jpe)$/.test(n) || t.startsWith("image/"))
    return true;
  if (n.endsWith(".pdf") || t === "application/pdf") return true;
  if (/\.(txt|md)$/.test(n) || t.startsWith("text/")) return true;
  return false;
}

function kindIcon(kind: Attachment["kind"]) {
  if (kind === "image") return "🖼️";
  if (kind === "pdf") return "📄";
  return "📝";
}

function deriveTitle(msgs: Message[]): string {
  const first = msgs.find((m) => m.role === "user" && m.text.trim());
  if (first) return first.text.trim().replace(/\s+/g, " ").slice(0, 42);
  const att = msgs.find((m) => m.attachment);
  if (att?.attachment) return att.attachment.name;
  return "New chat";
}

function timeAgo(ts: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// react-markdown renders raw HTML escaped by default; only markdown links need
// hardening (open in a new tab, never pass the opener window along).
// Inline citation links (#cite-...) are rendered as pill buttons instead, so
// the sentence keeps flowing inside a single paragraph.
function makeMarkdownComponents(
  msgIndex: number,
  citations: Citation[],
  onJump: (msgIndex: number, citeIndex: number) => void
) {
  return {
    a: (props: {
      node?: unknown;
      href?: string;
      children?: React.ReactNode;
    }) => {
      const m = props.href?.match(/^#cite-(\d+)-(\d+)-(\d+)$/);
      if (m) {
        const n = parseInt(m[2], 10);
        const citeIdx = parseInt(m[3], 10);
        const cite = citations[citeIdx];
        return (
          <button
            type="button"
            className="cite-link"
            title={cite ? `Jump to ${cite.source}` : `Source ${n}`}
            aria-label={`Citation ${n}: ${cite?.source ?? "source"}`}
            onClick={() => onJump(msgIndex, citeIdx)}
          >
            {n}
          </button>
        );
      }
      return (
        <a href={props.href} target="_blank" rel="noopener noreferrer">
          {props.children}
        </a>
      );
    },
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthUserLite = { email: string; name: string };


function AuthScreen({
  light,
  onToggleTheme,
  onAuthed,
}: {
  light: boolean;
  onToggleTheme: () => void;
  onAuthed: (user: AuthUserLite) => void;
}) {
  const [mode, setMode] = useState<
    "login" | "signup" | "verify" | "forgot" | "reset"
  >("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  // --- Email verification step (shared by signup verify + password reset) ---
  const [verifyEmail, setVerifyEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [codeLen, setCodeLen] = useState(6);
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    if (mode === "signup") nameRef.current?.focus();
    if (mode === "forgot") emailRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  // Auto-submit once all six digits are entered.
  useEffect(() => {
    if (mode === "verify" && code.every((d) => d) && !busy) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function switchMode(m: "login" | "signup") {
    setMode(m);
    setError(null);
    setNotice(null);
    setShowPw(false);
  }

  function handleCodeChange(i: number, val: string) {
    const digit = val.replace(/\D/g, "").slice(-1);
    setCode((prev) => {
      const next = [...prev];
      next[i] = digit;
      return next;
    });
    if (digit && i < codeLen - 1) codeRefs.current[i + 1]?.focus();
  }

  function handleCodeKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !code[i] && i > 0) {
      codeRefs.current[i - 1]?.focus();
    }
  }

  function handleCodePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, codeLen);
    if (!text) return;
    e.preventDefault();
    setCode(text.split("").concat(Array(codeLen).fill("")).slice(0, codeLen));
    codeRefs.current[Math.min(text.length, codeLen - 1)]?.focus();
  }

  async function verify() {
    const token = code.join("");
    if (token.length < 6 || busy) return;
    setBusy(true);
    setVerifyErr(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifyEmail, code: token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.user) {
        throw new Error(data.error || "Verification failed.");
      }
      onAuthed(data.user);
    } catch (err) {
      setVerifyErr((err as Error).message);
      setShake(true);
      setCode(Array(6).fill(""));
      window.setTimeout(() => setShake(false), 600);
      codeRefs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (resendIn > 0 || resending) return;
    setResending(true);
    setVerifyErr(null);
    const isReset = mode === "reset";
    try {
      const res = await fetch(isReset ? "/api/auth/forgot" : "/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isReset
            ? { email: resetEmail }
            : { email: verifyEmail, name }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || "Could not resend the code.");
      }
      setResendIn(60);
    } catch (err) {
      setVerifyErr((err as Error).message);
    } finally {
      setResending(false);
    }
  }

  function renderCodeBoxes() {
    return (
      <div className={`code-boxes${shake ? " shake" : ""}`}>
        {code.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              codeRefs.current[i] = el;
            }}
            inputMode="numeric"
            maxLength={1}
            autoComplete="one-time-code"
            className="code-box"
            value={d}
            aria-label={`Verification digit ${i + 1}`}
            onChange={(e) => handleCodeChange(i, e.target.value)}
            onKeyDown={(e) => handleCodeKey(i, e)}
            onPaste={handleCodePaste}
          />
        ))}
      </div>
    );
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || "Could not send the code.");
      }
      const len = data.codeLength ?? 6;
      setResetEmail(em);
      setCodeLen(len);
      setCode(Array(len).fill(""));
      setVerifyErr(null);
      setResendIn(60);
      setPassword("");
      setConfirm("");
      setMode("reset");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setVerifyErr(null);
    const token = code.join("");
    if (token.length < codeLen) {
      setVerifyErr("Enter the full code from the email.");
      return;
    }
    if (password.length < 6) {
      setVerifyErr("New password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setVerifyErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: resetEmail,
          code: token,
          newPassword: password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || "Reset failed.");
      }
      setEmail(resetEmail);
      setPassword("");
      setConfirm("");
      setMode("login");
      setNotice("Password updated — sign in with your new password.");
    } catch (err) {
      setVerifyErr((err as Error).message);
      setShake(true);
      setCode(Array(codeLen).fill(""));
      window.setTimeout(() => setShake(false), 600);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const em = email.trim().toLowerCase();

    if (!EMAIL_RE.test(em)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (mode === "signup") {
      if (name.trim().length < 2) {
        setError("Please enter your name.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match.");
        return;
      }
      setBusy(true);
      try {
        const res = await fetch("/api/auth/send-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: em, name: name.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          throw new Error(data.error || "Could not send the code.");
        }
        const len = data.codeLength ?? 6;
        setVerifyEmail(em);
        setCodeLen(len);
        setCode(Array(len).fill(""));
        setVerifyErr(null);
        setResendIn(60);
        setMode("verify");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    } else {
      setBusy(true);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: em, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.user) {
          throw new Error(data.error || "Login failed.");
        }
        onAuthed(data.user);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-blob b1" aria-hidden />
      <div className="auth-blob b2" aria-hidden />
      <div className="auth-blob b3" aria-hidden />
      <div className="auth-grid" aria-hidden />

      <button
        type="button"
        className="auth-theme-toggle"
        onClick={onToggleTheme}
        aria-label="Toggle theme"
      >
        {light ? "☀️" : "🌙"}
      </button>

      <div className="auth-card">
        <div className="auth-logo">
          <BrandMark large />
          <h1 className="auth-title" aria-label="Vertex">
            {"Vertex".split("").map((ch, i) => (
              <span key={i} style={{ animationDelay: `${0.06 * i}s` }}>
                {ch}
              </span>
            ))}
          </h1>
          <p>
            {mode === "verify" || mode === "forgot" || mode === "reset"
              ? "Check your inbox"
              : "Internal knowledge assistant"}
          </p>
        </div>

        {mode === "verify" ? (
          <div className="verify-step">
            <p className="verify-hint">
              We emailed a {codeLen}-digit code to <strong>{verifyEmail}</strong>.
              Enter it below to verify your account.
            </p>
            {renderCodeBoxes()}
            {verifyErr && (
              <div className="auth-error" role="alert">
                {verifyErr}
              </div>
            )}
            <button
              type="button"
              className="auth-submit"
              disabled={busy || code.some((d) => !d)}
              onClick={() => void verify()}
            >
              {busy ? "Verifying…" : "Verify & create account"}
            </button>
            <div className="resend-row">
              <button
                type="button"
                className="resend-btn"
                disabled={resendIn > 0 || resending}
                onClick={() => void resend()}
              >
                {resendIn > 0
                  ? `Resend code in ${resendIn}s`
                  : resending
                    ? "Sending…"
                    : "Resend code"}
              </button>
              <button
                type="button"
                className="auth-switch"
                onClick={() => setMode("signup")}
              >
                Change email
              </button>
            </div>
          </div>
        ) : mode === "forgot" ? (
          <form className="reset-step" onSubmit={submitForgot} noValidate>
            <p className="verify-hint">
              Enter your account email and we'll send a reset code to it.
            </p>
            <label className="auth-field">
              <span>Email</span>
              <input
                ref={emailRef}
                type="email"
                autoComplete="email"
                placeholder="you@peham.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset code"}
            </button>
            <div className="resend-row">
              <button
                type="button"
                className="auth-switch"
                onClick={() => switchMode("login")}
              >
                ← Back to sign in
              </button>
            </div>
          </form>
        ) : mode === "reset" ? (
          <form className="reset-step" onSubmit={submitReset} noValidate>
            <p className="verify-hint">
              We emailed a {codeLen}-digit reset code to{" "}
              <strong>{resetEmail}</strong>. Enter it, then choose a new
              password.
            </p>
            {renderCodeBoxes()}
            {verifyErr && (
              <div className="auth-error" role="alert">
                {verifyErr}
              </div>
            )}
            <label className="auth-field">
              <span>New password</span>
              <div className="pw-wrap">
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPw ? "🙈" : "👁️"}
                </button>
              </div>
            </label>
            <label className="auth-field">
              <span>Confirm new password</span>
              <div className="pw-wrap">
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
            </label>
            <button
              type="submit"
              className="auth-submit"
              disabled={busy || code.some((d) => !d)}
            >
              {busy ? "Resetting…" : "Reset password"}
            </button>
            <div className="resend-row">
              <button
                type="button"
                className="resend-btn"
                disabled={resendIn > 0 || resending}
                onClick={() => void resend()}
              >
                {resendIn > 0
                  ? `Resend code in ${resendIn}s`
                  : resending
                    ? "Sending…"
                    : "Resend code"}
              </button>
              <button
                type="button"
                className="auth-switch"
                onClick={() => setMode("forgot")}
              >
                Change email
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="auth-tabs" role="tablist" aria-label="Account access">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={`auth-tab${mode === "login" ? " active" : ""}`}
                onClick={() => switchMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={`auth-tab${mode === "signup" ? " active" : ""}`}
                onClick={() => switchMode("signup")}
              >
                Sign up
              </button>
            </div>

            <form onSubmit={submit} noValidate>
              {mode === "signup" && (
                <label className="auth-field">
                  <span>Name</span>
                  <input
                    ref={nameRef}
                    type="text"
                    autoComplete="name"
                    placeholder="Your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
              )}

              <label className="auth-field">
                <span>Email</span>
                <input
                  ref={emailRef}
                  type="email"
                  autoComplete="email"
                  placeholder="you@peham.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="auth-field">
                <span>Password</span>
                <div className="pw-wrap">
                  <input
                    type={showPw ? "text" : "password"}
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPw ? "🙈" : "👁️"}
                  </button>
                </div>
              </label>

              {mode === "login" && (
                <button
                  type="button"
                  className="forgot-link"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setMode("forgot");
                  }}
                >
                  Forgot password?
                </button>
              )}

              {mode === "signup" && (
                <label className="auth-field">
                  <span>Confirm password</span>
                  <div className="pw-wrap">
                    <input
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repeat your password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                    />
                  </div>
                </label>
              )}

              {notice && (
                <div className="auth-notice" role="status">
                  {notice}
                </div>
              )}

              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}

              <button type="submit" className="auth-submit" disabled={busy}>
                {busy
                  ? mode === "signup"
                    ? "Creating account…"
                    : "Signing in…"
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>

            <p className="auth-note">
              {mode === "signup"
                ? "Create an account with your real email — we'll send a one-time code to verify it."
                : "Accounts are real — created with email verification (Supabase Auth)."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "bot", text: GREETING, time: "" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [light, setLight] = useState(false);
  const [sessionDocs, setSessionDocs] = useState<SessionDoc[]>([]);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [flashKey, setFlashKey] = useState<string>("");
  const [copiedKey, setCopiedKey] = useState<number | null>(null);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [waitingSecs, setWaitingSecs] = useState(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const chatIdRef = useRef<string | null>(null);
  const lastSavedFingerprint = useRef("");

  useEffect(() => {
    // Set clock only on client — avoids SSR/client time mismatch hydration error
    setMessages([{ role: "bot", text: GREETING, time: now() }]);
    setLight(localStorage.getItem("theme") === "true");
    setSidebarOpen(localStorage.getItem("sidebar-open") !== "false");

    // Restore the session + that user's saved chats.
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (raw) {
        const u = JSON.parse(raw) as User;
        if (u?.email) {
          setUser(u);
          loadChatsFor(u.email);
        }
      }
    } catch {
      // Corrupted storage — start fresh
    }
    setAuthChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadChatsFor(email: string) {
    try {
      const raw = localStorage.getItem(storageKeyFor(email));
      const parsed = raw ? (JSON.parse(raw) as SavedChat[]) : [];
      const valid = Array.isArray(parsed)
        ? parsed.filter((c) => c && c.id && Array.isArray(c.messages))
        : [];
      setChats(valid);
      const curId = localStorage.getItem(currentKeyFor(email));
      const cur = valid.find((c) => c.id === curId) ?? null;
      if (cur) {
        chatIdRef.current = cur.id;
        setCurrentChatId(cur.id);
        setMessages(cur.messages);
        setSessionDocs(cur.sessionDocs ?? []);
        setActiveSource(cur.activeSource ?? null);
        // Stamp the fingerprint so the auto-save effect no-ops on restore
        // (avoids bumping updatedAt and reordering the list on login/reload).
        lastSavedFingerprint.current = JSON.stringify({
          messages: cur.messages,
          sessionDocs: cur.sessionDocs ?? [],
          activeSource: cur.activeSource ?? null,
        });
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    document.body.classList.toggle("light", light);
    localStorage.setItem("theme", String(light));
  }, [light]);

  useEffect(() => {
    // Reset the drag overlay if the drag is cancelled or the window loses focus
    const resetDrag = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragend", resetDrag);
    window.addEventListener("blur", resetDrag);
    return () => {
      window.removeEventListener("dragend", resetDrag);
      window.removeEventListener("blur", resetDrag);
    };
  }, []);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  /** Save the open conversation into localStorage (skips empty/streaming chats). */
  function persistCurrentChat() {
    if (!user || loading || uploading) return;
    const meaningful = messages.some(
      (m) => m.role === "user" && (m.text.trim() || !!m.attachment)
    );
    if (!meaningful) return;

    const fingerprint = JSON.stringify({
      messages,
      sessionDocs,
      activeSource,
    });
    if (fingerprint === lastSavedFingerprint.current) return;
    lastSavedFingerprint.current = fingerprint;

    const id =
      chatIdRef.current ?? (chatIdRef.current = crypto.randomUUID());
    const entry: SavedChat = {
      id,
      title: deriveTitle(messages),
      updatedAt: Date.now(),
      messages,
      sessionDocs,
      activeSource,
    };

    setChats((prev) => {
      const next = [entry, ...prev.filter((c) => c.id !== id)].slice(
        0,
        MAX_CHATS
      );
      try {
        localStorage.setItem(storageKeyFor(user.email), JSON.stringify(next));
      } catch {
        // storage full / unavailable — keep in memory only
      }
      return next;
    });

    if (currentChatId !== id) {
      setCurrentChatId(id);
      try {
        localStorage.setItem(currentKeyFor(user.email), id);
      } catch {
        // ignore
      }
    }
  }

  // Auto-save whenever the conversation settles (not while streaming/uploading).
  useEffect(() => {
    persistCurrentChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sessionDocs, activeSource, loading, uploading, user]);

  /** Session starts after email verification (signup) or a successful login. */
  function handleAuthed(u: AuthUserLite) {
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(u));
    } catch {
      // ignore
    }
    setUser({ email: u.email, name: u.name });
    setMessages([{ role: "bot", text: GREETING, time: now() }]);
    setSessionDocs([]);
    setActiveSource(null);
    setFlashKey("");
    setCopiedKey(null);
    chatIdRef.current = null;
    lastSavedFingerprint.current = "";
    setCurrentChatId(null);
    loadChatsFor(u.email);
  }

  function handleLogout() {
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      // ignore
    }
    setUser(null);
    setChats([]);
    setMessages([{ role: "bot", text: GREETING, time: now() }]);
    setSessionDocs([]);
    setActiveSource(null);
    setFlashKey("");
    setCopiedKey(null);
    chatIdRef.current = null;
    lastSavedFingerprint.current = "";
    setCurrentChatId(null);
    setSidebarOpen(true);
  }

  function openChat(id: string) {
    persistCurrentChat();
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    chatIdRef.current = id;
    setCurrentChatId(id);
    setMessages(chat.messages);
    setSessionDocs(chat.sessionDocs ?? []);
    setActiveSource(chat.activeSource ?? null);
    // Stamp the fingerprint so the auto-save effect no-ops (no reorder bump).
    lastSavedFingerprint.current = JSON.stringify({
      messages: chat.messages,
      sessionDocs: chat.sessionDocs ?? [],
      activeSource: chat.activeSource ?? null,
    });
    setFlashKey("");
    setCopiedKey(null);
    try {
      if (user) localStorage.setItem(currentKeyFor(user.email), id);
    } catch {
      // ignore
    }
    if (window.innerWidth <= 768) setSidebarOpen(false);
  }

  function deleteChat(id: string) {
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      try {
        if (user) {
          localStorage.setItem(storageKeyFor(user.email), JSON.stringify(next));
        }
      } catch {
        // ignore
      }
      return next;
    });
    if (id === currentChatId) {
      chatIdRef.current = null;
      lastSavedFingerprint.current = "";
      setCurrentChatId(null);
      setMessages([{ role: "bot", text: GREETING, time: now() }]);
      setSessionDocs([]);
      setActiveSource(null);
      try {
        if (user) localStorage.removeItem(currentKeyFor(user.email));
      } catch {
        // ignore
      }
    }
  }

  function setSidebar(open: boolean) {
    setSidebarOpen(open);
    try {
      localStorage.setItem("sidebar-open", String(open));
    } catch {
      // ignore
    }
  }

  function toggleSidebar() {
    setSidebarOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("sidebar-open", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Escape closes the sidebar (useful for the mobile overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebar(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function uploadFile(file: File) {
    if (uploading) return; // ignore drops/uploads while one is in flight
    if (!isSupportedFile(file)) {
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text: "❌ Unsupported file type. Upload .txt, .md, .pdf, or an image (.png/.jpg/.webp).",
          time: now(),
        },
      ]);
      return;
    }

    const kind = fileKind(file.name);
    setUploading(true);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: "",
        time: now(),
        attachment: { name: file.name, chunks: 0, kind },
        status: "Starting upload…",
      },
    ]);

    const patchStatus = (status: string) => {
      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1] };
        if (last.role !== "user") return prev;
        last.status = status;
        copy[copy.length - 1] = last;
        return copy;
      });
    };

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.body) throw new Error("No upload stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let donePayload: {
        source: string;
        chunks: number;
        preview?: string;
      } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            text?: string;
            source?: string;
            chunks?: number;
            preview?: string;
          };
          if (event.type === "status" && event.text) {
            patchStatus(event.text);
          } else if (event.type === "error") {
            throw new Error(event.text || "Upload failed");
          } else if (event.type === "done" && event.source) {
            donePayload = {
              source: event.source,
              chunks: event.chunks ?? 0,
              preview: event.preview,
            };
          }
        }
      }

      if (!donePayload) throw new Error("Upload finished with no result");

      const source = donePayload.source;
      const chunks = donePayload.chunks;
      const others = sessionDocs.filter((d) => d.source !== source);

      setSessionDocs([...others, { source, chunks, kind }]);
      setActiveSource(source);

      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1] };
        last.status = undefined;
        last.attachment = { name: source, chunks, kind };
        copy[copy.length - 1] = last;
        copy.push({
          role: "bot",
          text:
            `Got it — indexed **${source}** (${chunks} chunks).\n\n` +
            (donePayload.preview
              ? `Preview: “${donePayload.preview.replace(/\s+/g, " ").trim()}${
                  donePayload.preview.length >= 280 ? "…" : ""
                }”\n\n`
              : "") +
            `I'll answer from this file by default. ` +
            (others.length > 0
              ? `Earlier in this chat: ${others.map((o) => o.source).join(", ")}. Name one or say “previous” to use an older file.`
              : `Upload another anytime — the newest becomes the default.`),
          time: now(),
        });
        return copy;
      });
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1] };
        last.status = undefined;
        last.text = `❌ Upload failed: ${(err as Error).message}`;
        copy[copy.length - 1] = last;
        return copy;
      });
    } finally {
      setUploading(false);
    }
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadFile(file);
  }

  // --- Drag & drop ---
  function onDragEnter(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragOver(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
  }

  function onDragLeave(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  function jumpToCitation(msgIndex: number, citeIndex: number) {
    const key = `cite-${msgIndex}-${citeIndex}`;
    document
      .getElementById(key)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashKey(key);
    window.setTimeout(
      () => setFlashKey((k) => (k === key ? "" : k)),
      1800
    );
  }

  async function copyMessage(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(i);
      window.setTimeout(() => setCopiedKey((k) => (k === i ? null : k)), 1500);
    } catch {
      // Clipboard unavailable — ignore
    }
  }

  function renderBotText(
    text: string,
    msgIndex: number,
    citations?: Citation[]
  ) {
    // Turn inline markers — [1] or [Source 1 | file] — into markdown links
    // (#cite-msgIndex-citeIndex). The `a` override renders those as citation
    // pills INSIDE the paragraph, so sentences keep flowing. Markers without
    // a matching citation are left as plain text.
    const markerRe = /\[Source\s*(\d+)[^\]]*\]|\[(\d+)\]/gi;
    const withLinks = text.replace(markerRe, (match, srcNum, bareNum) => {
      const n = srcNum ? parseInt(srcNum, 10) : parseInt(bareNum, 10);
      if (!citations?.[n - 1]) return match;
      return `[${n}](#cite-${msgIndex}-${n}-${n - 1})`;
    });
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={makeMarkdownComponents(
          msgIndex,
          citations ?? [],
          jumpToCitation
        )}
      >
        {withLinks}
      </ReactMarkdown>
    );
  }

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading || uploading) return;

    const sources = sessionDocs.map((d) => d.source);

    // History before this new user message (for follow-ups like "and private notes").
    // Strip citation markers so the model doesn't reuse stale [n] numbers.
    const history = messages
      .filter((m) => (m.role === "user" || m.role === "bot") && m.text.trim())
      .filter((m) => !m.text.startsWith("❌"))
      .slice(-8)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("bot" as const),
        text: m.text.replace(/\[Source\s*\d+[^\]]*\]|\[\d+\]/gi, ""),
      }));

    setInput("");
    setLoading(true);
    setWaitingSecs(0);
    setMessages((prev) => [
      ...prev,
      { role: "user", text, time: now() },
      { role: "bot", text: "", time: now(), status: "Thinking…" },
    ]);

    // Elapsed-seconds ticker so a slow response never looks frozen.
    const elapsedTimer = window.setInterval(
      () => setWaitingSecs((s) => s + 1),
      1000
    );

    // Hard cap: if the server is dead or stuck, fail loudly instead of
    // spinning forever (dev cold-compiles /api/chat ~10-16s on first hit).
    const controller = new AbortController();
    const abortTimer = window.setTimeout(
      () => controller.abort(),
      90_000
    );

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          source: activeSource,
          sources,
          history,
        }),
        signal: controller.signal,
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            text?: string;
            name?: string;
            citations?: Citation[];
          };

          setMessages((prev) => {
            const copy = [...prev];
            const last = { ...copy[copy.length - 1] };
            if (last.role !== "bot") return prev;

            if (event.type === "status" && event.text) {
              last.status = event.text;
            } else if (event.type === "tool" && event.name) {
              last.status = `🔧 ${event.name}`;
            } else if (event.type === "token" && event.text) {
              last.status = undefined;
              last.text = (last.text || "") + event.text;
            } else if (event.type === "done") {
              last.status = undefined;
              last.citations = event.citations ?? [];
            } else if (event.type === "error" && event.text) {
              last.status = undefined;
              last.text = `❌ ${event.text}`;
            }

            copy[copy.length - 1] = last;
            return copy;
          });
        }
      }
    } catch (err) {
      const timedOut = (err as Error).name === "AbortError";
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "bot",
          text: timedOut
            ? "❌ The request timed out after 90s — the server may have restarted mid-request. Try again; if it keeps timing out, check the dev server is running."
            : "❌ Unable to connect. Make sure the server is running and .env.local is set.",
          time: now(),
        };
        return copy;
      });
    } finally {
      window.clearTimeout(abortTimer);
      window.clearInterval(elapsedTimer);
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function newChat() {
    persistCurrentChat();
    chatIdRef.current = null;
    lastSavedFingerprint.current = "";
    setCurrentChatId(null);
    setMessages([{ role: "bot", text: GREETING, time: now() }]);
    setSessionDocs([]);
    setActiveSource(null);
    setFlashKey("");
    setCopiedKey(null);
    try {
      if (user) localStorage.removeItem(currentKeyFor(user.email));
    } catch {
      // ignore
    }
    inputRef.current?.focus();
  }

  const remaining = 2000 - input.length;
  const showSuggestions =
    messages.length === 1 && !loading && !uploading && !dragging;

  if (!authChecked) {
    return (
      <div className="boot-screen">
        <BrandMark large />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        light={light}
        onToggleTheme={() => setLight((v) => !v)}
        onAuthed={handleAuthed}
      />
    );
  }

  return (
    <div className={`container${sidebarOpen ? "" : " sidebar-collapsed"}`}>
      <aside className="sidebar">
        <div className="logo">
          <BrandMark />
          <div className="logo-text">
            <h2>Vertex</h2>
          </div>
        </div>

        <button className="new-chat" onClick={newChat}>
          + New Chat
        </button>

        <nav className="history" aria-label="Past chats">
          <div className="sidebar-section-title">Chats</div>
          {chats.length === 0 ? (
            <div className="history-empty">
              No past chats yet — conversations save here automatically.
            </div>
          ) : (
            <div className="history-list">
              {chats.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  className={`history-item${
                    c.id === currentChatId ? " active" : ""
                  }`}
                  title={c.title}
                  onClick={() => openChat(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openChat(c.id);
                    }
                  }}
                >
                  <span className="history-item-icon" aria-hidden>
                    💬
                  </span>
                  <div className="history-item-meta">
                    <div className="history-item-title">{c.title}</div>
                    <div className="history-item-time">
                      {timeAgo(c.updatedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="history-item-delete"
                    title="Delete chat"
                    aria-label={`Delete chat: ${c.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChat(c.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </nav>

        {sessionDocs.length > 0 && (
          <div className="session-docs">
            <div className="session-docs-title">In this chat</div>
            {sessionDocs.map((d) => (
              <button
                key={d.source}
                type="button"
                className={`session-doc${
                  d.source === activeSource ? " active" : ""
                }`}
                title={`Use ${d.source}`}
                onClick={() => setActiveSource(d.source)}
              >
                <span>{kindIcon(d.kind)}</span>
                <span className="session-doc-name">{d.source}</span>
              </button>
            ))}
          </div>
        )}

        <div className="footer-version">Capstone · RAG + OCR + citations</div>
      </aside>

      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <main
        className="chat-section"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <header>
          <div className="header-left">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-expanded={sidebarOpen}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="9" y1="4" x2="9" y2="20" />
                <line x1="13" y1="9" x2="17" y2="9" />
                <line x1="13" y1="14" x2="17" y2="14" />
              </svg>
            </button>
            <div className="brand">
              <BrandMark />
              <h2>Vertex</h2>
            </div>
            <span className="status">
              <span className="status-dot" />
              Online
            </span>
          </div>
          <div className="header-right">
            <div className="user-chip" title={user.email}>
              <span className="user-avatar" aria-hidden>
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="user-name">{user.name}</span>
              <button
                type="button"
                className="logout-btn"
                onClick={handleLogout}
                title="Log out"
                aria-label="Log out"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
            <button id="themeToggle" onClick={() => setLight((v) => !v)}>
              {light ? "☀️" : "🌙"}
            </button>
          </div>
        </header>

        <div id="chat" className="chat-box" ref={chatRef}>
          {messages.map((m, i) => {
            const isEmptyBot =
              m.role === "bot" &&
              !m.text &&
              !m.attachment &&
              loading &&
              i === messages.length - 1;
            const isStreaming =
              m.role === "bot" &&
              !m.status &&
              !!m.text &&
              loading &&
              i === messages.length - 1;
            return (
              <div key={i} className={`message ${m.role}`}>
                <div className="avatar">{m.role === "user" ? "👤" : "🤖"}</div>
                <div className="content">
                  <div className="name">
                    {m.role === "user" ? "You" : "Vertex"}
                  </div>
                  {m.status && (
                    <div className="tool-status">
                      {m.status}
                      {isEmptyBot && waitingSecs > 8
                        ? ` · ${waitingSecs}s`
                        : ""}
                    </div>
                  )}
                  {m.attachment && (
                    <div className={`chat-attach kind-${m.attachment.kind}`}>
                      <span className="chat-attach-icon" aria-hidden>
                        {kindIcon(m.attachment.kind)}
                      </span>
                      <div className="chat-attach-meta">
                        <div className="chat-attach-name">
                          {m.attachment.name}
                        </div>
                        <div className="chat-attach-sub">
                          {m.attachment.chunks > 0
                            ? `${m.attachment.chunks} chunks indexed`
                            : m.status
                              ? "Indexing…"
                              : "Document"}
                        </div>
                      </div>
                    </div>
                  )}
                  {isEmptyBot && !m.status ? (
                    <div className="bubble typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : m.text ? (
                    <div className="bubble-wrap">
                      <div
                        className={`bubble ${m.role === "bot" ? "markdown" : ""}`}
                      >
                        {m.role === "bot"
                          ? renderBotText(m.text, i, m.citations)
                          : m.text}
                        {isStreaming && <span className="stream-cursor" />}
                      </div>
                      {m.role === "bot" && m.text && !m.status && (
                        <button
                          type="button"
                          className={`copy-btn${
                            copiedKey === i ? " copied" : ""
                          }`}
                          title="Copy answer"
                          aria-label="Copy answer"
                          onClick={() => copyMessage(i, m.text)}
                        >
                          {copiedKey === i ? "✓" : "⧉"}
                        </button>
                      )}
                    </div>
                  ) : null}
                  {m.citations && m.citations.length > 0 && (
                    <div className="citations">
                      <div className="citations-title">
                        Sources
                        {m.citations.length > 1
                          ? ` (${m.citations.length})`
                          : ""}
                      </div>
                      {m.citations.map((c, ci) => {
                        const citeKey = `cite-${i}-${ci}`;
                        const clipped = c.content.slice(0, 260);
                        const isLong = c.content.length > 260;
                        return (
                          <div
                            key={citeKey}
                            id={citeKey}
                            className={`citation${
                              flashKey === citeKey ? " flash" : ""
                            }`}
                          >
                            <div className="citation-head">
                              <span className="citation-num">{ci + 1}</span>
                              <span className="citation-file">{c.source}</span>
                              <span className="citation-chunk">
                                chunk {c.chunk_index + 1}
                              </span>
                              <span
                                className="citation-match"
                                title="Retrieval similarity"
                              >
                                {c.similarity}% match
                              </span>
                            </div>
                            {isLong ? (
                              <details className="citation-details">
                                <summary>{clipped}…</summary>
                                <p>{c.content}</p>
                              </details>
                            ) : (
                              <p>{c.content}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="timestamp" suppressHydrationWarning>
                    {m.time}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="input-area">
          {showSuggestions && (
            <div className="welcome-area">
              <div className="welcome-title">Try asking</div>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => void send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {activeSource && (
            <div className="active-doc-hint">
              Answering from <strong>{activeSource}</strong>
              {sessionDocs.length > 1
                ? " · name another file or pick one in the sidebar"
                : ""}
            </div>
          )}
          <div className="input-row">
            <input
              ref={inputRef}
              value={input}
              maxLength={2000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                activeSource
                  ? `Ask about ${activeSource}…`
                  : "Upload a doc, then ask…"
              }
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp,.gif,.jfif,text/plain,application/pdf,image/*"
              onChange={onUpload}
              disabled={uploading}
              className="file-input-hidden"
              style={{ display: "none" }}
              tabIndex={-1}
              aria-hidden
            />
            <button
              type="button"
              className="attach-btn"
              title="Upload .txt, .pdf, or image"
              aria-label="Upload document"
              disabled={uploading || loading}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              className="send-btn"
              onClick={() => void send()}
              disabled={loading || uploading}
              aria-label="Send"
            >
              ➜
            </button>
          </div>
          <div className="input-footer">
            <span className="char-counter">
              {remaining} characters remaining
            </span>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              .txt · .pdf · images+OCR · Groq · Supabase
            </span>
          </div>
        </div>

        {dragging && (
          <div className="drop-overlay" aria-hidden>
            <div className="drop-card">
              <span className="drop-icon">📎</span>
              <span>Drop your file to index it</span>
              <span className="drop-sub">.txt · .md · .pdf · images</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
