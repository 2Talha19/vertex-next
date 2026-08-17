# Vertex — Ask Peham's Docs · Capstone One-Pager

**One line:** An internal-docs Q&A assistant that answers questions about uploaded Peham/internship documents with clickable citations — built on Retrieval-Augmented Generation (RAG).

## Problem
Teams store knowledge in scattered documents (handbooks, PDFs, policies, screenshots). Finding an answer means opening files and searching — and images/scanned pages are unreadable by plain search. Ask Peham's Docs solves this: **upload anything → ask in plain English → get a cited answer**.

## Solution
A Next.js web app with a full pipeline:

1. **Ingest** — upload `.txt`/`.md` (direct), PDFs (parsed with `unpdf`), or images/scanned pages (OCR: Gemini 2.5 Flash → Groq vision → Hugging Face → local Python; first engine that returns text wins, transcribed verbatim).
2. **Index** — text is split into 500-char overlapping chunks and embedded with **Jina AI** (`jina-embeddings-v3`, passage-task) into **Supabase + pgvector**.
3. **Answer** — a lightweight **multi-agent router** (`lib/router.ts`) classifies each message (Docs / Weather / Chit-chat / General), retrieves the most similar chunks via the `match_documents` RPC, and a **Groq LLM** writes a grounded answer with inline `[N]` citations. Clicking a citation jumps to the exact source chunk.
4. **Auth** — email-verified accounts (Supabase Auth OTP + Resend), sign-up/sign-in/forgot-reset, per-user chat history.

## Architecture (one picture)
```
Upload ─▶ extract text ─▶ chunk ─▶ embed (Jina) ─▶ Supabase pgvector
                                                          ▲
Ask ─▶ router ─▶ embed question ─▶ match_documents ─▶ top chunks ─▶ Groq LLM ─▶ cited answer (streamed)
```

## Key technical decisions
| Decision | Why |
|---|---|
| **Multi-agent router** | Rules-first classification skips retrieval for chit-chat — lower latency, fewer wrong answers |
| **Jina task-split embeddings** | `retrieval.passage` for documents, `retrieval.query` for questions — measurably better match quality |
| **OCR cascade, hosted-first** | Gemini gives ~2s verbatim OCR with no local server; local Python is the last-resort fallback |
| **Groq tool-call recovery** | Parses Groq's broken `failed_generation` XML so `get_weather` calls recover instead of crashing |
| **`unpdf` over `pdf-parse`** | Modern Mozilla pdf.js — parses valid PDFs the old parser rejected |
| **Citation guarantee** | If the model skips `[N]` markers, the agent appends a Sources line — citations are never missing |

## Results
- Answers carry **clickable citations** to source chunks; images and scanned PDFs are readable.
- **Deployed live on Vercel** (always-on, $0) + a **Docker image** built and verified healthy locally (Coolify runbook in `DEPLOYMENT.md`).
- Full auth: sign-up with email code verification, sign-in, forgot/reset, per-user history.

## Stack
Next.js 15 (TypeScript) · Supabase (Postgres + pgvector + Auth) · Groq (LLM) · Jina AI (embeddings) · Gemini / Resend (OCR / email) · Open-Meteo (weather tool) · Docker · Vercel.

## What's next
User-scoped document tables (multi-tenant), an eval set of golden Q&As, and Coolify self-host deployment when a free server is available.
