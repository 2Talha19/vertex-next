# Demo Walkthrough — Ask Peham's Docs (3–5 min)

## Before you record (10 min prep — do NOT skip)

1. **Open the live app** at your Vercel URL (e.g. `https://vertex-next-2talha19.vercel.app`). If it's not reachable, use `npm run dev` locally on `http://localhost:3000`.
2. **Sign in** with your real account (don't show signup on camera — it eats time).
3. **Upload a sample doc first** (e.g. `sample-docs/peham-handbook.txt`) so the first question answers instantly — no waiting for upload mid-recording.
4. **Have a second file ready** (a PDF and a screenshot/photo of a doc page) for the image/PDF segment.
5. **Warm the app** — ask one throwaway question and let it finish, so the first real question is fast.
6. **Close extra tabs.** Mute notifications. Screen at 1080p or 720p.

**Record with:** Windows Game Bar (`Win + G`) · OBS · or Loom (free, auto-uploads).

## The script (aim: 4 min)

### 0:00–0:25 — Intro
**Say:** *"Hi — this is Vertex, an internal-docs Q&A assistant for Peham. You upload your documents, and then you can ask questions in plain English and get answers with citations back to the exact source. Let me show you."*

### 0:25–1:00 — Upload flow (show the pipeline works)
- Click **📎 upload** → pick the **PDF** (or second doc) → point at the live progress: *"See — it reads the file, splits it into chunks, embeds them as vectors, and saves to our database."*
- Wait for the green "uploaded" confirmation.

**Say:** *"That's the ingest pipeline: extract text → chunk → embed → store. All of it happens with live progress so you know it's working."*

### 1:00–2:30 — The money shot: cited answer
- Ask: **"What are the office hours?"** (or a question that's clearly answered in the doc).
- Point at the **streaming** response: *"The answer streams in token by token, and notice it's grounded in the document — not a made-up answer."*
- After it finishes, **click one of the citation buttons** `[1]` / `[2]` and show the source chunk it jumps to.
- **Say:** *"Every claim carries a citation. You click it and see the exact chunk it came from — that's the difference between a chatbot and a trustworthy document assistant."*

### 2:30–3:10 — Follow-up + image OCR
- Ask a **follow-up**: *"and what about private notes?"* → *"Short follow-ups work too — the system expands them using our previous question, so you don't have to re-type everything."*
- **Upload a screenshot/photo** of a doc page → *"This is a scanned page — regular search can't read it. Our OCR pipeline turns it into text, so you can ask about it like any document."* → ask one question about it.

### 3:10–3:40 — The agent layer (30 seconds, optional but impressive)
- Ask: **"What's the weather in Islamabad?"** → *"This goes through a different specialist agent with a real tool call — it fetches live weather. The app routes each message to the right specialist: docs, weather, or casual chat."*

### 3:40–4:00 — Wrap-up
**Say:** *"Under the hood it's retrieval-augmented generation: Jina embeddings, pgvector similarity search in Supabase, a Groq LLM, and a multi-agent router. It's deployed on Vercel — live right now — and also containerized with Docker. That's Vertex: upload, ask, get cited answers."*

## Cut list (what to skip on camera)
- ❌ Sign-up/verification email flows (slow) — mention auth exists, don't demo it
- ❌ Forgot-password / reset (mention, don't demo)
- ❌ Cold starts or any waiting — warm the app first; if a request stalls >5s, cut and say *"let me try that again"* (never record silence)
- ❌ Your `.env.local` file, console logs, or code — the demo is the product, not the repo

## Pro tips
- Have the doc open in another window so you can *show* the citation matches the real text.
- If recording with OBS, add a simple "Vertex — Ask Peham's Docs" title card for the first 2 seconds.
- One take is fine — don't chase perfection. Natural > polished.
