#!/usr/bin/env node
// 2026-11-20 — Layout regression check (desktop 1440×900, phone 390×844, 768 breakpoint),
// by Switchboard 5.5 (Claude Opus 5.5)
//
// Context: yuliazhu saw the Phase 2 layout broken locally (root cause: cached Phase 1 CSS/JS
// with new HTML — scripts/ephemeral/2026-11-20-layout-diagnosis.mjs) and asked for a
// ChatGPT/Claude-quality layout with a regression check. This measures the RENDERED geometry
// in headless Chrome, with data seeded through the real storage.js, and asserts the contract:
//   desktop: sidebar at x=0, 250–280px wide, full height; header at the top of the main panel,
//            its bottom border aligned with the sidebar header's; chat fills exactly the space
//            between header (or banner) and composer; composer at the bottom; no page scroll,
//            no horizontal overflow; the conversation scrolls and opens at the latest message
//   phone:   layout exactly 390px (no zoom-out); drawer hidden until opened; same vertical
//            contract; a shorter visible viewport (keyboard open → --app-height) keeps the
//            composer at its bottom edge
//   also:    `.shell` must be a grid — the stale-stylesheet failure shows up as display:block
// Prints ✅/❌ per check and saves screenshots (light + dark desktop, phone, drawer).
//
// Usage: node scripts/ephemeral/2026-11-20-layout-check.mjs <scratch-dir>   (expects all ✅)

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? '.');
mkdirSync(OUT, { recursive: true });
const SITE_PORT = 8792;
const CDP_PORT = 9344;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`);
};
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

const server = spawn('python3', ['scripts/dev-server.py', String(SITE_PORT)], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(OUT, 'layout-profile')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

const GEOMETRY = `(() => {
  const R = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  const chat = document.getElementById('chat');
  const msgs = document.querySelectorAll('#messages > li');
  const last = msgs[msgs.length - 1]?.getBoundingClientRect();
  const banner = document.getElementById('storage-banner');
  return {
    vw: innerWidth, vh: Math.round(document.querySelector('.shell').getBoundingClientRect().height),
    docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, winH: innerHeight,
    shellDisplay: getComputedStyle(document.querySelector('.shell')).display,
    sidebarVisibility: getComputedStyle(document.getElementById('sidebar')).visibility,
    sidebar: R('#sidebar'), sidebarHead: R('.sidebar__head'), topbar: R('.topbar'), banner: banner.hidden ? null : R('#storage-banner'),
    chat: R('#chat'), composer: R('#composer'), box: R('.composer__box'), app: R('.app'), messages: R('#messages'), textarea: R('#prompt'),
    chatScrollable: chat.scrollHeight > chat.clientHeight + 4,
    lastMsgVisible: last ? Math.round(last.bottom) <= Math.round(chat.getBoundingClientRect().bottom) + 1 : null,
    title: document.getElementById('chat-title').textContent,
  };
})()`;

/** The vertical contract shared by every size: header → [banner] → chat → composer, no gaps. */
function verticalContract(label, g, height) {
  const above = g.banner ?? g.topbar;
  check(`${label}: header at the top of the main panel`, g.topbar.y === 0, JSON.stringify(g.topbar));
  if (g.banner) check(`${label}: banner directly under the header`, near(g.banner.y, g.topbar.b), JSON.stringify({ banner: g.banner, topbar: g.topbar }));
  check(`${label}: conversation starts right under the ${g.banner ? 'banner' : 'header'} (no gap)`, near(g.chat.y, above.b), `chat.y=${g.chat.y} above.b=${above.b}`);
  check(`${label}: conversation ends right where the composer starts (no gap)`, near(g.chat.b, g.composer.y), `chat.b=${g.chat.b} composer.y=${g.composer.y}`);
  check(`${label}: composer at the bottom edge, not stretched`, near(g.composer.b, height) && g.composer.h < 120, JSON.stringify(g.composer));
}

try {
  let target;
  for (let i = 0; i < 80 && !target; i += 1) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const waiting = new Map();
  const problems = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const size = async (width, height, mobile) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
    await sleep(400);
  };
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
    console.log(`   📸 ${join(OUT, name)}`);
  };
  const load = async () => {
    await send('Page.navigate', { url: `http://localhost:${SITE_PORT}/` });
    for (let i = 0; i < 50; i += 1) {
      await sleep(150);
      try { if (await evaluate(`document.readyState === 'complete' && document.querySelectorAll('#model-suggestions option').length > 0`)) break; } catch {}
    }
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await size(1440, 900, false);
  await load();

  // Seed: 7 chats through the real storage module; the newest has a long exchange.
  await evaluate(`(async () => {
    localStorage.clear(); sessionStorage.clear(); // the profile dir persists between runs
    const { createChatStore } = await import('./js/storage.js');
    const s = createChatStore();
    s.setPrefs({ model: 'anthropic/claude-haiku-5.5' });
    const topics = ['Plan a weekend in Lisbon', 'Explain CORS preflight requests', 'Regex for ISO dates', 'Draft a polite follow-up email', 'Why is my CSS grid row stretching?', 'Compare SQLite and Postgres for a side project'];
    let t = Date.now() - 1e7;
    for (const topic of topics) { const id = s.create({ role: 'user', content: topic, ts: t++ }).id; s.append(id, { role: 'assistant', content: 'Here is a short answer about ' + topic.toLowerCase() + '.', model: 'anthropic/claude-haiku-5.5', ts: t++ }); }
    const id = s.create({ role: 'user', content: 'Help me structure a static chat app with saved conversations', ts: t++ }).id;
    for (let i = 0; i < 9; i += 1) {
      s.append(id, { role: 'assistant', content: 'Step ' + (i + 1) + ': ' + 'Keep pure modules free of DOM access so they can be unit-tested in Node. '.repeat(3), model: 'anthropic/claude-haiku-5.5', ts: t++ });
      s.append(id, { role: 'user', content: 'And then what? (' + (i + 1) + ')', ts: t++ });
    }
    s.append(id, { role: 'assistant', content: 'That is the whole plan — the latest message should be visible on load.', model: 'anthropic/claude-haiku-5.5', ts: t++ });
    sessionStorage.setItem('orch:apiKey', 'sk-or-v1-not-a-real-key');
  })()`);
  await load();

  // ---- desktop 1440×900
  let g = await evaluate(GEOMETRY);
  check('desktop: .shell is a grid (a stale stylesheet would make it block)', g.shellDisplay === 'grid', g.shellDisplay);
  check('desktop: sidebar pinned left, full height, 250–280px wide', g.sidebar.x === 0 && g.sidebar.y === 0 && g.sidebar.h === 900 && g.sidebar.w >= 250 && g.sidebar.w <= 280, JSON.stringify(g.sidebar));
  check('desktop: main panel fills the rest of the width', near(g.app.x, g.sidebar.r) && g.app.r === 1440, JSON.stringify(g.app));
  check('desktop: sidebar header and chat header share one bottom line', near(g.sidebarHead.b, g.topbar.b), `${g.sidebarHead.b} vs ${g.topbar.b}`);
  verticalContract('desktop', g, 900);
  check('desktop: conversation column 800–900px wide, centred in the main panel', g.messages.w >= 800 && g.messages.w <= 900 && near(g.messages.x + g.messages.w / 2, g.app.x + g.app.w / 2, 2), JSON.stringify(g.messages));
  check('desktop: composer uses the same content width as the conversation', near(g.box.x, g.messages.x) && near(g.box.w, g.messages.w), `box ${JSON.stringify(g.box)} vs messages x=${g.messages.x} w=${g.messages.w}`);
  check('desktop: input is multiline-sized (≥ 2 lines) and fills the field', g.textarea.h >= 44 && g.textarea.w >= g.box.w - 140, JSON.stringify(g.textarea));
  // Only the message list scrolls: try to scroll the page and the list, then re-measure.
  const scrollTest = await evaluate(`(() => {
    const chat = document.getElementById('chat');
    const before = { top: document.querySelector('.topbar').getBoundingClientRect().top, comp: document.getElementById('composer').getBoundingClientRect().bottom };
    window.scrollTo(0, 5000); document.scrollingElement.scrollTop = 5000;
    chat.scrollTop = 0;
    const r = { pageScrollY: window.scrollY, chatScrolledTo: chat.scrollTop,
      topbarTop: document.querySelector('.topbar').getBoundingClientRect().top, composerBottom: document.getElementById('composer').getBoundingClientRect().bottom, before };
    chat.scrollTop = chat.scrollHeight;
    return r;
  })()`);
  check('desktop: the page itself cannot scroll; header and composer stay put while the message list scrolls', scrollTest.pageScrollY === 0 && scrollTest.chatScrolledTo === 0 && scrollTest.topbarTop === 0 && Math.round(scrollTest.composerBottom) === 900, JSON.stringify(scrollTest));
  const escapees = await evaluate(`[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().bottom > innerHeight + 1 && !e.closest('#chat, dialog')).length
    + ' outside #chat; inside #chat but not clipped by it: ' + [...document.querySelectorAll('#chat *')].filter(e => getComputedStyle(e).position === 'absolute' && e.offsetParent && !document.getElementById('chat').contains(e.offsetParent)).length`);
  check('desktop: no page scroll, no horizontal overflow', g.docW === 1440 && g.docH === 900, `${g.docW}×${g.docH}; ${escapees}`);
  check('desktop: long conversation scrolls inside the panel', g.chatScrollable);
  check('desktop: opens at the latest message', g.lastMsgVisible === true);
  check('desktop: header shows the open chat\'s title', g.title === 'Help me structure a static chat app with saved conversations', g.title);
  await shot('layout-desktop-1440x900.png');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(300);
  await shot('layout-desktop-1440x900-dark.png');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  // ---- desktop with the storage banner showing (a corrupt saved chat)
  await evaluate(`localStorage.setItem('orch:conv:broken', '{"id":"broken","messages":[{"role"')`);
  await load();
  g = await evaluate(GEOMETRY);
  check('desktop + banner: banner is visible', g.banner !== null);
  verticalContract('desktop + banner', g, 900);
  await evaluate(`localStorage.removeItem('orch:conv:broken')`);
  await load();

  // ---- 768px breakpoint (tablet portrait): sidebar is static, nothing overflows
  await size(768, 1024, false);
  g = await evaluate(GEOMETRY);
  check('768px: sidebar visible beside the panel', g.sidebarVisibility === 'visible' && g.sidebar.x === 0 && near(g.app.x, g.sidebar.r), JSON.stringify(g.sidebar));
  check('768px: no horizontal overflow', g.docW === 768, String(g.docW));
  verticalContract('768px', g, 1024);

  // ---- phone 390×844
  await size(390, 844, true);
  await load();
  g = await evaluate(GEOMETRY);
  check('phone: layout exactly 390px wide (no zoom-out, no horizontal scroll)', g.vw === 390 && g.docW === 390, `${g.vw}/${g.docW}`);
  check('phone: drawer hidden until opened', g.sidebarVisibility === 'hidden');
  check('phone: header spans the full width', g.topbar.x === 0 && g.topbar.w === 390, JSON.stringify(g.topbar));
  verticalContract('phone', g, g.vh);
  check('phone: no page scroll (document is exactly the viewport height)', g.docH === 844, String(g.docH));
  check('phone: composer uses the same content width as the conversation', near(g.box.x, g.messages.x) && near(g.box.w, g.messages.w), `box x=${g.box.x} w=${g.box.w} vs messages x=${g.messages.x} w=${g.messages.w}`);
  const phoneScroll = await evaluate(`(() => { window.scrollTo(0, 5000); const c = document.getElementById('chat'); c.scrollTop = 0;
    const r = { pageScrollY: window.scrollY, chatScrolledTo: c.scrollTop, topbarTop: document.querySelector('.topbar').getBoundingClientRect().top, composerBottom: Math.round(document.getElementById('composer').getBoundingClientRect().bottom) };
    c.scrollTop = c.scrollHeight; return r; })()`);
  check('phone: the page cannot scroll; only the message list does', phoneScroll.pageScrollY === 0 && phoneScroll.chatScrolledTo === 0 && phoneScroll.topbarTop === 0 && phoneScroll.composerBottom === 844, JSON.stringify(phoneScroll));
  const chip = await evaluate(`(() => { const c = document.getElementById('model-chip'); return { text: c.innerText.trim(), full: c.textContent, fits: c.scrollWidth <= c.clientWidth + 1 }; })()`);
  check('phone: model chip shows the model name without the provider, untruncated', chip.text === 'claude-haiku-5.5' && chip.full === 'anthropic/claude-haiku-5.5' && chip.fits, JSON.stringify(chip));
  check('phone: chat title keeps readable room (≥ 90px)', (await evaluate(`document.getElementById('chat-title').getBoundingClientRect().width`)) >= 90);
  check('phone: shell fills the visible viewport', g.vh === 844, String(g.vh));
  check('phone: opens at the latest message', g.lastMsgVisible === true);
  await shot('layout-phone-390x844.png');

  // keyboard open: the visible viewport shrinks (iOS: app.js sets --app-height from visualViewport)
  await evaluate(`document.documentElement.style.setProperty('--app-height', '480px')`);
  await sleep(200);
  g = await evaluate(GEOMETRY);
  check('phone, keyboard open (480px visible): composer sits at the visible bottom', near(g.composer.b, 480) && g.topbar.y === 0, JSON.stringify(g.composer));
  verticalContract('phone, keyboard open', g, 480);
  await shot('layout-phone-keyboard-480.png');
  await evaluate(`document.documentElement.style.setProperty('--app-height', Math.round(visualViewport.height) + 'px')`);
  await sleep(200);

  // A real visible-viewport resize (fires visualViewport 'resize' → app.js handler), as when a
  // keyboard opens: the composer must follow AND the latest message must stay in view.
  await evaluate(`document.getElementById('chat').scrollTop = 1e6`);
  await size(390, 480, true);
  g = await evaluate(GEOMETRY);
  check('phone, viewport shrinks to 480 (handler path): composer at the bottom, latest message still visible', near(g.composer.b, 480) && g.lastMsgVisible === true, JSON.stringify({ composer: g.composer, last: g.lastMsgVisible }));
  await size(390, 844, true);

  // drawer
  await evaluate(`document.getElementById('sidebar-toggle').click()`);
  await sleep(350);
  g = await evaluate(GEOMETRY);
  check('phone: ☰ opens the drawer from the left edge', g.sidebarVisibility === 'visible' && g.sidebar.x === 0 && g.sidebar.w <= Math.round(390 * 0.85), JSON.stringify(g.sidebar));
  check('phone: drawer gives focus to New chat', (await evaluate(`document.activeElement.id`)) === 'new-chat');
  check('phone: drawer open causes no horizontal overflow', g.docW === 390, String(g.docW));
  await shot('layout-phone-drawer.png');
  await evaluate(`document.getElementById('close-sidebar').click()`);
  await sleep(350);
  check('phone: close button hides the drawer and returns focus to ☰', (await evaluate(`getComputedStyle(document.getElementById('sidebar')).visibility`)) === 'hidden' && (await evaluate(`document.activeElement.id`)) === 'sidebar-toggle');

  check('no exceptions or console errors (incl. CSP violations)', problems.length === 0, problems.join(' | '));
  ws.close();
} catch (err) {
  check('layout run completed', false, err.stack);
} finally {
  chrome.kill();
  server.kill();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} layout checks passed`);
process.exit(failed ? 1 : 0);

// OUTCOME (2026-11-20, Switchboard 5.5): 48/48 on the reworked layout. Along the way it caught:
//  - document 1949px (desktop) / 2829px (phone) tall behind body{overflow:hidden}: the
//    absolutely-positioned .visually-hidden role labels in messages escaped the chat scroller
//    (containing block = page). Fixed with `.chat { position: relative }`; predates Phase 2.
//  - phone header title squeezed to 88px by the model chip → vendor-prefix hiding + sizing.
//  - (my own bug) a persistent profile re-seeded chats each run → storage cleared before seeding.
// Keyboard: the CSS contract (--app-height) and the visualViewport handler path (emulated
// viewport shrink) are checked here; a real iOS/Android keyboard still needs a device.
