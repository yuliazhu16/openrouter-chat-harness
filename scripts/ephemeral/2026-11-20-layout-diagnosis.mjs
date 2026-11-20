#!/usr/bin/env node
// 2026-11-20 — Layout diagnosis for the "sidebar top-left, header pushed down, composer
// off-screen" report, by Switchboard 5.5 (Claude Opus 5.5)
//
// Context: yuliazhu saw the Phase 2 page broken in local Chrome; headless renders of the same
// files at 1280×800 were correct. Hypothesis: `just serve` (python http.server) sends no
// Cache-Control, only Last-Modified, so Chrome caches CSS/JS heuristically (≈10% of the file's
// age) and an ordinary reload revalidates only the HTML. Result: Phase 2 HTML + Phase 1 CSS/JS.
//
// Scenarios, each measured at 1440×900 (rects of sidebar / topbar / composer) + screenshot:
//   A. fresh profile, current site/                      → the intended render
//   B. Phase 1 site/ first (mtimes back-dated 7 days, as on the user's disk), then the files
//      are swapped for the current site/ and the page gets an ORDINARY reload — the user's path
//   C. same as B but with a hard reload (ignoreCache)    → should match A
//
// Usage: node scripts/ephemeral/2026-11-20-layout-diagnosis.mjs <scratch-dir>

import { execSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, utimesSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? '.');
const SERVE_DIR = join(OUT, 'served-site');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE_PORT = 8791;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backdate(dir, days) {
  const t = (Date.now() - days * 864e5) / 1000;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) backdate(p, days);
    utimesSync(p, t, t);
  }
}
function servePhase1() {
  rmSync(SERVE_DIR, { recursive: true, force: true });
  mkdirSync(SERVE_DIR, { recursive: true });
  execSync(`git archive f63924c site | tar -x -C ${JSON.stringify(SERVE_DIR)} --strip-components=1`);
  backdate(SERVE_DIR, 7);
}
function serveCurrent() {
  rmSync(SERVE_DIR, { recursive: true, force: true });
  cpSync('site', SERVE_DIR, { recursive: true }); // fresh mtimes = "just edited"
}

async function withChrome(profile, port, fn) {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(OUT, profile)}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 80 && !target; i += 1) {
      await sleep(200);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let seq = 0;
    const waiting = new Map();
    const fromCache = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); }
      if (m.method === 'Network.responseReceived' && /\.(css|js)$/.test(m.params.response.url)) {
        fromCache.push(`${m.params.response.url.replace(/.*localhost:\d+/, '')} ${m.params.response.fromDiskCache || m.params.response.fromMemoryCache ? 'CACHE' : 'network ' + m.params.response.status}`);
      }
    });
    const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
    await send('Network.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await fn({ send, evaluate, fromCache });
    ws.close();
  } finally {
    chrome.kill();
  }
}

const MEASURE = `(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const shellDisplay = getComputedStyle(document.querySelector('.shell') ?? document.body).display;
  return { shellDisplay, sidebar: r('#sidebar'), topbar: r('.topbar'), composer: r('#composer'), viewport: innerHeight,
           docHeight: document.documentElement.scrollHeight, hasNewChatHandler: typeof window !== 'undefined' };
})()`;

async function shot(send, name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  return join(OUT, name);
}

mkdirSync(OUT, { recursive: true });
serveCurrent();
const server = spawn('python3', ['-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1', '--directory', SERVE_DIR], { stdio: 'ignore' });
try {
  serveCurrent();
  await sleep(600);
  // A
  await withChrome('profile-A', 9341, async ({ send, evaluate }) => {
    await send('Page.navigate', { url: `http://localhost:${SITE_PORT}/` });
    await sleep(1500);
    console.log('A fresh      ', JSON.stringify(await evaluate(MEASURE)), shot && (await shot(send, 'diag-A-fresh-1440.png')));
  });
  // B and C
  for (const [label, ignoreCache] of [['B reload     ', false], ['C hard reload', true]]) {
    servePhase1();
    await withChrome(`profile-${label[0]}`, label[0] === 'B' ? 9342 : 9343, async ({ send, evaluate, fromCache }) => {
      await send('Page.navigate', { url: `http://localhost:${SITE_PORT}/` });
      await sleep(1500); // Phase 1 page loaded and cached
      serveCurrent(); // files change on disk, as when the user pulled / I committed Phase 2
      fromCache.length = 0;
      await send('Page.reload', { ignoreCache });
      await sleep(1800);
      console.log(label, JSON.stringify(await evaluate(MEASURE)), await shot(send, `diag-${label[0]}-1440.png`));
      console.log('   subresources:', fromCache.join(' | '));
    });
  }
} finally {
  server.kill();
}

// OUTCOME (2026-11-20, Switchboard 5.5): hypothesis confirmed.
//  A fresh profile: .shell grid; sidebar 0,0 256×900; topbar at y=0; composer bottom 900.
//  B ordinary reload after the files changed: .shell display:block (Phase 1 CSS); sidebar a
//    full-width 213px block at the top; topbar pushed to y=249; composer at y=1080 (below the
//    900px viewport); storage.js never requested (Phase 1 app.js). Exactly the reported layout.
//    (CDP labelled those responses "network 200"; the rendered content shows they were the old
//    files, so the content is the evidence, not the flag.)
//  C hard reload: identical to A.
//  Fixes: `just serve` → scripts/dev-server.py (Cache-Control: no-cache). Pages sends
//  max-age=600, so the same mix can happen just after a deploy → ADR-0001 QST-PAGES-CACHE.
