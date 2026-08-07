// Pre-compiles the Next.js dev routes so the first real user request
// doesn't pay the ~10-16s webpack compile. Run right after `npm run dev`.
// Usage: node scripts/warm.js [baseUrl]   (default http://localhost:3000)
const base = process.argv[2] || process.env.VERTEX_URL || "http://localhost:3000";

async function hit(path, init) {
  try {
    const t = Date.now();
    const res = await fetch(base + path, init);
    console.log(`${path} -> ${res.status} in ${Date.now() - t}ms`);
  } catch (e) {
    console.log(`${path} -> FAILED: ${e.message}`);
  }
}

(async () => {
  console.log(`Warming ${base} ...`);
  await hit("/");
  await hit("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "hi",
      source: null,
      sources: [],
      history: [],
    }),
  });
  await hit("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "warmup@local.invalid", password: "x" }),
  });
  await hit("/api/upload", {
    method: "POST",
    body: new FormData(),
  });
  console.log("Warm-up done.");
})();
