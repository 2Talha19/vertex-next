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
Supabase emails a confirmation link pointing at the project's configured **Site URL** (default `http://localhost:3000`). The app now **runs on port 3000** (`npm run dev`) and serves the `/auth/confirm` handler, so the link works. When you deploy, set **Supabase → Authentication → URL Configuration → Site URL / Redirect URLs** to your real domain (e.g. `https://your-app.com` and `https://your-app.com/auth/confirm`).

### Email sending: add a free Resend key (recommended)
The Supabase built-in email provider is capped at **~2 emails/hour**. Add one key to lift it:

1. Create a free account at **https://resend.com** (any email works)
2. Sidebar → **API Keys** → **Create API Key** → copy it
3. Put it in `.env.local` as `RESEND_API_KEY=re_...` and restart `npm run dev`

The app then emails codes through **Resend's API (100/day free)** with a branded template — no Supabase dashboard changes. Without the key it falls back to Supabase's built-in email (~2/hour).

Notes:
- The default sender `onboarding@resend.dev` only delivers to **your own Resend account email** — fine for testing. To send to other people, verify a domain in Resend (free, add DNS records) and set `RESEND_FROM="Vertex <noreply@yourdomain.com>"`.
- Alternative SMTP providers (dashboard setup): SMTP2GO 200/day · Brevo 300/day.

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
