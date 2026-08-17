# Vertex — Ask Peham's Docs (capstone)

Same **Vertex** app from Weeks 1–3. Capstone focus: internal docs Q&A for Peham.

| Skill | Feature |
|-------|---------|
| Week 1 | Backend keys, streaming |
| Week 2 | Upload → embed → Supabase; citations |
| Week 3 | Tools: `search_documents` (+ optional `get_weather`) |
| Week 4 | Peham Docs branding, **hosted Gemini OCR** (images → text in ~2s, no local server) |

See **[CAPSTONE.md](./CAPSTONE.md)** for the build plan.

## Setup

```powershell
cd C:\Users\HP\ai-internship\vertex-next
npm install
Copy-Item .env.local.example .env.local
```

`.env.local`:

- `GROQ_API_KEY` (chat + image OCR)
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `JINA_API_KEY`
- `GEMINI_API_KEY` (image OCR + scanned PDFs — makes image uploads fast with no local server)

Uploads: `.txt`/`.md` read directly; **PDFs parsed with `unpdf`** (modern Mozilla pdf.js —
replaces the old `pdf-parse` whose 2018-era pdf.js threw `bad XRef entry` under Next.js and
failed on modern xref-stream PDFs); images go through the OCR cascade below.

Image OCR cascade (first engine that returns text wins):
**Gemini 2.5 Flash** → **Groq qwen vision** (reuses `GROQ_API_KEY`) →
**Hugging Face Qwen2.5-VL** (optional, needs `HF_TOKEN`) → local Python. See `CAPSTONE.md`.

Supabase needs Week 2 `documents` + `match_documents`, plus Auth (email provider enabled — default).

## Accounts & email verification

- **Sign up** with name + email + password (confirm) → a one-time code is **emailed** (Supabase Auth OTP) → enter the code **or click the confirmation link** to verify → session starts.
- **Sign in** with email + password; only verified accounts can log in.
- **Forgot password?** → a reset code is emailed → enter it + a new password → sign in with the new one.
- Chat history is per-account (stored in `localStorage` under `vertex-chats-<email>`).
- The code length is auto-detected from the project (6 or 8 digits).
- The emailed confirmation **link** lands on `/auth/confirm` (alias `/auth/callback`), which consumes the token and logs you in — no more "site can't be reached".

### Why the emailed link used to fail (and the fix)
Supabase emails a confirmation link pointing at the project's configured **Site URL** (default `http://localhost:3000`). The app serves the `/auth/confirm` handler (alias `/auth/callback`), so the link works as long as the app is reachable at that URL. Two safeguards:

1. **Run on the port Supabase expects** — `npm run dev` serves on port 3000, matching the default Site URL.
2. **Any port / any host** — the app now auto-detects the URL you're actually on (from the request, or `AUTH_REDIRECT_URL` in `.env.local`) and passes it to Supabase as `redirectTo`, so the emailed link points at the running app even on a different port. The URL must be in **Supabase → Authentication → URL Configuration → Redirect URLs**; add `http://localhost:**/**` (wildcard) to allow any localhost port. If a URL isn't allowlisted, the code is still emailed — only the link falls back to the Site URL.

When you deploy, set **Site URL / Redirect URLs** to your real domain (e.g. `https://your-app.com` and `https://your-app.com/auth/confirm`).

### Email sending: SMTP (recommended) — no domain, no per-hour cap
The Supabase built-in email provider is capped at **~2 emails/hour for the whole project** — not enough for real signups. The app can instead send through **any SMTP relay** (Brevo, Gmail, SMTP2GO, MailerSend, …), which reaches **any email address with no domain** and no per-hour cap:

1. **Brevo (recommended):** free **300 emails/day**, no credit card. Sign up at **https://brevo.com** → Senders & IPs → verify a sender email (no domain needed) → SMTP & API → copy the **SMTP key**.
2. Put it in `.env.local` and restart `npm run dev`:
   ```
   SMTP_HOST="smtp-relay.brevo.com"
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER="<your brevo login email>"
   SMTP_PASS="<your SMTP key>"
   SMTP_FROM="Vertex <you@example.com>"   # must be a verified sender
   ```
   (Gmail alternative: `SMTP_HOST="smtp.gmail.com"`, `SMTP_PORT=465`, `SMTP_SECURE=true`, password = an **app password** from Google → Security → 2-Step Verification → App passwords. ~500 emails/day.)

The branded email includes **both the 6-digit code and a clickable confirmation link** pointing at the app wherever it runs (any port — no Supabase allowlist involved).

Fallbacks if SMTP is not configured or fails: Resend (only when `RESEND_FROM` is set — its default sender only reaches your own account email), then Supabase's built-in email (~2/hour, last resort).

```powershell
npm run dev
```

→ http://localhost:3000

## Docker

```bash
docker build -t vertex-next .
docker run -p 3000:3000 --env-file .env.local vertex-next
```

Multi-stage Dockerfile (Node 22, `output: "standalone"`). Env vars are injected
at runtime by the host (e.g. Coolify) — never baked into the image.

## Try

1. Upload `sample-docs/peham-handbook.txt` (📎)
2. Ask: `When are office hours?` → citations
3. Upload a screenshot of a doc page (`.png`/`.jpg`) → hosted Gemini OCR then ask
4. Optional: `What's the weather in Islamabad?` (bonus tool)

## Note on weather

`get_weather` is a **Week 3 tool demo** still available. The main product story for the CV is **docs + RAG + citations**, not weather.
