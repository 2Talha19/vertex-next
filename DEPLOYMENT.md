# Deployment Runbook — Vertex (Docker → Coolify on Oracle Cloud Free Tier)

**Goal:** get `2Talha19/vertex-next` live on the internet at **$0/month**, deployed through
Coolify from the Docker image we build, matching the syllabus's "Docker→Coolify" requirement.

**Cost:** $0 (Oracle "Always Free" tier). The card asked at signup is identity verification
only — free-tier resources are never billed.

**Prereqs (already done):**
- Repo pushed to GitHub: `https://github.com/2Talha19/vertex-next` (branch `main`)
- Dockerfile + `.dockerignore` committed (3-stage build, non-root, healthcheck, port 3000)
- Env values live in local `vertex-next/.env.local` — paste them into Coolify, never commit them

---

## Step 1 — Create the Oracle Cloud account (~10 min)

1. Go to **https://www.oracle.com/cloud/** → click **Start for free**.
2. Fill in: name, email (use a real one — they send a verification code), **country**
   (use your actual country for the account).
3. Choose a **home region**. ⚠️ This CANNOT be changed later. Pick one likely to have free
   ARM capacity. Good options for South Asia / Middle East: **Mumbai, Hyderabad, Singapore,
   Dubai, Jeddah**. (If "out of capacity" during VM creation, we pick a different shape or
   region — only home region is locked, instances can be moved conceptually by re-creating.)
4. Add a **payment method** (debit/credit card). Oracle temporarily holds ~$1 then releases
   it. You will NOT be billed while staying inside the Always Free limits.
5. Verify email → sign in to the **Oracle Cloud Console**.

> Success check: you land on the console home page with "Tenancy" info and your name.

## Step 2 — Create the VM ("compute instance") (~10 min)

1. In the console: menu (☰ top-left) → **Compute → Instances → Create instance**.
2. **Name:** `vertex-server` (anything clear).
3. **Placement:** keep defaults (it will auto-pick an availability domain).
4. **Image:** click **Change image** → choose **Canonical Ubuntu 24.04** (the ARM build).
5. **Shape:** click **Change shape** → **Specialty and legacy** tab → choose **Ampere
   (A1) → VM.Standard.A1.Flex**. Set **OCPU count: 4** and **Memory: 24 GB** (that's the
   free maximum). If it says "out of capacity", try a different availability domain or a
   neighboring region's shape later.
