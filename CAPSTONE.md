# Capstone — Ask Peham's Docs (on Vertex)

## Product
**Vertex** stays the app. Capstone mode = **Ask Peham's Docs**: upload Peham/internship docs → ask → answers with citations. OCR for images and (optional) scanned PDFs.

## Your choices (locked)
| Topic | Decision |
|--------|----------|
| App | Extend `vertex-next` (not a new repo) |
| Auth | **Done** — email-verified accounts via Supabase Auth OTP (name + email + password, emailed code, per-user chat history) |
| Coolify | Week 5 — new for you; we add Dockerfile first |
| Weather tool | Keep as optional bonus (`get_weather`) |
| OCR | Images via **hosted Gemini** (~2s, no local server); local Python Tesseract fallback; weak PDFs via Gemini |

## Week 4 plan
1. **Day 1 (this)** — Brand + OCR + sample docs  
2. **Day 2** — Stronger citations / docs UX polish  
3. **Day 3** — Seed more real Peham content; eval a few questions  
4. **Day 4–5** — Dockerfile + 1-pager draft  
5. **Later** — Coolify deploy → Support triage if time  

## Run
```powershell
cd C:\Users\HP\ai-internship\vertex-next
npm run dev
```
Open http://localhost:3000  
Upload `sample-docs/peham-handbook.txt` → ask: `When are office hours?`

## Docker (Coolify deploy path)
Multi-stage Dockerfile (`node:22-alpine`, npm ci → build → standalone runtime).
Built on Next's `output: "standalone"` (`.next/standalone/server.js`).

```bash
docker build -t vertex-next .
docker run -p 3000:3000 --env-file .env.local vertex-next
```

- Env is **runtime-injected** (Coolify env vars), never baked into the image
  (`.dockerignore` excludes `.env*`). No build-time env needed — `getSupabase()`
  and the API routes read `process.env` lazily at request time.
- Runs as non-root user `nextjs`, port 3000, healthcheck on `/`.
- ⚠️ The local Python OCR fallback (`scripts/ocr_server.py` + Tesseract) is
  **dev-only** — it's not in the image. The container needs `GEMINI_API_KEY`
  (or `GROQ_API_KEY`) set in env so the hosted vision OCR is used.
- One Windows dev-machine quirk: `next build` here nests the standalone output
  under `.next/standalone/ai-internship/vertex-next/` (node-file-trace path
  quirk); the Docker build runs on Linux where the layout is the standard flat
  `.next/standalone/server.js`.
- Next deploy step (Week 5): push repo → create app in **Coolify** → set env
  vars → build & deploy.

## Env
Same as before, plus optional:
```
GEMINI_API_KEY=   # image OCR (fast, hosted) + scanned PDF OCR
GEMINI_OCR_MODEL= # optional override (default gemini-2.5-flash)
GROQ_OCR_MODEL=   # Groq vision OCR override (default qwen/qwen3.6-27b)
HF_TOKEN=         # optional: enables Hugging Face Qwen2.5-VL OCR
HF_OCR_MODEL=     # override (default Qwen/Qwen2.5-VL-7B-Instruct)
```

### OCR cascade (images)
Gemini 2.5 Flash (verbatim transcription) → Groq qwen vision (reuses `GROQ_API_KEY`) →
Hugging Face Qwen2.5-VL (only if `HF_TOKEN` set) → local Python Tesseract/EasyOCR.
First engine that returns text wins; no local server needed when Gemini or Groq is set.

## Auth (Supabase email verification)
- `POST /api/auth/send-code` → emails a one-time code (Supabase OTP) and auto-detects the project's code length (6/8).
- `POST /api/auth/verify` → confirms the account; `POST /api/auth/login` → email + password sign-in (verified accounts only).
- `POST /api/auth/forgot` + `POST /api/auth/reset` → password reset: emailed code → verify + set new password.
- `POST /api/auth/verify-link` + pages at `/auth/confirm` (alias `/auth/callback`) → the emailed confirmation link works too (consumes `token_hash`, sets session, redirects into the app).
- Client: animated sign-in/sign-up screen, name + password confirm, 6/8-digit code boxes (paste + auto-verify), resend countdown, forgot-password + reset screens with success notice.
- Logo: four-point spark mark (blue→purple gradient tile).
- Email sending: **Resend API** via `lib/email.ts` — with `RESEND_API_KEY` set, codes are generated via `admin.generateLink` (plaintext OTP) and emailed through Resend (100/day free, branded template); without it, falls back to Supabase's built-in email (~2/hour). No Supabase dashboard changes needed.
