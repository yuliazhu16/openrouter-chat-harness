<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# ADR-0001: Static site architecture, repo layout, and GitHub Pages deployment

- **Date**: 2026-11-12
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: yuliazhu (human), Switchboard 5.5 (Claude Opus 5.5)

**TL;DR**: Ship a no-build, vanilla HTML/CSS/ES-module site from `site/`, deployed by the official GitHub Actions Pages flow that uploads only `site/` — nothing else in the repo is ever published.

---

## Originating Context

**Source**: Human brief, 2026-11-12 (the project kickoff message, first session).

> **Goal:** Build a simple, functional web-based AI chat interface that is publicly accessible through GitHub Pages.
>
> 1. **GitHub Pages only:** The application must be a fully static website with no backend server, database server, serverless function, or proxy.
>
> - Prefer vanilla HTML, CSS, and JavaScript for a lightweight first version, unless there is a compelling reason to use another stack.
> - Store the website in a dedicated `site/` directory.
> - Keep ADRs, Claude collaboration files, and development scripts outside the published website.
> - Use a GitHub Actions workflow to deploy only `site/` to GitHub Pages.
> - Avoid unnecessary frameworks, libraries, and dependencies.

**Agency Grant**: "Identify the key design decisions and create ADR question cards with options, recommendations, rationale, and reopening conditions … Do not start implementing the chat application until I have reviewed and approved the important design decisions."

---

## Explicitation

**What I understand**:

