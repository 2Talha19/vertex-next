// One-off helper: create a VERIFIED demo account directly via the Supabase
// admin API (email_confirm: true), so no verification email is ever sent.
// Run: node scripts/make-demo-user.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

function loadEnv(file) {
  const out = {};
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv(path.join(process.cwd(), ".env.local"));
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const EMAIL = "demo.vertex@peham.ai";
const PASSWORD = "VertexDemo123!";
const NAME = "Demo User";

const sb = createClient(url, key);

// Check if the user already exists.
const { data: existing } = await sb.auth.admin.listUsers({ perPage: 1000 });
const found = existing?.users?.find(
  (u) => u.email?.toLowerCase() === EMAIL.toLowerCase()
);
if (found) {
  // Ensure confirmed + password set.
  await sb.auth.admin.updateUserById(found.id, {
    email_confirm: true,
    password: PASSWORD,
    user_metadata: { name: NAME },
  });
  console.log("User exists — updated to confirmed. email:", EMAIL);
} else {
  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: NAME },
  });
  if (error) {
    console.error("Create failed:", error.message);
    process.exit(1);
  }
  console.log("Created verified demo user:", data.user?.email);
}

console.log("Credentials: ", EMAIL, "/", PASSWORD);
