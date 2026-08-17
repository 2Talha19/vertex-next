// Record Vertex demo walkthrough videos using raw CDP screencast.
//
// Usage:
//   node scripts/record-demo.mjs --flow auth     (signup → verify → logout → login)
//   node scripts/record-demo.mjs --flow docs     (upload doc → cited answer → citation click)
//   node scripts/record-demo.mjs --flow ocr      (upload text image → OCR → ask about it)
//   node scripts/record-demo.mjs --flow weather  (live weather tool calls)
//   node scripts/record-demo.mjs --flow chat     (follow-ups, sidebar, theme, history)
//   node scripts/record-demo.mjs                 (default: docs)
//
// Outputs (per flow):
//   docs/demo/<flow>-recording.webm  — 1440x900, 25fps VP9
//   docs/demo/<flow>-timing.json     — { screen: seconds-from-start }
// Frames are captured via Page.startScreencast and written to disk with
// wall-clock times, then encoded with real-time pacing. A tiny 2px corner
// dot keeps Chrome emitting frames without being visible in the video.
//
// Render to MP4 afterwards:
//   node scripts/mux-demo-narration.mjs --flow <flow> --silent
import puppeteer from "puppeteer-core";
import ffmpegPath from "ffmpeg-static";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = "http://localhost:3000";
const EMAIL = "demo.vertex@peham.ai";
const PASSWORD = "VertexDemo123!";
const OUT_DIR = path.join(process.cwd(), "docs", "demo");
const FPS = 25;

const flow = (process.argv.indexOf("--flow") >= 0
  ? process.argv[process.argv.indexOf("--flow") + 1]
  : "docs") || "docs";

const FRAMES_DIR = path.join(OUT_DIR, `frames-${flow}`);
const VIDEO = path.join(OUT_DIR, `${flow}-recording.webm`);
const TIMING = path.join(OUT_DIR, `${flow}-timing.json`);

