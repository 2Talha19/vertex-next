// One-command Vercel deploy: reads VERCEL_TOKEN from .env.local, ensures env
// vars are set on the project, creates a production deployment from the GitHub
// repo, polls until ready, and prints the live URL.
//
// Usage:  node scripts/deploy-vercel.mjs
// Requires: VERCEL_TOKEN in .env.local (create at https://vercel.com/account/tokens)
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env.local');
const projPath = resolve(root, '.vercel', 'project.json');

// ---------- config ----------
const ENV_VARS_TO_SET = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'GEMINI_API_KEY',
  'JINA_API_KEY',
  'RESEND_API_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_SECURE',
  'SMTP_FROM',
  'DEMO_OTP_PREFIX',
];
const GITHUB_ORG = '2Talha19';
const GITHUB_REPO = 'vertex-next';
const BRANCH = 'main';

// ---------- helpers ----------
function loadToken() {
  if (!existsSync(envPath)) throw new Error('.env.local not found');
  const m = readFileSync(envPath, 'utf8').match(/^VERCEL_TOKEN="?([^"\n]+)"?/m);
  if (!m) throw new Error('VERCEL_TOKEN not found in .env.local');
  return m[1];
}
function loadProject() {
  if (!existsSync(projPath)) throw new Error('.vercel/project.json not found — link the project first');
  return JSON.parse(readFileSync(projPath, 'utf8'));
}
function loadLocalEnv() {
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}
async function api(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.vercel.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.error?.code || res.statusText;
    throw new Error(`Vercel API ${res.status} on ${method} ${path}: ${msg}`);
  }
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- main ----------
async function main() {
  const token = loadToken();
  const { projectId, orgId } = loadProject();
  const local = loadLocalEnv();
  const qs = `teamId=${orgId}`;

  console.log('1) Verifying token...');
  await api(token, `/v9/projects/${projectId}?${qs}`);
  console.log('   token OK');

  console.log('2) Setting env vars (production + preview)...');
  const existing = await api(token, `/v9/projects/${projectId}/env?${qs}`);
  const have = new Set((existing.envs || []).map((e) => e.key));
  for (const key of ENV_VARS_TO_SET) {
    if (!(key in local)) continue;
    const targets = ['production', 'preview', 'development'];
    await api(token, `/v10/projects/${projectId}/env?${qs}`, {
      method: 'POST',
      body: { key, value: local[key], type: 'encrypted', target: targets },
    });
    console.log(`   set ${key}`);
  }
  console.log('   env vars OK');

  console.log(`3) Creating production deployment from ${GITHUB_ORG}/${GITHUB_REPO}@${BRANCH}...`);
  const dep = await api(token, `/v13/deployments?${qs}`, {
    method: 'POST',
    body: {
      name: GITHUB_REPO,
      project: GITHUB_REPO,
      target: 'production',
      gitSource: { type: 'github', org: GITHUB_ORG, repo: GITHUB_REPO, ref: BRANCH },
    },
  });
  const depId = dep.id;
  console.log(`   deployment ${depId} created`);

  console.log('4) Waiting for build to finish...');
  let state = '';
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const info = await api(token, `/v13/deployments/${depId}?${qs}`);
    state = info.status || info.readyState;
    console.log(`   [${String(i + 1).padStart(2)}] status: ${state}`);
    if (state === 'READY') break;
    if (state === 'ERROR' || state === 'CANCELED' || info.error) {
      console.error('   BUILD FAILED:', JSON.stringify(info.error || info, null, 2));
      process.exit(1);
    }
  }
  if (state !== 'READY') {
    console.error('   Timed out waiting for build. Check the Vercel dashboard for build logs.');
    process.exit(1);
  }

  const url = dep.alias?.[0] || `https://${dep.url}`;
  console.log('\n✅ DEPLOYED!');
  console.log(`   Production URL: ${url}`);
  console.log(`   (verify: curl -s -o /dev/null -w "%{http_code}" ${url})`);
  console.log('\nNext: add this URL to Supabase → Authentication → URL Configuration → Site URL + Redirect URLs.');
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
