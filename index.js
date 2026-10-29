'use strict';

// VibeFix sign-up check: proves which repo it runs in with GitHub's OIDC token
// (no API key), starts the free check of the repo's own live app, waits for it,
// and posts one comment that it keeps up to date. No dependencies.

const fs = require('node:fs');

const API = process.env.VIBEFIX_API || 'https://check.vibe-fixer.com';
const AUDIENCE = 'vibe-fixer.com';
const MARK = '<!-- vibefix-signup-check -->';
const POLL_MS = 30000;
const MAX_WAIT_MS = 20 * 60 * 1000;

const input = (name, fallback = '') => String(process.env[`INPUT_${name.toUpperCase()}`] || fallback).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);
const notice = (m) => console.log(`::notice title=VibeFix::${String(m).replace(/\r?\n/g, ' ')}`);
const warn = (m) => console.log(`::warning title=VibeFix::${String(m).replace(/\r?\n/g, ' ')}`);

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value == null ? '' : value).replace(/\r?\n/g, ' ')}\n`);
}
function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
}

async function idToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('This step needs `permissions: id-token: write` in the workflow, so it can prove which repo it runs in.');
  const res = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, { headers: { authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new Error(`GitHub did not issue an OIDC token (${res.status}).`);
  return (await res.json()).value;
}

async function vibefix(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${await idToken()}`, 'content-type': 'application/json', 'user-agent': 'vibefix-signup-check' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function gh(method, path, body) {
  const token = input('github-token');
  const res = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'vibefix-signup-check' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`GitHub ${method} ${path}: ${res.status}`), { status: res.status });
  return res.status === 204 ? null : res.json();
}

// One comment per pull request, edited in place; a commit comment when there is no PR.
async function postComment(event, sha, body) {
  const repo = process.env.GITHUB_REPOSITORY;
  let pr = event.pull_request && event.pull_request.number;
  if (!pr && sha) {
    const prs = await gh('GET', `/repos/${repo}/commits/${sha}/pulls`).catch(() => []);
    const open = (prs || []).find((p) => p.state === 'open');
    pr = open && open.number;
  }
  if (pr) {
    const comments = await gh('GET', `/repos/${repo}/issues/${pr}/comments?per_page=100`).catch(() => []);
    const mine = (comments || []).find((c) => String(c.body || '').includes(MARK));
    if (mine) return gh('PATCH', `/repos/${repo}/issues/comments/${mine.id}`, { body });
    return gh('POST', `/repos/${repo}/issues/${pr}/comments`, { body });
  }
  if (sha) return gh('POST', `/repos/${repo}/commits/${sha}/comments`, { body });
  return null;
}

async function main() {
  let event = {};
  try { event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { event = {}; }
  const ds = event.deployment_status || null;
  if (ds && ds.state && ds.state !== 'success') return notice(`Deployment is "${ds.state}", not checked.`);
  const url = input('url') || (ds && (ds.environment_url || ds.target_url)) || '';
  if (!url) throw new Error('Set `url:` to the public address of your live app (or run this on a deployment_status event).');
  const sha = (event.deployment && event.deployment.sha) || (event.pull_request && event.pull_request.head && event.pull_request.head.sha) || process.env.GITHUB_SHA || '';

  await idToken(); // a workflow without id-token: write is set up wrong: that one fails the step
  log(`Checking ${url} like a brand-new user (usually a few minutes, up to 20)...`);
  // A limit, a refusal or our service being down is not your build's fault: say why and pass.
  const start = await vibefix('POST', '/action/checks', { url, sha }).catch((e) => ({ status: 0, data: { error: e.message } }));
  if (start.status !== 201 || !start.data.id) {
    const why = [400, 403, 429].includes(start.status) && start.data.error ? start.data.error : 'VibeFix could not run the check this time. Not checked.';
    warn(why);
    summary(`### VibeFix sign-up check\n\n${why}`);
    return setOutput('signup', 'unknown');
  }

  const began = Date.now();
  let out = null;
  while (Date.now() - began < MAX_WAIT_MS) {
    await sleep(POLL_MS);
    const r = await vibefix('GET', `/action/checks/${start.data.id}`).catch((e) => ({ status: 0, data: { error: e.message } }));
    if (r.status === 200 && (r.data.status === 'done' || r.data.status === 'failed')) { out = r.data; break; }
    if (r.status && r.status !== 200) warn(r.data.error || `VibeFix answered ${r.status}; still waiting.`);
  }
  if (!out) {
    warn('The check took longer than 20 minutes. The result will still appear on the result page.');
    return setOutput('signup', 'unknown');
  }

  setOutput('signup', out.signup);
  setOutput('problem-count', out.problem_count == null ? '' : out.problem_count);
  setOutput('result-url', out.result_url);
  summary(out.body);
  log(out.body.replace(MARK, '').trim());
  if (input('comment', 'true') !== 'false') {
    try { await postComment(event, sha, out.body); } catch (e) {
      warn(`Could not post the comment (${e.status || e.message}). Give the job \`permissions: pull-requests: write\` (commit comments need \`contents: read\`).`);
    }
  }
  if (input('fail-on-broken', 'false') === 'true' && out.signup === 'no') {
    console.log('::error title=VibeFix::A new user cannot sign up to your live app.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.log(`::error title=VibeFix::${String(e.message).replace(/\r?\n/g, ' ')}`);
  process.exitCode = 1;
});
