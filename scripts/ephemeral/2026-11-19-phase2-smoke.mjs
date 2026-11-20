#!/usr/bin/env node
// 2026-11-19 — Headless-Chrome smoke test of Phase 2 persistence, by Switchboard 5.5 (Claude Opus 5.5)
//
// Context: Phase 2 (ADR-0004, ADR-0005). tests/storage.test.js covers storage.js; this drives
// the REAL page in a real browser over the Chrome DevTools Protocol (Node 24 built-in
// WebSocket, no dependencies) to check the wiring only a browser can show:
//   1. a real request to OpenRouter (FAKE key → genuine 401 through CORS) is saved with its chat
//   2. reload restores the sidebar, the open chat, the error notice + Retry, and the model;
//      the key stays in sessionStorage and never appears in localStorage
//   3. New chat / switching / a reply landing in the chat it was sent from after switching away
//   4. reload while a request is in flight → "No reply yet." + Retry
//   5. delete one (confirm), Clear history (confirm text has the count; key + model kept)
//   6. a corrupt saved conversation → banner, the rest still load
//   7. phone-width drawer opens/closes; screenshots phone + desktop; no console errors / CSP violations
// Success replies are simulated by replacing window.fetch in the page (standing in for the
// network); the 401 in step 1 is a real round-trip. No real key is ever used; the fake key
// is not hex, so `secret-scan` ignores it.
//
// Usage: node scripts/ephemeral/2026-11-19-phase2-smoke.mjs <output-dir-for-screenshots>

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? '.');
mkdirSync(OUT, { recursive: true });
const SITE_PORT = 8766;
const CDP_PORT = 9334;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FAKE_KEY = 'sk-or-v1-not-a-real-key';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const server = spawn('python3', ['scripts/dev-server.py', String(SITE_PORT)], {
  stdio: 'ignore',
});
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(OUT, 'chrome-profile')}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not ready yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(150);
  }
}

// In-page snippets
const STUB_FETCH = (reply, delayMs = 0) => `(() => {
  window.fetch = (url, init) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(new Response(JSON.stringify({
      model: 'stub/model', choices: [{ message: { content: ${JSON.stringify(reply)} }, finish_reason: 'stop' }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })), ${delayMs});
    init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
  });
})()`;
const HANG_FETCH = `(() => { window.fetch = () => new Promise(() => {}); })()`;
const SEND = (text) => `(() => {
  document.getElementById('prompt').value = ${JSON.stringify(text)};
  document.getElementById('composer').requestSubmit();
})()`;
const TITLES = `[...document.querySelectorAll('#conv-list .conv__open')].map(b => b.textContent)`;
const ACTIVE_TITLE = `document.querySelector('#conv-list .conv--active .conv__open')?.textContent ?? null`;
const BODIES = `[...document.querySelectorAll('#messages .msg__body')].map(b => b.textContent)`;

