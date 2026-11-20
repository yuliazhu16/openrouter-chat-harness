# Reproduce the User's Path, Not a Fresh Profile

**Date**: 2026-11-20
**Authors**: Switchboard 5.5 (Claude Opus 5.5), with yuliazhu
**Topic**: A "broken layout" whose cause wasn't in the layout code, found by replaying the human's browser history instead of loading a clean page.

## The Discovery

yuliazhu opened the Phase 2 build and reported the sidebar stacked in the top-left, the chat header pushed far down, and no composer in view. They added: *"Do not assume this is merely a visual styling issue."*

Every headless render on my side was correct, and 36 browser checks were green. The tempting move was to treat the report as "make it prettier" and start restyling. The symptoms pointed elsewhere, though. A sidebar stacked *above* the chat is what the new HTML looks like with **none** of the new CSS. The headers from the local server settled it:

```
Last-Modified: Fri, 20 Nov 2026 00:01:51 GMT      ← and no Cache-Control
```

`python3 -m http.server` sends no `Cache-Control`, so Chrome caches CSS/JS by heuristic, and an ordinary reload re-checks only the HTML. The diagnosis script replayed the human's path. It loaded the Phase 1 site (files back-dated like the real ones), swapped in Phase 2, and did a normal reload:

```
A fresh        shell=grid   topbar y=0    composer bottom=900
B reload       shell=block  topbar y=249  composer y=1080   ← the reported screen
C hard reload  shell=grid   topbar y=0    composer bottom=900
```

Scenario B is the bug report, measured: Phase 2 HTML with Phase 1 CSS and JS. The CDP event even labelled those files "network 200", but the rendered result proved they were the old files.

## The Second Bug, Found on the Way

The new layout check asserted something no earlier check had: *the document is exactly the viewport's height*. It failed at 1949px. Twenty screen-reader labels ("You:", "Assistant:") were `position: absolute` with no positioned ancestor. They were positioned against the page, escaped the chat scroller's clip, and grew the document with every message. `body { overflow: hidden }` hid it on desktop. On a phone, iOS scrolls the page when the composer gets focus, which can move the header off-screen: a cousin of the original report. This had been in place since Phase 1. The fix was one line (`.chat { position: relative }`).

## Secondary Directive at Work

*Surface doubts.* The human's warning was itself a surfaced doubt, and taking it seriously meant refusing the easy reading. Then the same habit pointed outward: Pages sends `max-age=600`, so the identical mix will hit anyone who reloads within 10 minutes of the Phase 2 deploy. That most likely includes yuliazhu, checking it. This was not silently "handled". It went to ADR-0001 as QST-PAGES-CACHE, to be answered before the push.

## Lessons Learned

1. **"Works on my machine" usually means a clean profile.** Reproduce the user's *history* (what was cached, in what order, which reload), not just their URL.
2. **Read the evidence the server actually sends.** One `curl -I` turned a styling complaint into a caching mechanism.
3. **Prefer rendered content over metadata flags.** The cache flag said "network"; the computed `display: block` said "old stylesheet".
4. **Assert the invariant, not the symptom.** "Document height = viewport height" caught a bug no symptom-level check had seen, because it states what *should* be true.

## Metacognitive Insight

The fix the human asked for (a professional layout) and the fix the bug needed (cache headers) were different, and doing only the first would have *seemed* to work: a restyle would have changed `styles.css`, the next reload might have fetched it, and the "bug" would have vanished without being understood, ready to return on the first deploy. Diagnosing before designing is what kept the real cause from being papered over.
