# OpenRouter Chat Harness

A simple, static AI chat client for [OpenRouter](https://openrouter.ai), hosted on GitHub Pages.
Your browser talks to OpenRouter directly with **your own API key**: there is no backend, no
database, no serverless function, and no proxy.

**Live site:** https://yuliazhu16.github.io/openrouter-chat-harness/

## Use it

1. Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys). Give it a **credit limit**.
2. Open the site. Settings opens on first visit: paste the key and pick a model.
   `openrouter/free` (or any ID ending in `:free`) costs nothing but is rate-limited.
3. Chat. Multi-turn context is kept for the conversation; **Stop** cancels a request;
   errors explain what went wrong and offer **Retry**.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Chat UI, settings, OpenRouter requests, loading/Stop, readable errors, Pages deploy | ✅ built |
| 2 | Saved conversations (localStorage), New Chat, Clear History, restore on refresh | next |
| 3 | Streaming, live model list, safe Markdown subset, opt-in "remember key" | planned |
| 4 | Accessibility & mobile polish, export/import, final security review | planned |

In Phase 1 the chat lives in memory: refreshing the page keeps your key and model (for that
tab) but clears the conversation. Saving conversations is Phase 2.

## Security and limitations

This is a frontend-only app, and that has consequences you should know about:

- **Your key goes from your browser straight to OpenRouter.** This site has no server and
  never sees it, but any script running on the page could. The page uses a strict
  Content-Security-Policy (`connect-src https://openrouter.ai`, no inline scripts) and renders
  every reply as plain text, never as HTML, to keep injected script out.
- **The key is kept only for the current tab** (`sessionStorage`) and is forgotten when the tab
  closes. **Forget key** in Settings removes it immediately.
- **GitHub Pages sites share an origin.** Every project page under `<user>.github.io` is the
  same origin to the browser, so their scripts can read this app's storage. That is why the key
  is not saved on the device by default. A later opt-in "remember key" will warn about this.
- **Conversations (from Phase 2) are stored unencrypted** in this browser's `localStorage`, on
  this device only, with no sync and no backup beyond the planned export.
- **GitHub Pages cannot set security headers.** The CSP is applied with a `<meta>` tag, which
  cannot prevent framing (clickjacking).
- **Browser extensions can read any page.** No web app can defend against a malicious extension.
- If you think a key was exposed, **revoke it** at openrouter.ai/keys.

## Develop

No build step and no dependencies. Node ≥ 22 for the tests; [`just`](https://github.com/casey/just) for the recipes.

```bash
just serve        # http://localhost:8000 (ES modules need http://, not file://)
just gate         # placeholder check + secret scan + unit tests; must be green before every commit
npm test          # or: node --test "tests/**/*.test.js"
```

```
site/                    # the ONLY directory deployed
  index.html             # CSP <meta>, relative paths (served under /openrouter-chat-harness/)
  css/styles.css         # mobile-first, light/dark
  js/app.js              # wires the DOM to the modules below
  js/api.js              # request building, fetch, error mapping (pure, unit-tested)
  js/keystore.js         # key + model in sessionStorage (pure, unit-tested)
  js/render.js           # textContent-only rendering
  js/models.js           # curated model suggestions
tests/                   # node:test, zero dependencies
.github/workflows/pages.yml   # test → deploy site/ to GitHub Pages
docs/adr/                # design decisions (Architectural Deliberation Records)
```

Deployment: every push to `main` runs the secret scan and unit tests, then publishes `site/`.
One-time setup: **Settings → Pages → Source = GitHub Actions**.

## How this project is built

Design decisions are recorded as ADRs in [`docs/adr/`](docs/adr/): why the app is static and
dependency-free (0001), how keys are handled (0002), how OpenRouter is called and errors are
explained (0003), how chats are stored (0004), and how it is tested and phased (0005).
The project follows Jérémie Lumbroso's
[Human-AI Collaboration Template A](https://github.com/ADRs4AI/human-ai-collaboration-template-A)
(see [`QUICK-START.md`](QUICK-START.md) and [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md)).