const marks = [];
let startMs = 0;
function mark(screen) {
  marks.push({ screen, atMs: Date.now() - startMs });
  console.log(`  mark: ${screen} @ ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function waitFor(page, selector, timeoutMs = 60000) {
  await page.waitForSelector(selector, { timeout: timeoutMs, visible: true });
}
async function waitGone(page, selector, timeoutMs = 60000) {
  await page.waitForSelector(selector, { timeout: timeoutMs, hidden: true });
}
async function typeInto(page, selector, text) {
  await waitFor(page, selector);
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, text, { delay: 30 });
}
async function login(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitFor(page, 'input[type="email"]');
  await typeInto(page, 'input[type="email"]', EMAIL);
  await typeInto(page, 'input[type="password"]', PASSWORD);
  await page.click(".auth-submit");
  await waitFor(page, ".input-row input", 60000);
  log("logged in");
}
async function ask(page, text, timeoutMs = 120000) {
  await typeInto(page, ".input-row input", text);
  await page.click(".send-btn");
  await page.waitForFunction(
    () => {
      const btn = document.querySelector(".send-btn");
      return btn && !btn.disabled;
    },
    { timeout: timeoutMs }
  );
  await sleep(900);
}
/** Wait until the in-flight upload finishes ("N chunks indexed"). */
async function waitUploadDone(page) {
  await page.waitForFunction(
    () => {
      const subs = [...document.querySelectorAll(".chat-attach-sub")];
      return subs.some((s) => /chunks indexed/.test(s.textContent || ""));
    },
    { timeout: 120000 }
  );
}

// ------------------------- flow definitions -------------------------
const flows = {
  auth: {
    // Starts at the login screen (fresh browser, no session).
    async prepare() {},
    async steps(ctx, page) {
      const email = `demo.video.${Date.now().toString(36)}@peham.ai`;
      const pw = "Vertex123!";

      // 1) Signup form (name + email + password + confirm)
      await waitFor(page, ".auth-tabs");
      const tabs = await page.$$(".auth-tabs button");
      await tabs[1].click(); // switch to signup
      await waitFor(page, 'input[placeholder="Your full name"]');
      await typeInto(page, 'input[placeholder="Your full name"]', "Ali Raza");
      await typeInto(page, 'input[type="email"]', email);
      await typeInto(page, 'input[placeholder="At least 6 characters"]', pw);
      await typeInto(page, 'input[placeholder="Repeat your password"]', pw);
      mark("signup-form");
      await sleep(1400);

      // 2) Submit → verification code screen
      // Capture the demo code from the /api/auth/send-code response.
      const codePromise = new Promise((resolve) => {
        const handler = async (res) => {
          try {
            if (res.url().includes("/api/auth/send-code") && res.status() === 200) {
              const j = await res.json();
              if (j.demoCode) resolve(j.demoCode);
            }
          } catch {}
        };
        page.on("response", handler);
        setTimeout(() => resolve(null), 20000);
      });
      await page.click(".auth-submit");
      await waitFor(page, ".code-box", 30000);
      mark("code-sent");
      await sleep(1600);
      ctx.demoCode = await codePromise;
      if (!ctx.demoCode) throw new Error("no demoCode returned (is DEMO_OTP_PREFIX set?)");

      // 3) Enter the code → verified → chat
      await page.evaluate((code) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", code);
        const box = document.querySelector(".code-box");
        box.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
        );
      }, ctx.demoCode);
      await waitFor(page, ".input-row input", 45000);
      mark("verified");
      await sleep(3000);

      // 4) Logout → login screen
      await page.click(".logout-btn");
      await waitFor(page, 'input[type="email"]', 30000);
      mark("logout");
      await sleep(1600);

      // 5) Login again with the same credentials
      await typeInto(page, 'input[type="email"]', email);
      await typeInto(page, 'input[type="password"]', pw);
      await page.click(".auth-submit");
      await waitFor(page, ".input-row input", 45000);
      mark("login");
      await sleep(3000);
    },
  },

  docs: {
    async prepare(ctx, page) {
      await login(page);
    },
    async steps(ctx, page) {
      const docPath = path.join(process.cwd(), "sample-docs", "vertex-demo-notes.txt");

      // 1) Welcome screen
      await sleep(2500);
      mark("welcome");

      // 2) Upload the sample doc (drag-drop equivalent via the file input)
      await waitFor(page, 'input[type="file"]');
      const input = await page.$('input[type="file"]');
      await input.uploadFile(docPath);
      await sleep(600);
      mark("upload");
      await waitUploadDone(page);
      mark("indexed");
      await sleep(1500);

      // 3) Ask → cited answer streams in
      await ask(page, "What tech stack does the project use?");
      mark("answer");
      await sleep(1500);

      // 4) Click a citation pill (jump-to-source)
      await waitFor(page, ".cite-link", 30000);
      await sleep(1200);
      await page.click(".cite-link");
      mark("citation");
      await sleep(3000);
    },
  },

  ocr: {
    async prepare(ctx, page) {
      await login(page);
    },
    async steps(ctx, page) {
      const imgPath = path.join(OUT_DIR, "ocr-sample.png");

      await sleep(2500);
      mark("welcome");

      // Upload the text image → OCR pipeline runs (Gemini → Groq → HF → local)
      await waitFor(page, 'input[type="file"]');
      const input = await page.$('input[type="file"]');
      await input.uploadFile(imgPath);
      await sleep(500);
      mark("ocr");
      await waitUploadDone(page);
      mark("indexed");
      await sleep(1500);

      await ask(page, "What does this image say?");
      mark("answer");
      await sleep(3000);
    },
  },

  weather: {
    async prepare(ctx, page) {
      await login(page);
    },
    async steps(ctx, page) {
      await sleep(2500);
      mark("welcome");

      await ask(page, "What's the weather in Islamabad?");
      mark("answer");
      await sleep(1500);

      await ask(page, "And what about Lahore?");
      mark("followup");
      await sleep(3000);
    },
  },

  chat: {
    async prepare(ctx, page) {
      await login(page);
    },
    async steps(ctx, page) {
      await sleep(2500);
      mark("welcome");

      // 1) Q + follow-up ("and private notes?") — follow-up expansion
      await ask(page, "When are office hours?");
      mark("answer");
      await sleep(1000);
      await ask(page, "and private notes?");
      mark("followup");
      await sleep(1500);

      // 2) Sidebar toggle (close → open)
      await page.click(".sidebar-toggle");
      await sleep(1200);
      await page.click(".sidebar-toggle");
      mark("sidebar");
      await sleep(1200);

      // 3) Theme toggle → light mode
      await page.click("#themeToggle");
      mark("theme");
      await sleep(1500);
      await page.click("#themeToggle");
      await sleep(1200);

      // 4) Open a previous conversation from history
      await waitFor(page, ".history-item", 10000);
      const activeIdx = await page.evaluate(() => {
        const items = [...document.querySelectorAll(".history-item")];
        return items.findIndex((n) => n.classList.contains("active"));
      });
      const items = await page.$$(".history-item");
      const idx = activeIdx === 0 ? items.length - 1 : 0;
      await items[idx].click();
      mark("history");
      await sleep(3000);
    },
  },
};

// ------------------------- recorder core -------------------------
async function main() {
  const def = flows[flow];
  if (!def) {
    console.error(`Unknown flow "${flow}". Choose from: ${Object.keys(flows).join(", ")}`);
    process.exit(1);
  }
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  for (const f of fs.readdirSync(FRAMES_DIR)) fs.unlinkSync(path.join(FRAMES_DIR, f));

  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--mute-audio",
      "--window-size=1440,900",
    ],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const client = await page.createCDPSession();
  await client.send("Page.enable");

  // Auth flow starts at the login screen; others log in first.
  if (flow === "auth") {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitFor(page, 'input[type="email"]');
  } else {
    await def.prepare({}, page);
  }

  // Tiny 2px corner dot keeps Chrome emitting screencast frames (only fires
  // on pixel changes) without visibly affecting the video.
  await page.evaluate(() => {
    const s = document.createElement("style");
    s.textContent = `
      @keyframes keepalive-pulse { 0%{background:#111} 100%{background:#eee} }
      #keepalive-dot {
        position: fixed; right: 0; bottom: 0;
        width: 2px; height: 2px; background: #111;
        animation: keepalive-pulse 0.3s linear infinite alternate;
      }
    `;
    document.head.appendChild(s);
    const dot = document.createElement("div");
    dot.id = "keepalive-dot";
    document.body.appendChild(dot);
  });

  // ---- start capturing ----
  startMs = Date.now();
  let frameSeq = 0;
  const frameLog = [];
  client.on("Page.screencastFrame", (e) => {
    const file = path.join(FRAMES_DIR, `frame-${String(frameSeq).padStart(5, "0")}.png`);
    frameSeq++;
    fs.writeFileSync(file, Buffer.from(e.data, "base64"));
    frameLog.push({ file, atMs: Date.now() });
    client.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
  });
  await client.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  log(`flow=${flow} capturing frames...`);

  const ctx = {};
  await def.steps(ctx, page);

  await client.send("Page.stopScreencast");
  log("capture stopped,", frameSeq, "frames");
  await browser.close();

  // ---- encode frames to a 25fps WebM with real-time pacing ----
  const t0 = frameLog[0]?.atMs ?? startMs;
  const listPath = path.join(FRAMES_DIR, "concat.txt");
  const lines = [];
  for (let i = 0; i < frameLog.length; i++) {
    const t = (frameLog[i].atMs - t0) / 1000;
    const tNext = i + 1 < frameLog.length ? (frameLog[i + 1].atMs - t0) / 1000 : t + 2.0;
    const dur = Math.max(0.05, tNext - t);
    lines.push(`file '${path.basename(frameLog[i].file)}'`, `duration ${dur.toFixed(3)}`);
  }
  lines.push(`file '${path.basename(frameLog[frameLog.length - 1].file)}'`);
  fs.writeFileSync(listPath, lines.join("\n"), "utf8");

  log("encoding", frameLog.length, "frames ->", VIDEO);
  await new Promise((resolve, reject) => {
    const enc = spawn(
      ffmpegPath,
      [
        "-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-vf", `fps=${FPS}`,
        "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-an", VIDEO,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let err = "";
    enc.stderr.on("data", (d) => (err += d.toString()));
    enc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-500)}`));
    });
  });
  log("encoded");

  const timing = {};
  const zero = marks[0]?.atMs ?? 0;
  for (const m of marks) timing[m.screen] = Number(((m.atMs - zero) / 1000).toFixed(2));
  fs.writeFileSync(TIMING, JSON.stringify(timing, null, 2));
  console.log("timing.json ->", JSON.stringify(timing));

  for (const f of fs.readdirSync(FRAMES_DIR)) fs.unlinkSync(path.join(FRAMES_DIR, f));
  fs.rmdirSync(FRAMES_DIR);

  const size = fs.statSync(VIDEO).size;
  console.log(`done: ${VIDEO} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
