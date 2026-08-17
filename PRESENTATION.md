# Capstone Presentation + Live Q&A Prep — Ask Peham's Docs

This is the script for **Day 5: present to the team + live Q&A**. It pairs with `ONE-PAGER.md` (the written summary) and `DEMO-SCRIPT.md` (the 3–5 min recording). The demo is the proof; this is the story around it.

## Presentation outline (5–7 min total)

### 1. Hook (30 sec)
> *"Every team stores knowledge in scattered documents — handbooks, PDFs, scanned pages. Finding an answer means opening files and searching, and plain search can't read images at all. Vertex fixes that: upload anything, ask in plain English, get a cited answer."*

### 2. The problem & why it matters (1 min)
- Knowledge lives in many formats: text, PDF, screenshots, scanned pages
- Plain keyword search fails on images/scanned text
- Trust problem: a chatbot answer is useless without a source you can check

### 3. The solution (2 min) — walk the architecture, top to bottom
Draw or point at this pipeline (it's also in the one-pager):
```
Upload ─▶ extract text ─▶ chunk ─▶ embed (Jina) ─▶ Supabase pgvector
                                                          ▲
Ask ─▶ router ─▶ embed question ─▶ match_documents ─▶ top chunks ─▶ Groq LLM ─▶ cited answer (streamed)
```
Hit these beats:
- **Ingest:** text/PDF via `unpdf`, images/scanned pages via the OCR cascade (Gemini → Groq vision → HF → local)
- **Index:** 500-char overlapping chunks, Jina embeddings, stored in Supabase pgvector
- **Answer:** a multi-agent **router** sends each message to the right specialist (Docs / Weather / Chit-chat / General); the Docs specialist retrieves top chunks and the LLM writes a grounded answer with `[N]` citations that jump to the exact source
- **Auth:** email-verified accounts, forgot/reset, per-user chat history

### 4. The live demo (3–4 min)
Play the `DEMO-SCRIPT.md` recording — or do it live if time allows. Three must-show moments:
1. Upload a PDF + a screenshot → live ingest progress
2. Ask a question → streamed, **cited** answer → click a citation → see the source chunk
3. Ask "What's the weather in Islamabad?" → show the tool-call specialist

### 5. Deployment story (1 min)
- **Live now on Vercel** — free tier, always-on, no credit card
- **Also containerized**: Dockerfile (multi-stage, non-root, standalone build), image built and verified healthy locally
- **Honest deviation:** syllabus says Docker→Coolify; Coolify needs a server, and every free-server path (Oracle/Azure) needs a card or a working university mailbox. Chose **Vercel** (managed, $0, no fuss) + kept the full **Coolify runbook** in `DEPLOYMENT.md` as the upgrade path. Docker half is done and proven either way.

### 6. Close (30 sec)
> *"Retrieval-augmented generation with real citations, multi-agent routing, OCR for images, verified auth — deployed live. That's Vertex: upload, ask, get cited answers you can trust."*

---

## Live Q&A prep — likely questions, with answers

### Architecture & decisions
**Q: Why a multi-agent router instead of one big prompt?**
A: The router is pure rules (regex) — near-zero cost. It skips retrieval entirely for chit-chat, so casual messages answer fast and can't pollute retrieval with nonsense. Each specialist gets a tight system prompt (Docs = "cite only from context", Weather = "use the tool"), which measurably improved answer quality vs one giant prompt.

**Q: Why Jina embeddings? Why pgvector?**
A: Jina supports task-split embeddings — `retrieval.passage` for documents, `retrieval.query` for questions — which matches better than a single generic embedding. pgvector lives inside Supabase, so vectors sit in the same Postgres as the rest of the data: one database, one auth system, no extra infra. The `match_documents` RPC does cosine similarity with a threshold.

**Q: Why Groq for the LLM?**
A: Fast streaming (tokens appear word-by-word), a generous free tier, and OpenAI-compatible API. Latency matters for a chat demo — Groq's inference is the fastest free option I tested.

**Q: Why `unpdf` over `pdf-parse`?**
A: `pdf-parse` bundles pdf.js v1.10.100 from 2018, which breaks under Next.js's bundler — valid PDFs threw `bad XRef entry`. `unpdf` is the maintained Mozilla pdf.js and parses modern PDFs (including xref streams) correctly.

**Q: How does OCR work? What's the cascade?**
A: Images and scanned PDFs go through engines in order: Gemini 2.5 Flash (fast, verbatim) → Groq vision → optional Hugging Face Qwen2.5-VL → local Python. First engine that returns text wins, transcribed verbatim — hosted-first so there's no local server dependency.

**Q: How do citations actually work?**
A: Retrieval returns the top chunks; the prompt formats them as `[Source N | file]` blocks and instructs the model to cite `[N]` inline. The UI renders `[N]` as clickable pills that jump to the source card. And there's a guarantee: if the model forgets the markers, the backend appends a Sources footer so citations are never missing.

**Q: Why streaming? How is it built?**
A: The chat route returns NDJSON — one JSON event per line: `status` → `token`×N → `done` + citation rows. The UI reads the stream incrementally, so the answer appears token-by-token with a live elapsed-time indicator. There's also a 90s hard timeout so a hung request fails loudly instead of spinning forever.

### Deployment & the Coolify deviation (be ready — this is the one they'll ask)
**Q: The syllabus says Docker→Coolify. You deployed to Vercel. Why?**
A: Docker is done — the image builds and runs healthy. Coolify is free *software* but needs a server to run on, and every free-server route hit a wall: Oracle requires a credit card for identity verification; Azure for Students required a working university mailbox (our `students.fui.edu.pk` address doesn't have a real inbox behind it). I made a documented engineering tradeoff: **Vercel** (managed, $0, no card, always-on) for the live demo, with the full **Coolify runbook saved in `DEPLOYMENT.md`** — the moment a free server exists, the Docker image deploys to Coolify unchanged.

**Q: Why does Vercel matter vs just running locally?**
A: Localhost isn't a deployment — a demo needs a URL anyone can open. Vercel gives a real HTTPS URL, auto-deploys from GitHub on push, and its free tier fits this app (uploads ~4.5MB cap, personal-use license — both fine for an internship project).

**Q: What's the tradeoff of Vercel vs Coolify?**
A: Vercel builds Next.js itself rather than running my Docker image, so the Coolify story isn't exercised end-to-end yet. The Docker work isn't wasted — the image is proven, and Coolify (or any Docker host) consumes it directly. It's "swap the platform, keep the container."

### Auth & product
**Q: How is auth implemented?**
A: Supabase Auth with OTP email codes. Sign-up sends a verification code (delivered via Resend SMTP — 100/day free — instead of Supabase's throttled built-in provider), the user enters it, and only verified accounts can sign in. Plus forgot-password → reset-code → set-new-password, and per-user chat history.

**Q: What happened with the bounced-email warning from Supabase?**
A: During testing I sent OTP emails to fake `...@gmail.com` addresses, which hard-bounced and triggered Supabase's deliverability alert. All test users were deleted, and the project now holds only real accounts; moving email to Resend means bounces can't hit Supabase's provider reputation again. Lesson learned: never send auth test emails to fake addresses.

**Q: What's the difference between this and just ChatGPT?**
A: ChatGPT has no access to our documents — it would make things up. Vertex retrieves from *your* uploaded content and cites the exact chunk, so every claim is verifiable. Plus it reads images/scanned pages that a general chatbot can't use as context.

### Limits & honesty (they may probe)
**Q: What would you improve with more time?**
A: User-scoped document tables (multi-tenant isolation), an eval set of golden Q&As to measure retrieval quality, and the Coolify self-host deployment when a free server is available.

**Q: What are the known limits?**
A: Vercel's ~4.5MB upload cap; Groq free-tier rate limits; OCR quality depends on the source image; retrieval is as good as the embeddings and chunking — no reranker yet.

---

## Prep checklist
- [ ] Demo recording made (`DEMO-SCRIPT.md`) and plays offline
- [ ] Live URL verified reachable before the session (warm the app first — first request after cold start is slowest)
- [ ] One-pager printed/ready to share (`ONE-PAGER.md`)
- [ ] This Q&A skimmed — especially the **Coolify → Vercel** answer (most likely question)
- [ ] Logbook up to date (weeks 4–6 compiled)
