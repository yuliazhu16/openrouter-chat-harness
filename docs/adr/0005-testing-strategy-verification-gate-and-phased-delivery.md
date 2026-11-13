<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# ADR-0005: Testing strategy, verification gate, and phased delivery

- **Date**: 2026-11-12
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: yuliazhu (human), Switchboard 5.5 (Claude Opus 5.5)

**TL;DR**: Zero-dependency `node --test` unit tests for the pure modules (request building, error mapping, storage, later SSE and Markdown parsing), plus a short manual browser checklist per phase; the same tests gate both `just gate` locally and the Pages deploy in CI; delivery in four small phases, each ending in something deployed and checked.

---

## Originating Context

**Source**: Human brief, 2026-11-12 (kickoff message), and `CLAUDE.md` Third–Fifth Directives.

> 5. Propose a simple phased implementation and testing plan.
>
> Follow the repository's verification gate and commit important ADR decisions before moving forward.

From `CLAUDE.md`: regression test for every fixed bug (Third), tests must be meaningful, not contrived (Fourth), run the gate before every commit (Fifth).

**Agency Grant**: question cards with options, recommendations, rationale, and reopening conditions; no implementation before approval.

---

## Explicitation

**What I understand**:

1. **Most of this app's risk sits in a few pure functions, not in the DOM.** Building the request (does history include UI-only notices? is the key ever in a URL?), mapping errors to messages, and reading/writing/migrating stored data are deterministic and testable without a browser. If `site/js/*.js` keeps these free of DOM access at import time, Node can import them directly.
2. **Some things only a real browser can verify**: the authenticated CORS round-trip from the deployed origin, layout at phone width, focus/keyboard behavior. These go into a short manual checklist per phase — honest about what isn't automated rather than pretending.
3. **The gate already exists and is real** (`just gate`: instantiation check, registry validation, `secret-scan` — verified to fail on a planted key). Phase 1 adds the unit tests to it, so the Fifth Directive keeps naming one command.
4. **Testing storage in Node**: `storage.js` takes a Storage-shaped object as a parameter (defaulting to `window.localStorage`). Tests pass a small Map-backed implementation of the standard Web Storage interface — including one that throws `QuotaExceededError` — so the tests exercise *our* migration and quota logic, not a mock of our own code (Fourth Directive).

**Assumptions**:

- Node ≥ 22 locally and in CI (local is v24.13.0). A root `package.json` containing only `{"type": "module", "private": true}` makes Node treat `.js` as ES modules — no dependencies.

**Confirm**: yuliazhu — in particular, that a manual browser checklist (rather than automated end-to-end tests) is acceptable for v1.

---

## Questions

