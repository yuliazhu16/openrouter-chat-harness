#!/usr/bin/env node
// 2026-11-20 — Render the exact page yuliazhu's Chrome assembles, by Switchboard 5.5 (Claude Opus 5.5)
//
// Context: second layout report ("must scroll the whole page to reach the input; input much
// too narrow; sidebar runs to the edges; excess whitespace") while every fresh render passed
// 48/48 geometry checks. Port 8000 was still the pre-fix `python3 -m http.server` (started
// 17:53, no Cache-Control), so Chrome keeps the Phase 1 styles.css/app.js it fetched then
// (heuristic freshness ≈ 16h) and pairs them with the CURRENT index.html on every ordinary reload.
//
// This serves that exact mix — current site/index.html + Phase 1 (f63924c) css/ and js/ — and
// the current site for comparison, seeds a long conversation, and prints computed geometry and
// overflow for both at 1440×900 and 390×844, plus screenshots.
//
// Usage: node scripts/ephemeral/2026-11-20-stale-mix-render.mjs <scratch-dir>

import { execSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? '.');
const MIX = join(OUT, 'mix-site');
mkdirSync(MIX, { recursive: true });
execSync(`git archive f63924c site/css site/js site/favicon.svg | tar -x -C ${JSON.stringify(MIX)} --strip-components=1`);
cpSync('site/index.html', join(MIX, 'index.html'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const servers = [
  spawn('python3', ['-m', 'http.server', '8795', '--bind', '127.0.0.1', '--directory', MIX], { stdio: 'ignore' }),
  spawn('python3', ['scripts/dev-server.py', '8796'], { stdio: 'ignore' }),
];
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9346', `--user-data-dir=${join(OUT, 'mix-profile')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

const MEASURE = `(() => {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(','); };
  const cs = (s, p) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; };
  return {
    'html scrollHeight (page scroll if > viewport)': document.documentElement.scrollHeight,
    'viewport': innerWidth + '×' + innerHeight,
    '.shell display': cs('.shell', 'display'),
    '#sidebar x,y,w,h': R('#sidebar'), 'sidebar padding': cs('#sidebar', 'padding'),
    '.topbar x,y,w,h': R('.topbar'),
    '#composer x,y,w,h': R('#composer'),
    '.composer__box x,y,w,h': R('.composer__box'),
    'textarea w,h': R('#prompt'),
    '.messages x,y,w,h': R('#messages'),
    '.app x,y,w,h': R('.app'),
  };
})()`;

try {
  let target;
  for (let i = 0; i < 80 && !target; i += 1) {
    await sleep(200);
    try { target = (await (await fetch('http://127.0.0.1:9346/json/list')).json()).find((t) => t.type === 'page'); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const waiting = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  // Seed localStorage directly in the v1 layout (Phase 1's app.js can't write it): one long chat.
  const SEED = `(() => {
    localStorage.clear();
    const msgs = []; let t = 1;
    for (let i = 0; i < 12; i++) { msgs.push({ role: 'user', content: 'Question ' + (i + 1), ts: t++ }); msgs.push({ role: 'assistant', content: 'A fairly long answer number ' + (i + 1) + '. '.repeat(1) + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(3), model: 'anthropic/claude-haiku-5.5', ts: t++ }); }
    localStorage.setItem('orch:schema', '1');
    localStorage.setItem('orch:conv:long', JSON.stringify({ id: 'long', messages: msgs }));
    localStorage.setItem('orch:active', 'long');
    localStorage.setItem('orch:prefs', JSON.stringify({ model: 'anthropic/claude-haiku-5.5' }));
    sessionStorage.setItem('orch:apiKey', 'sk-or-v1-not-a-real-key');
    sessionStorage.setItem('orch:session:model', 'anthropic/claude-haiku-5.5');
  })()`;
  for (const [label, port] of [['STALE MIX (what your Chrome shows)', 8795], ['CURRENT (fresh files)', 8796]]) {
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
      await send('Page.navigate', { url: `http://localhost:${port}/` });
      await sleep(1200);
      await evaluate(SEED);
      await send('Page.navigate', { url: `http://localhost:${port}/` });
      await sleep(1500);
      console.log(`\n=== ${label} @ ${w}×${h}`);
      for (const [k, v] of Object.entries(await evaluate(MEASURE))) console.log(`  ${k.padEnd(46)} ${v}`);
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const name = `mix-${port === 8795 ? 'stale' : 'current'}-${w}x${h}.png`;
      writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
      console.log(`  📸 ${join(OUT, name)}`);
    }
  }
  ws.close();
} finally {
  chrome.kill();
  for (const s of servers) s.kill();
}

// OUTCOME (2026-11-20, Switchboard 5.5): the stale mix reproduced all four reported symptoms.
//   @1440×900: .shell display:block; #sidebar 1440×252, padding 0 (runs to the edges);
//   page scrollHeight 1168 in a 900px window, composer at y=1084 (must scroll to reach it);
//   textarea 212px wide (Phase 1 flex composer + unstyled .composer__box = shrink-to-fit);
//   .app a centred 860px column (whitespace); .messages 0px tall (Phase 1 app.js can't read
//   saved chats, which proves the JS was stale as well as the CSS).
//   CURRENT files: grid; sidebar 264×900; page exactly 900; message list scrolls inside.
// Fix: content-hash stamps on every CSS/JS URL (scripts/asset-stamp.mjs; ADR-0001
// QST-PAGES-CACHE A, provisional). Replaying the human's path afterwards = fresh render.
