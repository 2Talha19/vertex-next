// Render the recorded demo into a final MP4.
//
// Default (voiced): reads docs/demo/timing.json + docs/demo/narration.json,
// synthesizes each sentence with edge-tts (project venv, no API key), places
// every MP3 at its exact second, and muxes it over the video.
//   Run: node scripts/mux-demo-narration.mjs
//
// --silent: no narration, no audio track — just the clean screen recording
// with a fade in/out.
//   Run: node scripts/mux-demo-narration.mjs --silent
//
// Outputs: docs/demo/vertex-demo-voiced.mp4 (voiced) or
//          docs/demo/vertex-demo.mp4 (silent).
import fs from "node:fs";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const ROOT = process.cwd();
const DEMO = path.join(ROOT, "docs", "demo");
const TIMING = path.join(DEMO, "timing.json");
const NARRATION = path.join(DEMO, "narration.json");
const RAW_VIDEO = path.join(DEMO, "recording.webm");
const TTS_DIR = path.join(DEMO, "narration-mp3");
const VOICE = "en-US-AndrewMultilingualNeural";
const EDGE_TTS = path.join(ROOT, ".venv-tts", "Scripts", "edge-tts.exe");

const silent = process.argv.includes("--silent");
const OUT = path.join(DEMO, silent ? "vertex-demo.mp4" : "vertex-demo-voiced.mp4");

if (!fs.existsSync(TIMING)) {
  console.error(`Missing ${TIMING} — run scripts/record-demo.mjs first.`);
  process.exit(1);
}
if (!silent && !fs.existsSync(NARRATION)) {
  console.error(`Missing ${NARRATION}`);
  process.exit(1);
}

// ---- video duration (from the raw recording) ----
const probe = spawnSync(ffmpegPath, ["-i", RAW_VIDEO], { encoding: "utf8" }).stderr;
const m = probe.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
const videoDur = m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0;
console.log(`video: ${videoDur.toFixed(2)}s (${silent ? "silent" : "voiced"} mode)`);

// ---- end time: drop the dead tail the concat demuxer adds ----
const timing = JSON.parse(fs.readFileSync(TIMING, "utf8"));
const lastMark = Math.max(...Object.values(timing).map(Number));
const FADE_IN = 0.6;
const FADE_OUT = 0.8;
let endSec;
let args;
if (silent) {
  endSec = Math.min(videoDur, lastMark + 4);
  const vf = `fade=t=in:st=0:d=${FADE_IN},fade=t=out:st=${endSec - FADE_OUT}:d=${FADE_OUT}`;
  args = [
    "-y",
    "-i", RAW_VIDEO,
    "-vf", vf,
    "-t", endSec.toFixed(2),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-an",
    "-movflags", "+faststart",
    OUT,
  ];
} else {
  const narration = JSON.parse(fs.readFileSync(NARRATION, "utf8"));
  fs.mkdirSync(TTS_DIR, { recursive: true });

  // ---- 1. synthesize each narrated screen to MP3 (cached) ----
  const clips = [];
  for (const [screen, sentence] of Object.entries(narration)) {
    const atSec = timing[screen];
    if (atSec === undefined) {
      console.warn(`  skip "${screen}": no timing mark`);
      continue;
    }
    const mp3 = path.join(TTS_DIR, `${screen}.mp3`);
    if (!fs.existsSync(mp3) || fs.statSync(mp3).size < 500) {
      console.log(`  synth [${screen}] @ ${atSec}s`);
      const r = spawnSync(
        EDGE_TTS,
        ["--voice", VOICE, "--text", sentence, "--write-media", mp3],
        { encoding: "utf8", timeout: 60000 }
      );
      if (r.status !== 0 || !fs.existsSync(mp3)) {
        console.error(`  edge-tts failed for "${screen}": ${r.stderr || r.error}`);
        process.exit(1);
      }
    }
    clips.push({ screen, atSec, mp3 });
  }
  console.log(`synthesized ${clips.length} clips`);

  // ---- 2. build filter graph: adelay each clip, amix, then fades ----
  const inputs = ["-i", RAW_VIDEO];
  clips.forEach((c) => inputs.push("-i", c.mp3));

  const filters = [];
  clips.forEach((c, i) => {
    const ms = Math.round(c.atSec * 1000);
    filters.push(`[${i + 1}:a]aresample=44100,adelay=${ms}|${ms},apad[a${i}]`);
  });
  const mixInputs = clips.map((_, i) => `[a${i}]`).join("");
  filters.push(`${mixInputs}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,apad[aout]`);
  const lastEnd = Math.max(...clips.map((c) => c.atSec + 6));
  endSec = Math.min(videoDur, lastEnd + 2);
  const vf = `fade=t=in:st=0:d=${FADE_IN},fade=t=out:st=${endSec - FADE_OUT}:d=${FADE_OUT}`;

  args = [
    "-y",
    ...inputs,
    "-filter_complex", `${filters.join(";")};[0:v]${vf}[vout]`,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-t", endSec.toFixed(2),
    "-movflags", "+faststart",
    OUT,
  ];
}

console.log("rendering ->", OUT);
await new Promise((resolve, reject) => {
  const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  proc.stderr.on("data", (d) => (err += d.toString()));
  proc.on("close", (code) =>
    code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-600)}`))
  );
});
console.log(`done: ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB, ${endSec.toFixed(1)}s)`);
