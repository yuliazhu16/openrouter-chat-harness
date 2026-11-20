# Technical Debt

Architectural issues, workarounds, and compromises found during development (see CLAUDE.md → Technical Debt Tracking).

---

## TD-001: Same conversation continued in two tabs — last write wins

- **Found**: 2026-11-19, Phase 2 (Switchboard 5.5)
- **Location**: `site/js/storage.js` → `append()` rewrites the whole `orch:conv:<id>` value from the tab's in-memory copy; `site/js/app.js` has no `storage`-event listener.
- **Impact**: if one chat is continued in tab A and then in tab B before B reloads, B's write overwrites A's new messages. Deletions in one tab aren't seen by the other until reload, and a reply landing in the other tab can re-save a deleted chat. New chats in different tabs are **not** affected (load scans all `orch:conv:*` keys; covered by a test).
- **Workaround**: none in code; documented in the README limitations.
- **Fix**: listen for `storage` events on `orch:` keys and reload the store and redraw (deferring while a request is in flight); see ADR-0004 QST-MULTI-TAB option B.
- **Priority**: Low (Phase 4 candidate), pending the answer to QST-MULTI-TAB.

## TD-002: Model chip truncates heavily on phones

- **Found**: 2026-11-19, Phase 2 (Switchboard 5.5)
- **Location**: `site/css/styles.css` → `.topbar` (≤ 480px). Phase 2 added the drawer toggle and New-chat buttons to the top bar.
- **Impact**: at 390px the chip shows `openroute…`; long model IDs are unreadable without opening Settings. Layout is correct (no overflow, no zoom-out).
- **Workaround**: tap the chip → Settings shows the full ID.
- **Fix**: shorten the brand to an icon at narrow widths, or show only the part after `/` in the chip.
- **Priority**: Low — Phase 4 mobile polish.