### QST-TEST-STACK: What test tooling does the project use?
- Status: unanswered
- Why asking: The Third–Fifth Directives require meaningful tests and a gate before every commit, while the brief says to avoid unnecessary dependencies. Test tooling is where dependencies usually creep in (test runners, fake DOMs, headless browsers), so this should be a deliberate choice.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — `node --test` unit tests + a manual browser checklist**: built into Node, zero dependencies. Unit tests cover the pure modules; each phase ends with a short manual checklist in a real browser (desktop + phone width) on the deployed URL.
- **B — A, plus Playwright end-to-end tests**: adds a `devDependency` and downloaded browser binaries (hundreds of MB in CI) to drive the real UI: type, send, refresh, see history restored — with the OpenRouter API stubbed at the network layer.
- **C — Vitest + jsdom**: a popular runner with a simulated DOM, so UI rendering code can be unit-tested too. Two dev dependencies; jsdom only approximates a browser.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**A — `node --test` unit tests + a manual browser checklist.** *Rationale*: The bugs that would actually hurt users of this app — a leaked key, notices sent as history, a migration that drops chats, a misleading error — live in the pure modules (Explicitation #1), which A covers fully with no dependencies. The DOM layer is thin enough (render with `textContent`, wire events) that a per-phase manual check catches its failures at far lower cost than B's toolchain. C's simulated DOM is exactly the "approximates reality" testing the Fourth Directive warns about. *Confidence*: 0.8 — because the module split makes A sufficient for v1; that sufficiency weakens as the UI grows. *If wrong*: if a UI regression (e.g. history not restored on refresh) escapes the manual checklist even once, this flips to **B** for that flow — and the escape gets its regression test, per the Third Directive.

**ANS:** (by yuliazhu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

### QST-DEPLOY-GATE: Must the unit tests pass in CI before the site deploys?
- Status: unanswered
- Why asking: Locally, the Fifth Directive requires `just gate` before every commit. But a commit can still reach `main` without it (another machine, a web edit, a forgotten run), and every push to `main` redeploys the public site. Gating the deploy on the tests is the last line of defense.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Tests gate the deploy in the same workflow**: `pages.yml` has a `test` job (`node --test` + the secret scan) and the `deploy` job `needs: test`. A red test means the live site stays on the last good version.
- **B — Separate CI workflow; deploy independent**: tests run in their own workflow (also on pull requests), but deploy doesn't wait for them. A failing test is visible but doesn't block publishing.
- **C — No CI tests; rely on the local gate**: simplest workflow; correctness depends entirely on running `just gate` locally.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**A — Tests gate the deploy in the same workflow.** *Rationale*: It's a few lines in the workflow sketched in ADR-0001 (COD: pages-workflow-sketch), and it means that what reaches the public URL has passed the same checks as `just gate`. The secret scan in CI matters most: it is the backstop for a key that slipped past the local gate on another machine — though at that point the key is already in git history and must be rotated, so CI limits the damage rather than preventing it. *Confidence*: 0.85 — because the cost is near zero and the failure it prevents is publishing a broken or key-leaking build. *If wrong*: if you want PR-based review with checks on pull requests, keep A and add B's PR trigger on top — the two combine; they aren't rivals.

**ANS:** (by yuliazhu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

## Supporting Materials

### DOC: phased-delivery-plan
Each phase is small, ends deployed, and ends with its checklist ticked by yuliazhu before the next one starts. Phase 3's contents depend on the answers to ADR-0002 and ADR-0003.

**Phase 0 — Decisions (now).** Answer the open questions in ADRs 0001–0005. Set Pages source = GitHub Actions. *Exit*: ADRs Accepted and committed.

**Phase 1 — Walking skeleton, deployed.**
- `site/index.html` (CSP `<meta>`, relative paths), `css/styles.css` (mobile-first), `js/app.js`, `api.js`, `keystore.js`, `render.js`.
- Settings panel: API key (sessionStorage) + model field with suggestions; first-run opens Settings.
- Send → non-streaming request → reply rendered via `textContent`; multi-turn in memory; loading indicator + Stop; mapped errors.
- `package.json` (no deps), `tests/api.test.js`, `.github/workflows/pages.yml` (test → deploy), `just gate` runs `node --test`.
- Project `README.md` with the security-limitations section.
- *Tests*: request building (history includes user/assistant only, never notices; headers correct; key never in URL), error mapping for every row of ADR-0003's table — including the **real 401 body observed by the CORS probe** as a fixture.
- *Manual checklist*: authenticated round-trip from the **deployed Pages URL** with a credit-limited key (closes ADR-0003's last unverified link); wrong key → readable 401 message; offline → network message; Stop works; usable at 375 px width.

**Phase 2 — Persistence.**
- `storage.js` (schema v1, `migrate()`, quota/unavailable handling); conversation list (sidebar / mobile drawer); New Chat; delete one; Clear History; preferences saved.
- *Tests*: save → reload (new module instance over the same storage) restores conversations and the active chat; Clear History leaves prefs and key alone; a corrupt conversation key is skipped while the rest load; `QuotaExceededError` surfaces as a status, not a crash, and no data is deleted; migrating a hand-written "v0" fixture.
- *Manual checklist*: refresh restores everything; private window shows the "won't be saved" banner; Clear asks for confirmation with the count.

**Phase 3 — UX upgrades** (scoped by answers): streaming + `sse.js` (tests: event split across chunks, comment/keep-alive lines, `[DONE]`, mid-stream error, abort keeps the partial reply); live model list from `/models` with cache + fallback; Markdown subset renderer (tests: `<script>`, `<img onerror>`, `javascript:` links all come out as inert text); opt-in "Remember key" with warning; token-usage line under replies.

**Phase 4 — Hardening & docs.** Accessibility pass (labels, focus order, `aria-live` for new replies, contrast in light/dark); mobile polish (viewport, safe-area insets, on-screen keyboard not covering the input); export/import JSON; final README security section; optional OAuth PKCE (ADR-0002, QST-OAUTH-PKCE) if un-deferred.

### COD: gate-after-phase-1
```just
gate:
    just instantiate-check
    python3 scripts/groups-lookup.py --validate
    just secret-scan
    node --test "tests/**/*.test.js"
```

---

## Decision

*Pending the answers above.* Proposed as decided unless you object: pure-module boundaries (no DOM access at import time in `api.js`, `storage.js`, `keystore.js`, `sse.js`); `tests/` lives outside `site/` and is never deployed; every fixed bug gets a regression test in a `describe('Regression tests', …)` block in that module's test file (Third Directive).

---

## Open Follow-ups

- [ ] Unverified assumption: GitHub's `ubuntu-latest` runner + `actions/setup-node` with Node 24 runs the same tests identically to local v24.13.0 — confirm on the first workflow run.
- [ ] Concern: the manual checklist depends on the human's time and a real key; keep each checklist under ~10 minutes so it actually gets run.

---

## Action Items

- [ ] Answer QST-TEST-STACK and QST-DEPLOY-GATE; approve or amend the phase plan - Owner: yuliazhu
- [ ] After approval: flip ADRs to Accepted, then start Phase 1 - Owner: Switchboard 5.5

---

## Validation

- [ ] yuliazhu: The phase boundaries and exit checklists are the right size
- [ ] yuliazhu: A manual browser checklist is acceptable for v1
- [x] Switchboard 5.5: `just gate` verified green on the instantiated template, and `secret-scan` verified red on a planted key (2026-11-12)

**Notes**: —

---

## Iterations

### Iteration 1 (2026-11-12)
- Trigger: initial draft from the human's kickoff brief (item 5: phased plan) and CLAUDE.md Third–Fifth Directives
- Contributors: Switchboard 5.5 (Claude Opus 5.5)
- Changes: two questions; four-phase delivery plan with per-phase tests and manual checklists; gate evolution
- Outcome: Draft — awaiting answers

---

## Links

- Related ADRs: ADR-0001 (workflow sketch), ADR-0002 (security tests), ADR-0003 (error table, streaming), ADR-0004 (storage tests)
- Related code: `justfile` → `gate`, `secret-scan`
