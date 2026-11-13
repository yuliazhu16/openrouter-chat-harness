<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# ADR-0002: API key handling and frontend security posture

- **Date**: 2026-11-12
- **Iteration**: 2
- **Status**: Accepted
- **Deciders**: yuliazhu (human), Switchboard 5.5 (Claude Opus 5.5)

**TL;DR**: BYOK with the key in `sessionStorage` by default, an explicit opt-in "remember on this device" (`localStorage`) behind a warning, all model output rendered via `textContent`, and a strict CSP `<meta>` — with the github.io shared-origin limitation documented, not hidden.

---

## Originating Context

**Source**: Human brief, 2026-11-12 (kickoff message).

> - Never hardcode an OpenRouter API key.
> - Never commit API keys or credentials to GitHub.
> - Use a Bring Your Own Key approach.
> - Keep API keys in memory or sessionStorage by default. If persistent key storage is offered, make it explicit opt-in with a security warning.
> - Save chat conversations and preferences in localStorage.
> - Render model responses safely as text, not unsanitized HTML.
> - Clearly document the security limitations of a frontend-only application.

**Agency Grant**: question cards with options, recommendations, rationale, and reopening conditions; no implementation before approval.

---

## Explicitation

**What I understand**:

1. **The threat model is "the user's own key in the user's own browser."** There is no server to protect; the asset is the key (it can spend the user's OpenRouter credits). The realistic attackers are: (a) script injection into this page (XSS) — mitigated by never rendering HTML and by CSP; (b) anything else running on the same browser *origin* — see the finding below; (c) a shared/borrowed computer — mitigated by not persisting the key by default; (d) a key committed to the public repo — mitigated by the gate's `just secret-scan` (already live, verified against a planted fake key).
2. **Finding (Second Directive — surfaced doubt): GitHub Pages project sites share one origin.** Every project page you publish is served from `https://<user>.github.io/<repo>/`, and browsers scope `localStorage`/`sessionStorage` by *origin*, not path. So any other repo you publish to Pages — today or in the future — runs JavaScript that can read this app's `localStorage`, including conversations and an opted-in persisted key. Namespacing keys does not help (it's naming, not isolation). `sessionStorage` is per-tab, so it is far less exposed. This is not in the brief and changes how strong the "opt-in persistence" warning must be.
3. **"Render safely" has a UX cost.** LLM output is usually Markdown. Plain text is safe but shows `**bold**` and ``` fences raw. A safe middle exists (build DOM nodes from a tiny Markdown subset, never `innerHTML`).
4. **GitHub Pages cannot set HTTP response headers.** A Content-Security-Policy can still be applied via `<meta http-equiv>`, but `frame-ancestors` (clickjacking) and other header-only protections are unavailable — a limitation to document.

**Assumptions**:

- Users paste a key they created at openrouter.ai/keys; we encourage a dedicated key with a credit limit.
- The key is sent only to `https://openrouter.ai` (enforced by CSP `connect-src`).

**Confirm**: yuliazhu — especially finding #2: do you already publish (or plan to publish) other Pages sites under the same account?

---

## Questions

