#!/usr/bin/env node
// 2026-11-20 — Post-deploy verification of the LIVE Phase 2 site, by Switchboard 5.5 (Claude Opus 5.5)
//
// Context: Phase 2 approved by yuliazhu and pushed (dd535fc); Actions run 44649428848 green.
// This drives headless Chrome against the PUBLIC URL (the real github.io origin, so CORS and the
// CSP are exercised exactly as users get them), with a fresh profile and a FAKE key only:
//   1. layout contract at 1440×900 and 390×844 (grid, header top, composer bottom, no page scroll)
//   2. a real request from the github.io origin reaches OpenRouter through CORS → mapped 401
//   3. the chat is saved and restored after reload; the key is never in localStorage
//   4. no console errors / CSP violations (the expected 401 network line excepted)
// Screenshots go to the scratch dir. No real key is used; the fake key is not hex (secret-scan-safe).
//
// Usage: node scripts/ephemeral/2026-11-20-live-verify.mjs <scratch-dir>

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? '.');
mkdirSync(OUT, { recursive: true });
const URL = 'https://yuliazhu16.github.io/openrouter-chat-harness/';
const FAKE_KEY = 'sk-or-v1-not-a-real-key';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`); };

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9347', `--user-data-dir=${join(OUT, 'live-profile-' + Date.now())}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

const GEO = `(() => { const R = s => { const b = document.querySelector(s).getBoundingClientRect(); return { y: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }; };
  return { shell: getComputedStyle(document.querySelector('.shell')).display, topbar: R('.topbar'), composer: R('#composer'), sidebar: R('#sidebar'),
           docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, vw: innerWidth, h: Math.round(document.querySelector('.shell').getBoundingClientRect().height) }; })()`;

try {
  let target;
  for (let i = 0; i < 80 && !target; i += 1) {
    await sleep(200);
    try { target = (await (await fetch('http://127.0.0.1:9347/json/list')).json()).find((t) => t.type === 'page'); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const waiting = new Map();
  const problems = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) problems.push(m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const size = (width, height, mobile) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  const load = async () => {
    await send('Page.navigate', { url: URL });
    for (let i = 0; i < 60; i += 1) { await sleep(250); if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#model-suggestions option')`)) break; }
  };
  const shot = async (name) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name), Buffer.from(data, 'base64')); console.log(`   📸 ${join(OUT, name)}`); };

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await size(1440, 900, false);
  await load();
  check('live page loads the stamped Phase 2 build', (await evaluate(`!!document.querySelector('link[href*="styles.css?v="]') && !!document.getElementById('sidebar')`)));
  check('first run opens Settings (no default model)', await evaluate(`document.getElementById('settings').open`));

  await evaluate(`(() => { document.getElementById('api-key').value = ${JSON.stringify(FAKE_KEY)}; document.getElementById('model').value = 'openrouter/free'; document.getElementById('settings-form').requestSubmit(); })()`);
  await evaluate(`(() => { document.getElementById('prompt').value = 'ping from the live site'; document.getElementById('composer').requestSubmit(); })()`);
  let notice = '';
  for (let i = 0; i < 80 && !notice; i += 1) { await sleep(250); notice = await evaluate(`document.querySelector('.msg--error .msg__body')?.textContent ?? ''`); }
  check('real request from the github.io origin → OpenRouter through CORS → mapped 401', /API key is missing or invalid/.test(notice), JSON.stringify(notice));

  let g = await evaluate(GEO);
  check('desktop 1440×900: grid layout, header at top, composer at bottom, no page scroll', g.shell === 'grid' && g.topbar.y === 0 && g.composer.b === 900 && g.docH === 900 && g.docW === 1440 && g.sidebar.w >= 250 && g.sidebar.w <= 280, JSON.stringify(g));
  await shot('live-desktop-1440x900.png');

  await load();
  check('after reload: chat restored from localStorage', (await evaluate(`[...document.querySelectorAll('#messages .msg--user .msg__body')].some(b => b.textContent === 'ping from the live site')`)));
  check('after reload: sidebar lists it', (await evaluate(`[...document.querySelectorAll('#conv-list .conv__open')].map(b => b.textContent).includes('ping from the live site')`)));
  check('the key is not in localStorage; it is in sessionStorage', (await evaluate(`!JSON.stringify(Object.entries(localStorage)).includes('sk-or-') && sessionStorage.getItem('orch:apiKey') === ${JSON.stringify(FAKE_KEY)}`)));

  await size(390, 844, true);
  await load();
  g = await evaluate(GEO);
  check('phone 390×844: exactly device width, header top, composer bottom, no page scroll', g.vw === 390 && g.docW === 390 && g.topbar.y === 0 && g.composer.b === g.h && g.h === 844 && g.docH === 844, JSON.stringify(g));
  await shot('live-phone-390x844.png');

  const real = problems.filter((p) => !/401|Failed to load resource/.test(p));
  check('no console errors, exceptions, or CSP violations', real.length === 0, real.join(' | '));
  ws.close();
} catch (err) {
  check('live verification completed', false, err.stack);
} finally {
  chrome.kill();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} live checks passed`);
process.exit(failed ? 1 : 0);

// OUTCOME (2026-11-20, Switchboard 5.5): 9/9 against the live site serving dd535fc (stamp
// ?v=ca07c07f), right after Actions run 44649428848 (test ✓ 48/48, deploy ✓). The fake key got a
// genuine 401 through CORS from the github.io origin, shown with the mapped wording; the chat was
// restored after reload; no key in localStorage; layout contract held at 1440×900 and 390×844;
// no CSP violations. ADR-0004 → Implemented.
