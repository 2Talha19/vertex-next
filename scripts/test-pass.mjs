/**
 * Functional + security test pass for Vertex (run against a live dev server).
 * Covers auth, refresh, chat, upload, ownership, and cross-user isolation.
 */
const BASE = process.env.BASE_URL || "http://localhost:3000";

let pass = 0;
let fail = 0;
const results = [];

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    results.push(`  ✅ ${name}`);
  } else {
    fail++;
    results.push(`  ❌ ${name} ${detail}`);
  }
}

async function makeUser(label) {
  const email = `demo.video.${label}@example.com`;
  const r1 = await fetch(`${BASE}/api/auth/send-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name: `Tester ${label}` }),
  });
  const d1 = await r1.json();
  if (!d1.ok || !d1.demoCode) throw new Error(`send-code failed for ${label}: ${JSON.stringify(d1)}`);
  const r2 = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code: d1.demoCode }),
  });
  const d2 = await r2.json();
  if (!d2.ok || !d2.token) throw new Error(`verify failed for ${label}`);
  return { email, token: d2.token, refreshToken: d2.refreshToken };
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function main() {
  console.log("== AUTH ==");
  const u1 = await makeUser("alpha");
  check("signup+verify returns access token", !!u1.token);
  check("signup+verify returns refresh token", !!u1.refreshToken);

  // refresh exchange
  const rr = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: u1.refreshToken }),
  });
  const rd = await rr.json();
  check("refresh returns 200 + new token", rr.status === 200 && !!rd.token && rd.token !== u1.token, `status=${rr.status}`);
  check("refresh rotates refresh token", !!rd.refreshToken && rd.refreshToken !== u1.refreshToken);
  const u1b = { ...u1, token: rd.token, refreshToken: rd.refreshToken };

  // invalid refresh token
  const bad = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: "garbage-token" }),
  });
  check("refresh with invalid token rejected (401)", bad.status === 401, `status=${bad.status}`);

  console.log("== SECURITY: no-token / bad-token ==");
  const noTokChat = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
  check("/api/chat without token → 401", noTokChat.status === 401, `status=${noTokChat.status}`);
  const noTokOwn = await fetch(`${BASE}/api/ownership`, { headers: {} });
  check("/api/ownership without token → 401", noTokOwn.status === 401, `status=${noTokOwn.status}`);
  const badTokChat = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer not-a-real-token" }, body: JSON.stringify({ message: "hi" }) });
  check("/api/chat with garbage token → 401", badTokChat.status === 401, `status=${badTokChat.status}`);
  const noTokUpload = await fetch(`${BASE}/api/upload`, { method: "POST" });
  check("/api/upload without token → 401", noTokUpload.status === 401, `status=${noTokUpload.status}`);
  const noMsg = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", ...auth(u1.token) }, body: JSON.stringify({}) });
  check("/api/chat with empty message → 400", noMsg.status === 400, `status=${noMsg.status}`);

  console.log("== CHAT ==");
  const chat1 = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(u1b.token) },
    body: JSON.stringify({ message: "What is the capital of France?", history: [] }),
  });
  const chatText = await chat1.text();
  check("chat with valid token streams 200", chat1.status === 200 && chatText.includes("Paris"), `status=${chat1.status}`);

  console.log("== UPLOAD ==");
  // valid .txt upload
  const form = new FormData();
  form.append("file", new Blob(["Office hours are 10am to 4pm on weekdays. The handbook says leave requests need manager approval."], { type: "text/plain" }), "test-handbook.txt");
  const up = await fetch(`${BASE}/api/upload`, { method: "POST", headers: auth(u1b.token), body: form });
  const upText = await up.text();
  check("txt upload succeeds (done event)", upText.includes('"type":"done"') && upText.includes("test-handbook"), "");
  check("upload reports chunk count", upText.includes('"chunks":'));

  // server-side type rejection (client bypass)
  const badForm = new FormData();
  badForm.append("file", new Blob(["MZ executable fake"], { type: "application/x-msdownload" }), "evil.exe");
  const badUp = await fetch(`${BASE}/api/upload`, { method: "POST", headers: auth(u1b.token), body: badForm });
  const badUpText = await badUp.text();
  check("upload rejects .exe server-side", badUpText.includes("Unsupported file type"), "");

  // ownership lists own doc
  const own = await fetch(`${BASE}/api/ownership`, { headers: auth(u1b.token) });
  const ownData = await own.json();
  const myDoc = (ownData.myDocuments || []).find((d) => d.source.includes("test-handbook"));
  check("ownership lists own uploaded doc", !!myDoc, JSON.stringify(ownData).slice(0, 200));

  console.log("== CROSS-USER ISOLATION ==");
  const u2 = await makeUser("beta");
  // user B asks about a topic only in user A's doc — must NOT cite A's source
  const crossChat = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(u2.token) },
    body: JSON.stringify({ message: "When are office hours?", history: [], source: null }),
  });
  const crossText = await crossChat.text();
  check("user B's chat never returns user A's source", !crossText.includes("test-handbook"), crossText.slice(-200));

  // user B's ownership must not list A's docs
  const own2 = await fetch(`${BASE}/api/ownership`, { headers: auth(u2.token) });
  const own2Data = await own2.json();
  const leaked = (own2Data.myDocuments || []).find((d) => d.source.includes("test-handbook"));
  check("user B's ownership doesn't list user A's docs", !leaked, JSON.stringify(own2Data).slice(0, 200));

  // direct attempt: user B asks with A's source forced
  const forced = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(u2.token) },
    body: JSON.stringify({ message: "When are office hours?", history: [], source: `u_${u1.id || "x"}__test-handbook.txt` }),
  });
  const forcedText = await forced.text();
  check("forced foreign source gets re-scoped (no A docs leaked)", !forcedText.includes("Office hours are 10am"), forcedText.slice(-200));

  console.log("\n===================================");
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  console.log(results.join("\n"));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("TEST RUNNER ERROR:", e.message);
  process.exit(2);
});
