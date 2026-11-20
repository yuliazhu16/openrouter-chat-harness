#!/usr/bin/env node
// 2026-11-19 — Phone-width overflow probe, by Switchboard 5.5 (Claude Opus 5.5)
//
// Context: Phase 2 smoke screenshots at 390px looked zoomed out (innerHeight 953 ≠ 844),
// which means the layout is wider than the device and Chrome scaled the page to fit.
// This loads site/ at 390×844 (mobile emulation) with a model set, and prints
// innerWidth plus every element whose right edge is past 390px.
//
// Usage: node scripts/ephemeral/2026-11-19-phone-width-probe.mjs <scratch-dir>

import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? '.');
const SITE_PORT = 8767;
const CDP_PORT = 9335;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('python3', ['-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1', '--directory', 'site'], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(OUT, 'probe-profile')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

try {
  let target;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(250);
    try {
      target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page');
    } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const waiting = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  for (const state of ['first-run', 'configured']) {
    await send('Page.navigate', { url: `http://localhost:${SITE_PORT}/` });
    await sleep(1200);
    if (state === 'configured') {
      await evaluate(`localStorage.setItem('orch:prefs', JSON.stringify({model:'openrouter/free'})); sessionStorage.setItem('orch:apiKey','sk-or-v1-not-a-real-key')`);
      await send('Page.navigate', { url: `http://localhost:${SITE_PORT}/` });
      await sleep(1200);
    }
    const report = await evaluate(`(() => {
      const wide = [...document.querySelectorAll('body *')]
        .filter(e => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().right > 390.5)
        .map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + [...e.classList].join('.')) + ' right=' + Math.round(e.getBoundingClientRect().right) + ' w=' + Math.round(e.getBoundingClientRect().width));
      return { innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, wide: wide.slice(0, 15) };
    })()`);
    console.log(state, JSON.stringify(report, null, 1));
  }
  ws.close();
} finally {
  chrome.kill();
  server.kill();
}

// OUTCOME (2026-11-19, Switchboard 5.5): before the fix, innerWidth was 411 (first run,
// "Choose model" chip) and 441 (configured); header.topbar was the widest element. Cause:
// the implicit `auto` grid column can't shrink below min-content, so the chip never truncated.
// After `grid-template-columns: minmax(0, 1fr)` on .shell and .app: both states 390, no wide elements.