1. **Static-only is a hard constraint, not a preference** — no server-side anything, so every capability (auth, storage, model calls) must work from browser JS alone. That pushes complexity into ADR-0002 (keys), ADR-0003 (direct API calls), ADR-0004 (localStorage).
2. **Publication boundary = `site/`** — the repo is public (verified: `gh repo view` → `PUBLIC`), and it also contains ADRs, crew files, and scripts. Deploying only `site/` is what keeps those out of the served site. (They remain *visible in the public repo* — that is fine; nothing in them is secret, and the gate's secret-scan guards against the one thing that would be.)
3. **"Vanilla, no dependencies" is a default with an escape hatch** — "unless there is a compelling reason". I found none for v1 (see QST-STACK-BUILD).

**Assumptions**:

- The site is served from the project-pages URL `https://<user>.github.io/openrouter-chat-harness/` — i.e. under a **sub-path**, so all asset URLs must be relative (`./js/app.js`, never `/js/app.js`).
- Modern evergreen browsers only (ES modules, `fetch`, `ReadableStream`, CSS custom properties). No IE / legacy support.
- Free GitHub Pages on a public repo (no private-repo Pages plan needed).

**Confirm**: yuliazhu — especially the sub-path assumption and "evergreen browsers only".

---

## Questions

### QST-STACK-BUILD: Should `site/` be raw files served as-is, or produced by a build step?
- Status: unanswered
- Why asking: This decides the shape of everything else — how JS is split into files, whether `node_modules` ever appears, what the deploy workflow does, and whether the published files are the same files you edit. The brief prefers vanilla and no unnecessary dependencies, but a bundler is the usual escape hatch, so it should be ruled out deliberately rather than by omission.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Native ES modules, no build**: `site/index.html` loads `<script type="module" src="./js/app.js">`, which `import`s small sibling modules (`api.js`, `storage.js`, `render.js`, …). The files you edit are exactly the files served. Zero dependencies, zero build tooling; the deploy just uploads the folder.
- **B — Single self-contained `index.html`**: all CSS and JS inline in one file. Simplest possible deploy and "view source", but one growing file is hard to test (Node can't import a function out of an HTML file) and hard to review.
- **C — Bundler (e.g. Vite) building into `site/`**: gives minification, TypeScript, and an easy path to frameworks later — at the cost of `package.json` dependencies, a build step in CI, and published files that differ from source.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**A — Native ES modules, no build.** *Rationale*: Every target browser supports `<script type="module">`; the app's estimated size (a few hundred lines of JS) gains nothing measurable from bundling; and separate modules are exactly what makes the pure logic importable by `node --test` with zero dependencies (ADR-0005), which B cannot offer and C offers only by adding a toolchain. A keeps the brief's "avoid unnecessary dependencies" literally true. *Confidence*: 0.9 — because the constraint set (static, small, vanilla-preferred, testable) points one way and I verified Node 24 is available locally for the test half. *If wrong*: if we later want TypeScript or a UI framework, or if JS grows past roughly 2,000 lines and load-time becomes measurable, this flips to **C**; nothing in A blocks that migration.

**ANS:** (by yuliazhu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

### QST-DEPLOY-METHOD: Which GitHub Pages deployment mechanism publishes `site/`?
- Status: unanswered
- Why asking: The brief requires "a GitHub Actions workflow to deploy only `site/`". There are two Actions-based ways to do that, and they differ in what extra state they leave in the repo and in one manual setting you (the repo owner) must flip.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Official Pages artifact flow**: `.github/workflows/pages.yml` uses `actions/configure-pages` → `actions/upload-pages-artifact` (with `path: site`) → `actions/deploy-pages`. Runs on push to `main` (and on manual dispatch). No extra branch. **Requires one manual setting**: repo Settings → Pages → Source = "GitHub Actions".
- **B — Push to a `gh-pages` branch**: a workflow copies `site/` onto an orphan `gh-pages` branch (e.g. via `peaceiris/actions-gh-pages`), and Pages serves that branch. Works with the older "Deploy from a branch" setting, but adds a generated branch to the repo and a third-party action with write access.
- **C — Pages "deploy from branch, /docs folder"**: no workflow at all — but it only serves `/` or `/docs`, which conflicts with both the brief (`site/` + an Actions workflow) and this repo's existing `docs/` (ADRs would be published). Listed only to rule it out explicitly.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**A — Official Pages artifact flow.** *Rationale*: It is GitHub's first-party mechanism, uploads exactly the `site/` directory (the publication boundary from Explicitation #2), needs no generated branch, and uses only `actions/*` actions maintained by GitHub — smaller supply-chain surface than B. It also lets a test job gate the deploy job in the same workflow (ADR-0005, QST-DEPLOY-GATE). *Confidence*: 0.9 — because this is the documented default for custom-workflow Pages; the one cost is the manual Settings toggle, which I can do via `gh api` if you authorize it. *If wrong*: if the repo's Pages settings can't be switched to "GitHub Actions" (e.g. org policy), this flips to **B**.

**ANS:** (by yuliazhu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

## Supporting Materials

### FIL: proposed-layout
```
openrouter-chat-harness/
├── site/                      # ← the ONLY thing deployed
│   ├── index.html             # single page; CSP <meta>; relative asset URLs
│   ├── css/styles.css         # mobile-first, CSS custom properties, prefers-color-scheme
│   └── js/
│       ├── app.js             # entry: wires DOM events to the modules below
│       ├── api.js             # OpenRouter request building, fetch, error mapping (ADR-0003)
│       ├── storage.js         # localStorage schema, versioning, quota handling (ADR-0004)
│       ├── keystore.js        # API-key storage policy (ADR-0002)
│       └── render.js          # DOM rendering — textContent only (ADR-0002)
├── tests/                     # node --test; NOT deployed (ADR-0005)
├── package.json               # {"type":"module","private":true} — no dependencies
├── .github/workflows/pages.yml
├── docs/  scripts/  CLAUDE.md # collaboration substrate — NOT deployed
```

### COD: pages-workflow-sketch
```yaml
# .github/workflows/pages.yml — sketch, finalized in Phase 1
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  test:      # ADR-0005 — gate the deploy on the unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: node --test "tests/**/*.test.js"
  deploy:
    needs: test
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: site }
      - id: deployment
        uses: actions/deploy-pages@v4
```

---

## Decision

*Pending the answers above.* If both recommendations are accepted:

### Context
A static, dependency-free chat client must be published from a public repo that also holds non-published collaboration material.

### Chosen: native ES modules in `site/`, deployed by the official Pages artifact flow
**Rationale**: see the two Recommendations.
**Trade-offs accepted**: no minification (irrelevant at this size); a one-time manual Pages setting.

### Consequences
- All asset paths relative (sub-path hosting).
- `tests/` and `package.json` live at repo root, outside `site/`, so they are never published.
- Adding a framework later means revisiting QST-STACK-BUILD (flip to C), not patching around it.

---

## Open Follow-ups

- [ ] Concern: the repo's `README.md` still describes the *template*, and it is the public face of the repo. Proposed: replace it with a project README (what it is, live URL, BYOK + security limitations from ADR-0002, how to run locally) in Phase 1, keeping the template docs reachable via `QUICK-START.md` / `docs/METHODOLOGY.md`. (`README.md` is a kintsugi *stencil*, so this will register as a deliberate local adaptation — that is expected.)
- [ ] Unverified assumption: local preview via `python3 -m http.server -d site` behaves like Pages for ES modules (MIME types) — verify in Phase 1. (`file://` will NOT work: browsers block module imports from `file://`.)

---

## Action Items

- [ ] Answer QST-STACK-BUILD and QST-DEPLOY-METHOD - Owner: yuliazhu
- [ ] Set repo Settings → Pages → Source = "GitHub Actions" (or authorize Switchboard to do it via `gh api`) - Owner: yuliazhu
- [ ] Create `site/` skeleton + `pages.yml` in Phase 1 (after approval) - Owner: Switchboard 5.5

---

## Validation

- [ ] yuliazhu: Decision captured matches intent (static-only, `site/` boundary, Actions deploy)
- [ ] yuliazhu: Sub-path + evergreen-browsers assumptions are acceptable
- [x] Switchboard 5.5: Repo visibility verified PUBLIC; Node 24 + `just` available locally

**Notes**: —

---

## Iterations

### Iteration 1 (2026-11-12)
- Trigger: initial draft from the human's kickoff brief
- Contributors: Switchboard 5.5 (Claude Opus 5.5)
- Changes: framed two questions (build vs. no-build; deploy mechanism), proposed layout and workflow sketch
- Outcome: Draft — awaiting answers

---

## Glossary (optional)

- **Publication boundary**: the set of files GitHub Pages serves — here, exactly `site/`.
- **Project pages**: a Pages site served under `https://<user>.github.io/<repo>/` (a sub-path of the user's shared origin — see ADR-0002, QST-SHARED-ORIGIN).

---

## Links

- Related ADRs: ADR-0002 (security), ADR-0003 (API), ADR-0004 (storage), ADR-0005 (testing & phases)
