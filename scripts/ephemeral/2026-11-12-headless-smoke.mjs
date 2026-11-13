#!/usr/bin/env node
// 2026-11-12 — Headless-Chrome smoke test of site/, by Switchboard 5.5 (Claude Opus 5.5)
//
// Context: Phase 1 (ADR-0005). Unit tests cover the pure modules; this drives the
// REAL page in a real browser over the Chrome DevTools Protocol (Node 24's built-in
// WebSocket — no dependencies) to check what only a browser can:
//   1. first run opens Settings, Send disabled, model suggestions present
//   2. saving a key + model enables chatting
//   3. a real request from a real browser origin reaches OpenRouter through CORS and
//      the 401 for a deliberately FAKE key is shown with our mapped wording
//   4. HTML in a reply renders as inert text (ADR-0002 invariant)
//   5. key + model survive a reload (sessionStorage); chat does not (Phase 1: in memory)
//   6. no console errors / CSP violations; screenshots at phone + desktop width
// No real key is ever used. The fake key is not hex, so `secret-scan` ignores it.
//
// Usage: node scripts/ephemeral/2026-11-12-headless-smoke.mjs <output-dir-for-screenshots>

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? '.');
mkdirSync(OUT, { recursive: true });
const SITE_PORT = 8765;
const CDP_PORT = 9333;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FAKE_KEY = 'sk-or-v1-not-a-real-key';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const server = spawn('python3', ['-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1', '--directory', 'site'], {
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
    await sleep(200);
  }
}

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
    }
  });
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
  const screenshot = async (name, width, height, mobile) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
    await sleep(300);
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

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // 1. first run
  await load();
  check('first run opens Settings (no default model, ADR-0003 C)', await evaluate(`document.getElementById('settings').open`));
  check('Send is disabled until key + model are set', await evaluate(`document.getElementById('send').disabled`));
  const options = await evaluate(`document.querySelectorAll('#model-suggestions option').length`);
  check('model suggestions populated', options === 9, `${options} options`);
  await screenshot('1-first-run-settings-phone.png', 390, 844, true);

  // 2. save settings
  await evaluate(`(() => {
    document.getElementById('api-key').value = ${JSON.stringify(FAKE_KEY)};
    document.getElementById('model').value = 'openrouter/free';
    document.getElementById('settings-form').requestSubmit();
  })()`);
  check('saving closes Settings', !(await evaluate(`document.getElementById('settings').open`)));
  check('Send enabled after saving', !(await evaluate(`document.getElementById('send').disabled`)));
  check('model chip shows the model', (await evaluate(`document.getElementById('model-chip').textContent`)) === 'openrouter/free');

  // 3. real request through CORS with a fake key → mapped 401
  await evaluate(`(() => {
    document.getElementById('prompt').value = 'ping';
    document.getElementById('composer').requestSubmit();
  })()`);
  const sawStop = await evaluate(`!document.getElementById('stop').hidden`);
  check('Stop button shown while waiting', sawStop);
  const notice = await waitFor(
    () => evaluate(`document.querySelector('.msg--error .msg__body')?.textContent ?? ''`),
    20000,
    'error notice',
  );
  check('real browser → OpenRouter request completes through CORS', notice.length > 0);
  check(
    '401 for the fake key is shown with mapped wording (not "cookie")',
    /API key is missing or invalid/.test(notice) && !/cookie/i.test(notice),
    JSON.stringify(notice),
  );
  check('user bubble rendered', (await evaluate(`document.querySelector('.msg--user .msg__body')?.textContent`)) === 'ping');
  const actions = await evaluate(`[...document.querySelectorAll('.msg--error .msg__actions button')].map(b => b.textContent)`);
  check('error offers Open Settings + Retry', JSON.stringify(actions) === '["Open Settings","Retry"]', JSON.stringify(actions));
  check('Send back (Stop hidden) after the request', await evaluate(`document.getElementById('stop').hidden`));
  await screenshot('2-error-phone.png', 390, 844, true);

  // 4. HTML in a reply is inert text
  const inert = await evaluate(`(async () => {
    const { renderMessage } = await import('./js/render.js');
    const li = renderMessage({ role: 'assistant', content: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>' });
    document.getElementById('messages').append(li);
    await new Promise(r => setTimeout(r, 200));
    return li.querySelector('img, script') === null && li.textContent.includes('<img') && !window.__pwned;
  })()`);
  check('HTML in a reply renders as text, never as elements', inert);
  await screenshot('3-conversation-desktop.png', 1280, 800, false);

  // 5. reload
  await load();
  check('after reload: Settings not reopened (key + model kept in sessionStorage)', !(await evaluate(`document.getElementById('settings').open`)));
  check('after reload: model chip restored', (await evaluate(`document.getElementById('model-chip').textContent`)) === 'openrouter/free');
  check('after reload: chat empty (Phase 1 keeps chats in memory; Phase 2 adds saving)', (await evaluate(`document.querySelectorAll('#messages li').length`)) === 0);
  check('nothing written to localStorage in Phase 1', (await evaluate(`localStorage.length`)) === 0);

  // 6. console
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
// OUTCOME (2026-11-12, Switchboard 5.5): 18/18 checks passed on the Phase 1 site.
//  - A real headless Chrome tab at http://localhost:8765 POSTed to OpenRouter through CORS;
//    the fake key got a genuine 401, shown as "Your API key is missing or invalid. Open
//    Settings to check it." with [Open Settings][Retry] — ADR-0003 browser link verified
//    (only an AUTHENTICATED round-trip from the Pages URL remains, needing a real key).
//  - <img onerror>/<script> in a reply rendered as text; no CSP violations or console errors.
//  - Screenshots caught one bug the checks could not: the "not configured" composer
//    placeholder wrapped and was clipped at 390px. Shortened; re-run still 18/18.
