#!/usr/bin/env node
// 2026-11-20 — Measure phone top-bar item widths, by Switchboard 5.5 (Claude Opus 5.5)
// Context: at 390px the model chip still truncated and the chat title got < 90px after the
// vendor-prefix change; this prints each top-bar child's width to size the fix.
// Usage: node scripts/ephemeral/2026-11-20-topbar-measure.mjs <scratch-dir>

import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? '.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('python3', ['scripts/dev-server.py', '8793'], { stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9345', `--user-data-dir=${join(OUT, 'measure-profile')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
try {
  let target;
  for (let i = 0; i < 80 && !target; i += 1) {
    await sleep(200);
    try { target = (await (await fetch('http://127.0.0.1:9345/json/list')).json()).find((t) => t.type === 'page'); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const waiting = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://localhost:8793/' });
  await sleep(1200);
  await evaluate(`localStorage.setItem('orch:prefs', JSON.stringify({ model: 'anthropic/claude-haiku-5.5' })); sessionStorage.setItem('orch:apiKey', 'sk-or-v1-not-a-real-key')`);
  await send('Page.navigate', { url: 'http://localhost:8793/' });
  await sleep(1200);
  console.log(await evaluate(`(() => {
    const bar = document.querySelector('.topbar'); const cs = getComputedStyle(bar);
    const kids = [...bar.children].filter(e => getComputedStyle(e).display !== 'none').map(e => (e.id || e.className) + '=' + Math.round(e.getBoundingClientRect().width) + (e.id === 'model-chip' ? ' (needs ' + e.scrollWidth + ')' : ''));
    return 'topbar ' + Math.round(bar.getBoundingClientRect().width) + ' pad ' + cs.paddingLeft + '/' + cs.paddingRight + ' gap ' + cs.columnGap + ' | ' + kids.join(', ');
  })()`));
  ws.close();
} finally {
  chrome.kill();
  server.kill();
}

// OUTCOME (2026-11-20, Switchboard 5.5): before: title 88px, chip 142px (needed 147) of the
// 238px left after 3×40px icons + padding + gaps. Phone chip set to 0.75rem / 0.55rem padding /
// max 42% → title 95px, chip 135px (needs 133): "claude-haiku-5.5" shown whole.