### QST-KEY-STORAGE: Where does the API key live by default, and what does opt-in persistence look like?
- Status: answered
- Why asking: The brief allows "memory or sessionStorage" as the default and makes persistence opt-in. The two defaults behave very differently on page refresh: memory-only forces re-pasting the key after every reload; sessionStorage survives reloads but is wiped when the tab closes. This choice is the main convenience-vs-exposure dial of the app.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Memory only, no persistence option**: key lives in a JS variable; every refresh or new tab asks for it again. Smallest exposure, most friction.
- **B — sessionStorage default + explicit opt-in localStorage**: key survives refresh within the tab; closing the tab forgets it. A "Remember on this device" checkbox (off by default) moves it to localStorage only after the user acknowledges a warning (shared-origin risk, shared-computer risk, use a credit-limited key). A "Forget key" button clears both stores.
- **C — sessionStorage only, no persistence option**: like B without the checkbox. Simpler and safer, but returning users re-paste the key every visit.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**B — sessionStorage default + explicit opt-in localStorage.** *Rationale*: It is the exact shape the brief describes ("sessionStorage by default … explicit opt-in with a security warning"), and the refresh case matters: requirement "restore saved chat history after refreshing" would feel broken if the key vanished on the same refresh (A). The opt-in path's risk is real (Explicitation #2) but bounded by a warning, a "Forget key" button, and the advice to use a credit-limited key. *Confidence*: 0.8 — because it matches the brief verbatim; the remaining doubt is purely about whether the shared-origin risk (QST-SHARED-ORIGIN) should remove the opt-in entirely. *If wrong*: if you answer QST-SHARED-ORIGIN with "C" (no persistent key at all), this flips to **C**.

**ANS:** (by yuliazhu)
B — sessionStorage default + explicit opt-in localStorage. Accepted as recommended. (Blanket acceptance given in chat, 2026-11-12: "I agree on every suggestion you brought up to each question you've been raised. Just followed what you suggested." — transcribed by Switchboard 5.5.)

---