6. **Networking:** keep the default VCN + subnet (it's already on the free tier).
7. **Add SSH keys:** choose **"Generate a key pair for me"** → Oracle downloads
   `ssh-key-...pem`. **Save it somewhere safe** (e.g. `C:\Users\HP\Downloads\vertex-key.pem`).
   You need this file to log in — treat it like a password.
8. **Boot volume:** keep defaults (default 50 GB is fine; free tier gives 200 GB total).
9. Click **Create**. Wait until status = **Running** (1–3 min).
10. Note the **Public IP address** (top of the instance page, e.g. `141.144.31.52`).

### Open the firewall ports (important!)
Coolify + your app need web traffic. Oracle's default security list only allows SSH (22).

1. Menu → **Networking → Virtual cloud networks** → click your VCN → click the
   **Default Security List** → **Add Ingress Rules**.
2. Add these rules (Source CIDR `0.0.0.0/0` for all, protocol TCP):
   | Port | Purpose |
   |---|---|
   | 22 | SSH (usually already there — skip if present) |
   | 80 | HTTP (Coolify proxy / app) |
   | 443 | HTTPS (SSL later) |
   | 8000 | Coolify dashboard |
   | 3000 | The Vertex app itself (direct access during setup) |
3. Click **Add Ingress Rules** to save each.

> Success check: instance shows **Running**, has a Public IP, and you have the `.pem` key file.

## Step 3 — SSH into the server (Windows)

Open **PowerShell** (Start → type `powershell`). Then:

```powershell
ssh -i C:\Users\HP\Downloads\vertex-key.pem ubuntu@YOUR_PUBLIC_IP
```

- `ubuntu` is the default user on Oracle Ubuntu images.
- First connect: type `yes` when asked about the fingerprint.
- If Windows complains the key file is "too open", fix with:
  `icacls C:\Users\HP\Downloads\vertex-key.pem /inheritance:r /grant:r "$($env:USERNAME):R"`

> Success check: your prompt changes to something like `ubuntu@vertex-server:~$`.

## Step 4 — Install Coolify (~10 min)

Run this one command (it's the official installer):

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

- It may ask a couple of questions (domain for Coolify UI, email) — press Enter to accept
  defaults. Say **no** to anything about "Do you want to install an agent" (Coolify can use
  the local Docker).
- Wait for it to finish (~5–10 min).

> Success check: open **http://YOUR_PUBLIC_IP:8000** in your browser → you see the Coolify
> setup screen.

## Step 5 — Coolify first-run setup

1. Create the **admin account** (email + password) on the screen.
2. Accept the defaults on the next screens ("Let's get started" → keep localhost/instance).
3. You land on the **Coolify dashboard**.

## Step 6 — Connect GitHub + add the project

1. **Sources** (left menu) → **+ Add** → **GitHub App** → follow the OAuth flow to connect
   your GitHub account (it creates a GitHub App with repo permissions for
   `2Talha19/vertex-next`).
2. **Projects** → **+ Add** → **Public Repository** (or pick the repo from your GitHub source):
   - Repository: `https://github.com/2Talha19/vertex-next`
   - Build Pack: **Dockerfile** (Coolify auto-detects it)
   - **Ports Exposes:** `3000`
   - **Ports Mappings:** `3000:3000` (or leave to Coolify's proxy)
3. Save the resource.

## Step 7 — Environment variables (paste values from your `.env.local`)

Open the resource → **Environment Variables** → add:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GROQ_API_KEY=
RESEND_API_KEY=
GEMINI_API_KEY=
```

Optional (if you use them locally): `JINA_API_KEY`, `HF_TOKEN`, `GROQ_OCR_MODEL`, etc.
⚠️ These values come from your local `.env.local` — paste them directly into Coolify,
**never** paste secrets in chat or commit them.

## Step 8 — Deploy

1. Click **Deploy** → watch the build log.
2. First build downloads Node 22 + `npm ci` + `next build` on the server (~5–10 min).
3. When the log ends with the container running and "healthy", open:

   **http://YOUR_PUBLIC_IP:3000** → you should see the Vertex sign-in screen 🎉

> Tip: Coolify shows a "URL" field under the resource — you can use
> `http://YOUR_PUBLIC_IP:3000` there or a real domain later.

## Step 9 — Fix Supabase email links (the localhost bug, for real this time)

The verification/confirmation emails contain a link to your app URL. Right now Supabase is
configured for `localhost:3000`, so real users would hit a dead link.

1. **Supabase Dashboard → Authentication → URL Configuration.**
2. **Site URL:** your deployed URL, e.g. `http://YOUR_PUBLIC_IP:3000`.
3. **Redirect URLs:** add the same URL (plus `/auth/callback` and `/auth/confirm` if used).
4. If using a plain `http://IP` URL, enable **"Allow insecure URLs"** in the same settings
   page (Supabase blocks non-HTTPS redirects otherwise). For production polish, instead set
   up a **domain + SSL** via Coolify (Domains section → Let's Encrypt) and use the
   `https://` URL — then you can turn "Allow insecure URLs" off.
5. Save → test: sign up with a fresh email → click the link in the email → it opens your
   deployed app, verified. ✅

## Troubleshooting

- **"Out of capacity"** when creating the A1 shape → retry a different availability domain,
  or pick the `VM.Standard.E2.1.Micro` (free, but only 1 GB RAM — fine for Coolify UI but
  slow for building Next.js; use it only if ARM is unavailable).
- **Port 8000/3000 unreachable** → check the Security List ingress rules (Step 2) — 90% of
  connection issues are this.
- **Build fails in Coolify** → open the deployment logs; common causes: a missing env var
  read at build time (our `getSupabase()` is lazy, so build should pass without env), or
  Docker build OOM on a 1 GB instance (switch to ARM).
- **Server feels slow** → free ARM is 4 OCPU; the Next.js build is the heavy moment, runtime
  is light.

## Fallback (if Oracle gives you trouble)

Oracle signup/capacity can be finicky. If it blocks you, deploy on **Vercel** instead
(10 minutes, $0, always-on): import the repo at vercel.com → add the same env vars → deploy
→ same Step 9 Supabase URL fix. The Docker/Coolify story remains documented here and in
CAPSTONE.md.