try {
  const target = await waitFor(
    async () => (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page'),
    15000,
    'chrome',
  );
  await waitFor(async () => (await fetch(`http://127.0.0.1:${SITE_PORT}/`)).ok, 10000, 'http.server');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const waiting = new Map();
  const problems = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      problems.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    } else if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
      problems.push(`log.${msg.params.entry.level}: ${msg.params.entry.text}`);
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      dialogs.push(msg.params.message);
      send('Page.handleJavaScriptDialog', { accept: true });
    }
  });
  const dialogs = [];
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      waiting.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const screenshot = async (name, width, height, mobile) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
    await sleep(350);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
    console.log(`   📸 ${join(OUT, name)}`);
  };
  const load = async () => {
    await send('Page.navigate', { url: `http://localhost:${SITE_PORT}/` });
    await waitFor(
      () => evaluate(`document.readyState === 'complete' && document.querySelectorAll('#model-suggestions option').length > 0`),
      10000,
      'app boot',
    );
  };
  const idle = () => waitFor(() => evaluate(`document.getElementById('stop').hidden`), 20000, 'request to finish');

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });

  // 0. Phase 1 → 2: a tab that had the model in sessionStorage keeps it
  await load();
  await evaluate(`sessionStorage.setItem('orch:session:model', 'openrouter/free'); sessionStorage.setItem('orch:apiKey', ${JSON.stringify(FAKE_KEY)});`);
  await load();
  check('Phase 1 tab: model handed over to saved prefs', (await evaluate(`document.getElementById('model-chip').textContent`)) === 'openrouter/free');
  check('Phase 1 tab: session copy of the model removed', (await evaluate(`sessionStorage.getItem('orch:session:model')`)) === null);
  check('Settings not reopened (key in session, model in prefs)', !(await evaluate(`document.getElementById('settings').open`)));

  // 1. real 401 through CORS, saved with its chat
  await evaluate(SEND('ping'));
  await idle();
  const notice = await evaluate(`document.querySelector('.msg--error .msg__body')?.textContent ?? ''`);
  check('real request → mapped 401 notice', /API key is missing or invalid/.test(notice), JSON.stringify(notice));
  check('sidebar lists the new chat, titled by its first message', same(await evaluate(TITLES), ['ping']));

  // 2. reload restores
  await load();
  check('after reload: chat restored (message + error notice)', same(await evaluate(BODIES), ['ping', notice]));
  check('after reload: it is the open chat in the sidebar', (await evaluate(ACTIVE_TITLE)) === 'ping');
  const actions = await evaluate(`[...document.querySelectorAll('.msg--error .msg__actions button')].map(b => b.textContent)`);
  check('after reload: error still offers Open Settings + Retry', same(actions, ['Open Settings', 'Retry']), JSON.stringify(actions));
  check('after reload: model chip restored', (await evaluate(`document.getElementById('model-chip').textContent`)) === 'openrouter/free');
  const localDump = await evaluate(`JSON.stringify(Object.entries(localStorage))`);
  check('the key is not anywhere in localStorage', !localDump.includes(FAKE_KEY) && !localDump.includes('sk-or-'));
  check('the key is in sessionStorage', (await evaluate(`sessionStorage.getItem('orch:apiKey')`)) === FAKE_KEY);

  // 3. new chat, success reply (stubbed network), switching
  await evaluate(`document.getElementById('new-chat').click()`);
  check('New chat shows the empty state', !(await evaluate(`document.getElementById('empty-state').hidden`)));
  await evaluate(STUB_FETCH('pong'));
  await evaluate(SEND('second chat'));
  await idle();
  check('reply shown in the new chat', same(await evaluate(BODIES), ['second chat', 'pong']));
  check('sidebar: newest first', same(await evaluate(TITLES), ['second chat', 'ping']));
  await evaluate(`[...document.querySelectorAll('#conv-list .conv__open')].find(b => b.textContent === 'ping').click()`);
  check('switching opens the other chat', same(await evaluate(BODIES), ['ping', notice]));

  // reply lands in the chat it was sent from, even after switching away
  await evaluate(`document.getElementById('new-chat').click()`);
  await evaluate(STUB_FETCH('slow answer', 1200));
  await evaluate(SEND('slow question'));
  await evaluate(`[...document.querySelectorAll('#conv-list .conv__open')].find(b => b.textContent === 'second chat').click()`);
  await idle();
  check('while away: the open chat is untouched', same(await evaluate(BODIES), ['second chat', 'pong']));
  await evaluate(`[...document.querySelectorAll('#conv-list .conv__open')].find(b => b.textContent === 'slow question').click()`);
  check('the late reply landed in the chat it was sent from', same(await evaluate(BODIES), ['slow question', 'slow answer']));
  await screenshot('p2-1-desktop-sidebar.png', 1440, 900, false);

  // 4. reload while waiting
  await evaluate(`document.getElementById('new-chat').click()`);
  await evaluate(HANG_FETCH);
  await evaluate(SEND('reloaded mid-request'));
  await load();
  check('reload mid-request: message kept', (await evaluate(BODIES))[0] === 'reloaded mid-request');
  const tail = await evaluate(`[...document.querySelectorAll('#messages .msg--notice')].map(n => n.textContent)`);
  check('reload mid-request: "No reply yet." with Retry', tail.length === 1 && /No reply yet\./.test(tail[0]) && /Retry/.test(tail[0]), JSON.stringify(tail));

  // 5. delete one, then Clear history
  const before = (await evaluate(TITLES)).length;
  await evaluate(`document.querySelector('#conv-list .conv--active .conv__delete').click()`);
  await sleep(200);
  check('delete asks for confirmation', /Delete "reloaded mid-request"\?/.test(dialogs.at(-1) ?? ''), dialogs.at(-1));
  check('delete removed exactly one chat', (await evaluate(TITLES)).length === before - 1);
  check('deleting the open chat leaves a fresh chat open', !(await evaluate(`document.getElementById('empty-state').hidden`)));

  // 6. a corrupt chat (injected) → banner; then clear
  await evaluate(`localStorage.setItem('orch:conv:broken', '{"id":"broken","messages":[{"role"')`);
  await load();
  const banner = await evaluate(`document.getElementById('storage-banner').hidden ? '' : document.getElementById('storage-banner').textContent`);
  check('corrupt saved chat → banner, the rest still load', /1 saved conversation couldn't be read/.test(banner) && (await evaluate(TITLES)).length === 3, banner);

  await evaluate(`document.getElementById('clear-history').click()`);
  await sleep(200);
  check('Clear asks with the count', /Delete all 3 conversations \(plus 1 unreadable\)\?/.test(dialogs.at(-1) ?? ''), dialogs.at(-1));
  check('Clear emptied the list', (await evaluate(TITLES)).length === 0);
  check('no orch:conv:* keys left', (await evaluate(`Object.keys(localStorage).filter(k => k.startsWith('orch:conv:')).length`)) === 0);
  await load();
  check('after Clear + reload: model kept', (await evaluate(`document.getElementById('model-chip').textContent`)) === 'openrouter/free');
  check('after Clear + reload: key kept (Settings not reopened)', !(await evaluate(`document.getElementById('settings').open`)));
  check('after Clear + reload: banner gone', await evaluate(`document.getElementById('storage-banner').hidden`));

  // 7. phone drawer
  await evaluate(STUB_FETCH('pong'));
  await evaluate(SEND('phone chat'));
  await idle();
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  check('phone: sidebar hidden by default', await evaluate(`getComputedStyle(document.getElementById('sidebar')).visibility === 'hidden'`));
  await screenshot('p2-2-phone-chat.png', 390, 844, true);
  await evaluate(`document.getElementById('sidebar-toggle').click()`);
  await sleep(300);
  check('phone: toggle opens the drawer', await evaluate(`getComputedStyle(document.getElementById('sidebar')).visibility === 'visible' && !document.getElementById('backdrop').hidden`));
  await screenshot('p2-3-phone-drawer.png', 390, 844, true);
  await evaluate(`document.getElementById('backdrop').click()`);
  await sleep(300);
  check('phone: backdrop closes the drawer', await evaluate(`!document.body.classList.contains('drawer-open')`));
  // Regression (found from a zoomed-out screenshot): the topbar's min-content width pushed the
  // layout to 441px and Chrome zoomed the page out to fit. `scrollWidth <= innerWidth` cannot
  // see this — innerWidth grows with the overflow — so compare against the device width.
  const width = await evaluate(`({ innerWidth, scrollWidth: document.documentElement.scrollWidth })`);
  check('phone: layout is exactly 390px wide (no zoom-out, no horizontal scroll)', width.innerWidth === 390 && width.scrollWidth === 390, JSON.stringify(width));
  // Regression (caught by screenshot on the first run): with the banner hidden, the chat fell
  // into the banner's auto grid row and the composer stretched into the 1fr row, mid-screen.
  const layout = await evaluate(`(() => {
    const c = document.getElementById('composer').getBoundingClientRect();
    return { composerBottom: Math.round(c.bottom), composerHeight: Math.round(c.height), viewport: Math.round(document.querySelector('.shell').getBoundingClientRect().bottom) };
  })()`);
  check('phone: composer is pinned to the bottom and not stretched', layout.composerBottom === layout.viewport && layout.composerHeight < 120, JSON.stringify(layout));
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(300);
  const desk = await evaluate(`(() => {
    const c = document.getElementById('composer').getBoundingClientRect();
    return { composerBottom: Math.round(c.bottom), composerHeight: Math.round(c.height), viewport: Math.round(document.querySelector('.shell').getBoundingClientRect().bottom) };
  })()`);
  check('desktop: composer is pinned to the bottom and not stretched', desk.composerBottom === desk.viewport && desk.composerHeight < 120, JSON.stringify(desk));

  const realProblems = problems.filter((p) => !/401|Failed to load resource/.test(p)); // the 401 itself is expected
  check('no console errors, exceptions, or CSP violations', realProblems.length === 0, realProblems.join(' | '));
  ws.close();
} catch (err) {
  check('smoke run completed', false, err.message);
} finally {
  chrome.kill();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

// ---------------------------------------------------------------------------
// OUTCOME (2026-11-19, Switchboard 5.5): 36/36 on the final Phase 2 site.
//  - First run: 34/34 green, but the screenshots showed the composer stretched mid-screen
//    (a [hidden] banner left the grid and shifted every row up). Fixed with explicit
//    grid-row; check added and verified red without the fix.
//  - The phone screenshot then looked zoomed out (innerHeight 953 ≠ 844): the top bar forced
//    a 441px layout. The old `scrollWidth <= innerWidth` check was vacuous (innerWidth grows
//    with the overflow). Fixed with minmax(0, 1fr) columns; check now compares with 390.
//    See docs/vignettes/2026-11-19-the-check-that-grew-with-the-bug.md.
//  - Real CORS 401 saved and restored across reload; the key never appeared in localStorage.