### QST-SHARED-ORIGIN: How do we handle the fact that all `<user>.github.io` project pages share one origin (and one localStorage)?
- Status: answered
- Why asking: Browsers isolate storage by origin (scheme + host + port), not by path. Every repo you publish with GitHub Pages lives at `https://<user>.github.io/<repo>/` — same origin — so JavaScript on any of those pages can read this app's localStorage: saved conversations, preferences, and an opted-in persisted API key. This was not in the brief; it is the one security limitation that is specific to *this* hosting choice.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Accept and document**: keep the design; state the limitation plainly in the opt-in warning, the in-app "About security" note, and the README. Appropriate if you don't (or won't) publish untrusted code on other Pages sites under this account.
- **B — Plan a custom domain**: serve the app from its own (sub)domain (e.g. `chat.example.com` via a Pages CNAME), which gives it a private origin. Costs a domain and DNS setup; can be added later without code changes.
- **C — Remove persistent key storage entirely**: only session/memory key storage, so the worst a same-origin page can read is chat history and preferences. Conversations in localStorage remain exposed either way.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**A — Accept and document.** *Rationale*: The exposure is to *your own* other Pages sites, not to the internet at large; for a personal/course project that is an acceptable, documentable risk, and the brief explicitly asks to "clearly document the security limitations". B is the real fix and costs nothing in code, so it stays open as the upgrade path; C trades away a convenience the brief explicitly allows. *Confidence*: 0.6 — because the right answer depends on facts only you have (what else you publish on `<user>.github.io`, and whether others will use the deployed app with their own keys); that is a your-call band. *If wrong*: if you already host (or plan to host) other Pages sites with third-party scripts or user-submitted content, this flips to **C** now and **B** later.

**ANS:** (by yuliazhu)
A — Accept and document. Accepted as recommended; custom domain (B) stays the upgrade path. (Blanket acceptance given in chat, 2026-11-12 — transcribed by Switchboard 5.5.)

---

### QST-RENDERING: How are assistant messages rendered — plain text only, or a safe Markdown subset?
- Status: answered
- Why asking: The brief requires rendering model responses "safely as text, not unsanitized HTML." Plain text satisfies that trivially, but models answer in Markdown, so code blocks and lists appear as raw symbols. There are safe ways to show formatting; they cost code or dependencies.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Plain text forever**: every message goes into the DOM via `textContent` with CSS `white-space: pre-wrap`. Zero XSS surface; raw `**`, `#`, and fences visible.
- **B — Plain text in v1, then an in-house Markdown subset**: Phase 1 ships A. A later phase adds a small renderer for fenced code blocks, inline code, bold/italic, lists, and links (links restricted to `https:`), which **builds DOM nodes with `createElement` + `textContent` and never uses `innerHTML`**. No dependencies; unit-testable in Node as a token-producing parser.
- **C — Markdown library + sanitizer**: e.g. `marked` + `DOMPurify`, vendored into `site/`. Full Markdown fidelity, but adds two third-party dependencies to a security-sensitive path and contradicts "avoid unnecessary dependencies."

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**B — Plain text in v1, then an in-house Markdown subset.** *Rationale*: A literally meets the requirement and is the right Phase 1 behavior; but code blocks shown as raw fences make a chat client noticeably worse for the most common use (asking about code). A DOM-building subset keeps the "never parse model output as HTML" invariant intact — the invariant is what the brief protects, not the absence of formatting — while C imports a sanitizer whose correctness we'd be trusting rather than testing. *Confidence*: 0.7 — because the safety argument is solid, but whether formatting is worth Phase 3 time is a product call. *If wrong*: if you'd rather keep the code minimal and the invariant trivially auditable, this flips to **A**; if full Markdown (tables, nested lists) turns out to matter, to **C**.

**ANS:** (by yuliazhu)
B — Plain text in v1, then an in-house Markdown subset (DOM-building, never innerHTML). Accepted as recommended. (Blanket acceptance given in chat, 2026-11-12 — transcribed by Switchboard 5.5.)

---

## Supporting Materials

### COD: proposed-csp-meta
```html
<!-- site/index.html — Pages can't send headers, so CSP rides in a <meta>. -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               script-src 'self';
               style-src 'self';
               img-src 'self' data:;
               connect-src https://openrouter.ai;
               base-uri 'none';
               form-action 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
```
`connect-src https://openrouter.ai` means even a successful injection could not `fetch()` the key to another host (it could still exfiltrate via navigation — CSP in `<meta>` is defense-in-depth, not a guarantee). No inline scripts or styles anywhere, so no `'unsafe-inline'`.

### DOC: security-limitations-to-document (README + in-app "About security")
1. Your key is sent from your browser straight to OpenRouter; this site has no server and never sees it — but any script running on this page could.
2. By default the key is kept only for this tab (sessionStorage). "Remember on this device" stores it in localStorage, readable by any page on the same `github.io` origin and by anyone with access to this browser profile.
3. Conversations are stored unencrypted in localStorage on this device.
4. Use a dedicated OpenRouter key with a credit limit; revoke it at openrouter.ai/keys if in doubt.
5. GitHub Pages cannot set security headers; CSP is applied via `<meta>` and does not cover clickjacking (`frame-ancestors`).

---

## Decision

*Decided 2026-11-12 (Iteration 2): all recommendations accepted by yuliazhu.*

### Chosen
- **Key storage**: sessionStorage by default; "Remember on this device" (localStorage) is an explicit, off-by-default opt-in behind a warning naming the shared-origin and shared-computer risks; "Forget key" clears both stores. (QST-KEY-STORAGE = B)
- **Shared origin**: accepted and documented — in the opt-in warning, the in-app "About security" note, and the README; a custom domain is the upgrade path. (QST-SHARED-ORIGIN = A)
- **Rendering**: `textContent` only in Phase 1; an in-house, DOM-building Markdown subset (never `innerHTML`, `https:`-only links) in Phase 3. (QST-RENDERING = B)
- **Key acquisition**: paste-a-key only; OAuth PKCE reconsidered in Phase 4 if others use the public site. (QST-OAUTH-PKCE = A)

### Also decided (uncontroversial, proposed in Iteration 1, not objected to)
- No key in source, config, or URL ever; the key is never logged and never placed in a URL query string.
- `textContent`-only rendering in Phase 1 (common ground of every option in QST-RENDERING).
- CSP `<meta>` as in COD: proposed-csp-meta.
- `just secret-scan` in the gate (live since `91f51ec`).

---

## Open Follow-ups

### QST-OAUTH-PKCE: Should the app also offer "Connect with OpenRouter" (OAuth PKCE) instead of pasting a key?
- Status: answered — un-deferred early by the human's blanket acceptance (2026-11-12); reopen for B in Phase 4 if others use the site
- Why deferring: OpenRouter documents a PKCE flow for browser apps: redirect the user to openrouter.ai, they approve, and the app exchanges the returned code for a user-owned API key — no backend needed, and it is still BYOK (the user's account, the user's credits). It would remove copy-paste friction, but it adds a redirect round-trip and a third flow to test. Unverified: that the key-exchange endpoint answers CORS like the chat endpoint does (the probe in `scripts/ephemeral/2026-11-12-cors-preflight-probe.sh` did not cover it).
- Need: pick a letter (or override — any shape answers), when un-deferred

Options:
- **A — Paste-a-key only**: the Settings panel takes a pasted key; nothing else. What the brief specifies.
- **B — Paste-a-key plus "Connect with OpenRouter"**: keep pasting as the fallback, add the PKCE button as the friendlier primary path; the resulting key follows the same storage policy as QST-KEY-STORAGE.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**A — Paste-a-key only, for now.** *Rationale*: The brief asks for BYOK via a Settings panel and nothing more; PKCE is an enhancement whose key endpoint's CORS behavior I have not verified. *Confidence*: 0.75 — because v1 scope is clear, while the value of B depends on who ends up using the deployed app. *If wrong*: if people other than you will use the public site (copy-pasting keys is the most error-prone onboarding step), this flips to **B** in Phase 4 — after a CORS probe of the exchange endpoint.

**ANS:** (by yuliazhu)
A — Paste-a-key only, for now. Accepted as recommended; reopen for B in Phase 4 if others use the public site. (Blanket acceptance given in chat, 2026-11-12 — transcribed by Switchboard 5.5.)

---

- [ ] Concern: a malicious browser extension can read any page's storage — out of scope for any web app; mention in the docs, do not try to mitigate.

---

## Action Items

- [ ] Answer QST-KEY-STORAGE, QST-SHARED-ORIGIN, QST-RENDERING - Owner: yuliazhu
- [ ] Implement `keystore.js` + Settings panel per the answers (Phase 1/3) - Owner: Switchboard 5.5
- [ ] Write the security-limitations section of the README and the in-app note (Phase 1, finalized Phase 4) - Owner: Switchboard 5.5

---

## Validation

- [ ] yuliazhu: The threat model in Explicitation #1 matches how you expect the app to be used
- [ ] yuliazhu: The shared-origin limitation is understood and the chosen handling is acceptable
- [x] Switchboard 5.5: secret-scan verified to fail on a planted key-shaped string and pass on the clean tree (2026-11-12)

**Notes**: —

---

## Iterations

### Iteration 1 (2026-11-12)
- Trigger: initial draft from the human's kickoff brief
- Contributors: Switchboard 5.5 (Claude Opus 5.5)
- Changes: three open questions + one deferred; surfaced the github.io shared-origin finding; proposed CSP and the limitations text
- Outcome: Draft — awaiting answers

### Iteration 2 (2026-11-12)
- Human: yuliazhu
- AI: Switchboard 5.5 (Claude Opus 5.5)
- Outcome: Trigger: human's blanket acceptance of all recommendations in chat. Changes: all four questions answered per recommendation (incl. the deferred QST-OAUTH-PKCE → A for now); Decision section finalized. Status Draft → Accepted.

---

## Glossary (optional)

- **BYOK**: Bring Your Own Key — each user supplies their own OpenRouter key; the app ships with none.
- **Origin**: scheme + host + port; the unit browsers use to isolate storage and scripts. Paths do not create separate origins.

---

## Links

- Related ADRs: ADR-0001 (hosting), ADR-0003 (where the key is sent), ADR-0004 (what else is in localStorage)
- Related code: `justfile` → `secret-scan` recipe
