<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# ADR-0004: Conversation and preference persistence in localStorage

- **Date**: 2026-11-12
- **Iteration**: 5
- **Status**: Implemented
- **Deciders**: yuliazhu (human), Switchboard 5.5 (Claude Opus 5.5)

**TL;DR**: Multiple conversations stored in versioned, namespaced localStorage keys (an index plus one key per conversation), restored on load, with New Chat / delete-one / Clear-all semantics and graceful handling of a full or unavailable storage.

---

## Originating Context

**Source**: Human brief, 2026-11-12 (kickoff message).

> 3. **Browser localStorage:** Chat conversations and user preferences should persist locally in the browser, without a remote database.
>
> - New Chat and Clear History functions
> - Restore saved chat history after refreshing the page
> - Save chat conversations and preferences in localStorage.

**Agency Grant**: question cards with options, recommendations, rationale, and reopening conditions; no implementation before approval.

---

## Explicitation

**What I understand**:

1. **"New Chat" and "Clear History" are two different buttons**, which only makes sense if there can be more than one conversation (otherwise both would mean "empty the screen"). That suggests multiple saved conversations, which the brief doesn't state outright → QST-CONVERSATIONS.
2. **localStorage is small, synchronous, and shared.** Roughly 5 MB per *origin* — and on `github.io` that origin is shared with your other Pages sites (ADR-0002, QST-SHARED-ORIGIN), which share that quota too. Writes can throw `QuotaExceededError`; in some private-browsing modes storage can be unavailable entirely. The app must keep working (in memory) when saving fails, and say so.
3. **Stored data outlives code versions.** A user who returns after an update will have data in the old shape, so the schema needs a version number and a migration step from day one — cheap now, painful to retrofit.
4. **What's stored is not what's sent.** Error notices, "Stopped." markers, and other UI-only items must never enter the `messages` array sent to the model (ADR-0003). The stored message type needs to keep them apart.

**Assumptions**:

- Text-only messages (no image/file attachments in v1).
- A single device: no sync between browsers (that would need a server, which is out of scope).

**Confirm**: yuliazhu — Explicitation #1 is my reading of the brief, not something it says.

---

## Questions

### QST-CONVERSATIONS: One conversation, or several saved conversations with a list?
- Status: answered
- Why asking: The brief requires both "New Chat" and "Clear History", which reads most naturally as several saved conversations — but it doesn't say whether earlier chats should be reachable again. This decides the storage schema and whether the layout needs a conversation list (a sidebar on desktop, a slide-out drawer on mobile).
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Single conversation**: only one chat exists. "New Chat" and "Clear History" both empty it (New Chat without a confirm prompt, Clear with one). Smallest UI; earlier chats are gone for good.
- **B — Multiple conversations with a list**: each chat is saved separately and titled automatically (first user message, truncated). A sidebar (a drawer on mobile) lists them newest-first; tap to reopen, delete individually. "New Chat" starts a fresh one; earlier chats stay reachable.
- **C — Multiple stored, no list in v1**: the schema stores many conversations, but the v1 UI only shows the current one; the list arrives later. Earlier chats are saved but unreachable until then.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**B — Multiple conversations with a list.** *Rationale*: It gives "New Chat" and "Clear History" distinct, intuitive meanings (Explicitation #1) and matches what users expect from every mainstream chat client. The cost is one list component plus a drawer on mobile, and the storage schema needed is the same as C's. C stores data the user can't reach, which looks like data loss. A makes "New Chat" destructive. *Confidence*: 0.75 — because this is a reading of intent, not a stated requirement. *If wrong*: if you meant the minimal reading — one chat, two ways to reset it — this flips to **A**, which is strictly less work.

**ANS:** (by yuliazhu)
B — Multiple conversations with a list (sidebar; drawer on mobile). Accepted as recommended. (Blanket acceptance given in chat, 2026-11-12: "I agree on every suggestion you brought up to each question you've been raised. Just followed what you suggested." — transcribed by Switchboard 5.5.)

---

### QST-CLEAR-SCOPE: What exactly does "Clear History" erase?
- Status: answered
- Why asking: With several conversations (QST-CONVERSATIONS B or C), "Clear History" could mean the current chat or all of them. Separately, users may expect "clear" to also remove the saved API key or their preferences. Getting this wrong deletes something the user meant to keep, and localStorage has no undo.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — All conversations; nothing else**: one confirm dialog ("Delete all N conversations? This can't be undone."), then every conversation is removed. The API key, model choice, and other preferences are kept. Separate per-conversation delete buttons (in the list) and a separate "Forget API key" in Settings.
- **B — Current conversation only**: "Clear" empties the open chat; deleting everything requires deleting each one.
- **C — Everything (factory reset)**: conversations, preferences, and the stored key all go.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**A — All conversations; nothing else.** *Rationale*: "History" names conversations, not settings, so the button should erase exactly the history. Keeping each kind of deletion separate (one chat, all chats, the key) means no button removes more than its label says, and the confirm dialog with a count guards the one irreversible bulk action. A full "Reset everything" can live at the bottom of Settings if wanted. *Confidence*: 0.8 — because the label sets the user's expectation and A matches the label. *If wrong*: if QST-CONVERSATIONS resolves to A (a single conversation), this question is moot (status → moot); if you see Clear as a privacy "panic button", this flips to **C**.

**ANS:** (by yuliazhu)
A — All conversations; nothing else (key and preferences kept; confirm dialog with count). Accepted as recommended. (Blanket acceptance given in chat, 2026-11-12 — transcribed by Switchboard 5.5.)

---

### QST-MULTI-TAB: Two tabs open on the same conversation — accept last-write-wins, or sync tabs?
- Status: answered
- Why asking: Found while implementing Phase 2 (2026-11-19). Each tab keeps its conversations in memory and rewrites a conversation's whole key when a message is added. If the same chat is continued in two tabs, the tab that writes last overwrites the other's new messages. *New* chats started in different tabs are safe (load scans every `orch:conv:*` key, so a chat dropped from the index by another tab still comes back; there is a test for this). Deletions in one tab are also not seen by the other until it reloads. The accepted decision didn't address multiple tabs.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Accept and document**: keep last-write-wins for the same conversation in two tabs. Record it in `docs/TECHNICAL-DEBT.md` and the README limitations. No code.
- **B — Live sync via the `storage` event**: other tabs get a `storage` event when one tab writes. Each tab reloads its store and redraws the sidebar and open chat when an `orch:` key changes (unless it has a request in flight, in which case it reloads after). About 20 lines in `app.js`, plus a store `reload()` and a test.
- **C — Single active tab**: a second tab shows "This app is open in another tab" and stays read-only (BroadcastChannel or a localStorage heartbeat).

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-19)
**A now, B in Phase 4.** *Rationale*: losing data needs the *same* chat to be continued in two tabs between reloads, which is rare for a personal chat client, and the index scan already prevents the more common loss (new chats in two tabs). B is the right long-term fix and is cheap, but it adds re-render-on-external-change paths. Those are better built next to Phase 4's accessibility and focus work than squeezed into Phase 2. C blocks a normal browser habit. *Confidence*: 0.7 — because how often this happens depends on how you use tabs, which I can't observe. *If wrong*: if you often keep the app open in more than one tab, this flips to **B** now.

**ANS:** (by yuliazhu)
A now, B in Phase 4 — accepted as recommended. Accept last-write-wins for the same conversation continued in two tabs; document the limitation (README + docs/TECHNICAL-DEBT.md TD-001); defer cross-tab sync via the `storage` event to Phase 4. (Given in chat, 2026-11-19 — transcribed by Switchboard 5.5.)

---

### QST-CONV-MODEL: When reopening an old conversation, should the model switch to the one it last used?
- Status: answered
- Why asking: Found while implementing Phase 2. The model is a single saved preference (`orch:prefs.model`, top-bar chip) used for every send. Each index entry records the model of the conversation's last reply, but reopening a chat does not change the selected model. So continuing yesterday's Haiku chat after starting a Sonnet chat today sends it to Sonnet. That is valid (OpenRouter allows switching models mid-conversation), but it may surprise you.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — One global model (as built)**: the chip always shows the model the next message will use, whichever chat is open. Each reply already shows the model that wrote it (under the bubble), so a switch is visible afterwards.
- **B — Per-conversation model**: opening a chat switches the chip to that chat's last model, and changing the model in Settings applies to the open chat only. New chats use the most recent choice.
- **C — Global, with a hint**: as A, but when the open chat's last reply came from a different model, the chip is marked (e.g. "openrouter/free · was haiku-5.5").

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-19)
**A — One global model (as built).** *Rationale*: it matches ADR-0003's single model picker and the requirement "persist user preferences such as the selected model" (a preference, singular). Behaviour stays predictable: what the chip shows is what is sent. The per-reply model label already makes mixed-model chats visible. *Confidence*: 0.65 — because chat clients differ here (some pin the model per chat). *If wrong*: if you switch models often and expect each chat to remember its own, this flips to **B**. It needs no schema change (`index.model` already exists).

**ANS:** (by yuliazhu)
A — One global model (as built), accepted as recommended. Reopening an older conversation does not change the selected model. (Given in chat, 2026-11-19 — transcribed by Switchboard 5.5.)

---

## Supporting Materials

### COD: proposed-storage-schema (v1)
```js
// All keys namespaced "orch:" (OpenRouter Chat Harness). Namespacing avoids
// collisions with other same-origin apps — it is NOT isolation (ADR-0002).
"orch:schema"        → 1                                  // bumped on any shape change; migrate() runs on load
"orch:prefs"         → { model: "…", rememberKey: false, theme: "system" }
"orch:index"         → [{ id, title, model, createdAt, updatedAt }]   // newest first; drives the sidebar
"orch:active"        → "<conversation id>"
"orch:conv:<id>"     → { id, messages: [
                          { role: "user"|"assistant", content: "…", ts, model? },  // sent to the API
                          { role: "notice", kind: "error"|"stopped", text: "…", ts } // UI-only, NEVER sent
                        ] }
"orch:apiKey"        → only if the user opted in (ADR-0002, QST-KEY-STORAGE)
```
One key per conversation means each new message rewrites one chat, not the entire history; the index stays small. `ts` is epoch ms. IDs are `crypto.randomUUID()`.

### NOT: failure-handling
- `localStorage` unavailable (private mode / blocked) → app runs in memory; banner: "Chats won't be saved in this browser mode."
- `QuotaExceededError` on write → the message still shows; banner: "Storage is full — delete old conversations to keep saving." Never auto-delete user data.
- Corrupt JSON in a key → that conversation is skipped with a notice, the rest load; the raw value is not deleted automatically.

### NOT: phase-2-implementation-notes (2026-11-19)
How Phase 2 (`site/js/storage.js`, tests in `tests/storage.test.js`) implements the decision above. These are choices *within* the ADR; no accepted decision changed.
- **Schema exactly as COD above** (key names, shapes, `ts` epoch ms, `crypto.randomUUID()` ids). A test asserts the exact stored layout.
- **Eager load; the index is a rebuildable cache.** Every conversation is read at load, and every `orch:conv:*` key is scanned as well as the index. Each index field (title, model, createdAt, updatedAt) is derived from the messages. So a corrupt index, or one rewritten by another tab or cut short by a storage-full error, loses no conversation. The index is still written on every change, so lazy loading can be added later without a schema change.
- **Corruption is all-or-nothing per conversation.** One malformed message means the whole conversation is skipped and reported, never trimmed and re-saved, because re-saving a trimmed copy would silently delete data. The skipped key is never rewritten. Clear History *does* delete unreadable conversations (the user asked for all of them), and the confirm dialog counts them.
- **Newer schema (`orch:schema` > 1)** → the page runs in memory and touches no stored key (e.g. a cached old `app.js` after a future upgrade). Banner explains.
- **v0 → v1 migration**: "v0" is a Phase 1 browser, which wrote nothing to localStorage, so the migration only stamps the version. ADR-0005 planned a "hand-written v0 fixture" test, but no v0 conversation shape ever existed, and inventing one would be a contrived test (Fourth Directive). The real Phase 1 → 2 data move is the **model**: it moves from `sessionStorage` (`orch:session:model`) into `orch:prefs`, and the session copy is removed only once the preference is safely saved (`keystore.handOverLegacyModel`, tested).
- **Quota**: a failed write keeps the data in memory and shows the banner. The store keeps trying, and the banner clears automatically once a write succeeds after the user deletes old chats.
- **New chat isn't saved until its first message** (no empty chats in the list). A reply that arrives after its chat was deleted is dropped (never resurrects it). Replies land in the chat they were sent from even if the user switched away.
- **Delete-one also confirms** (the ADR specified a confirm only for Clear). Both use the native `confirm()`, which works under the CSP.
- **Restored notices have no buttons stored.** The Retry / Open Settings actions are computed from the conversation's state when it is drawn. That also covers "reloaded mid-request": the chat shows "No reply yet." with Retry.

---

## Decision

*Decided 2026-11-12 (Iteration 2): all recommendations accepted by yuliazhu.*

### Chosen
- **Conversations**: multiple saved conversations, auto-titled from the first user message, listed newest-first in a sidebar (drawer on mobile); New Chat starts a fresh one; each can be deleted individually. (QST-CONVERSATIONS = B)
- **Clear History**: deletes all conversations after a confirm dialog showing the count; keeps the API key and preferences. "Forget API key" lives in Settings. (QST-CLEAR-SCOPE = A)

### Also decided (proposed in Iteration 1, not objected to)
The v1 schema above with a `schema` version and `migrate()`; one key per conversation; UI-only notices stored as `role: "notice"` and filtered out before every API call; never auto-delete user data.

### Added 2026-11-19 (Iteration 4): decisions from the Phase 2 build
- **Multiple tabs**: last-write-wins when the *same* conversation is continued in two tabs is accepted for v1. It is documented in the README limitations and `docs/TECHNICAL-DEBT.md` (TD-001), and cross-tab sync via the `storage` event is deferred to Phase 4. *Rationale*: losing data needs one chat continued in two tabs between reloads, which is rare for a personal client. The more common case (new chats in different tabs) is already safe because load scans every `orch:conv:*` key, and a test covers it. Sync adds redraw-on-external-change paths that belong with Phase 4's focus and accessibility work. *Reopen if*: two-tab loss is ever observed in practice. (QST-MULTI-TAB = A now, B in Phase 4)
- **Model per conversation**: one global model. Reopening an older conversation does not change the selected model. *Rationale*: matches ADR-0003's single model picker and the "selected model" preference. What the chip shows is always what the next message uses, and each reply already shows the model that wrote it. *Reopen if*: you find yourself switching models per chat; option B needs no schema change because `index.model` already exists. (QST-CONV-MODEL = A)

---

## Open Follow-ups

- [ ] Future task: Export / import conversations as a JSON file — the only backup a localStorage app can offer; Phase 4 candidate.
- [ ] Future task: cross-tab sync via the `storage` event (QST-MULTI-TAB, option B) — Phase 4; resolves TD-001.
- [ ] Concern: same-origin pages share the ~5 MB quota as well as read access (ADR-0002); if storage-full is ever observed in practice, revisit the custom-domain option there.

---

## Action Items

- [ ] Answer QST-CONVERSATIONS and QST-CLEAR-SCOPE - Owner: yuliazhu
- [x] Implement `storage.js` (schema v1, migrate, quota handling) with unit tests in Phase 2 - Owner: Switchboard 5.5 (2026-11-19; local, awaiting yuliazhu's review before push)
- [x] Answer QST-MULTI-TAB and QST-CONV-MODEL - Owner: yuliazhu (2026-11-19)
- [x] Run the Phase 2 manual checklist (ADR-0005) and approve the push - Owner: yuliazhu (approved 2026-11-20; deployed `dd535fc`)

---

## Validation

- [ ] yuliazhu: Multiple-conversation reading of the brief (Explicitation #1) matches intent
- [ ] yuliazhu: Deletion semantics are what users of this app should expect
- [x] Switchboard 5.5: Schema reviewed against the final answers before Phase 2 starts (2026-11-19; implemented unchanged)

**Notes**: —

---

## Iterations

### Iteration 1 (2026-11-12)
- Trigger: initial draft from the human's kickoff brief
- Contributors: Switchboard 5.5 (Claude Opus 5.5)
- Changes: two questions; proposed v1 schema and failure handling
- Outcome: Draft — awaiting answers

### Iteration 2 (2026-11-12)
- Human: yuliazhu
- AI: Switchboard 5.5 (Claude Opus 5.5)
- Outcome: Trigger: human's blanket acceptance of all recommendations in chat. Changes: both questions answered per recommendation; Decision section finalized. Status Draft → Accepted.

### Iteration 3 (2026-11-19)
- Human: yuliazhu
- AI: Switchboard 5.5 (Claude Opus 5.5)
- Outcome: Trigger: Phase 2 implementation. Changes: NOT: phase-2-implementation-notes records the choices made within the decision. Two new questions surfaced by the build (QST-MULTI-TAB, QST-CONV-MODEL), both already built as their recommended options, so no answer blocks the Phase 2 review. Status stays Accepted. It moves to Implemented once yuliazhu approves and Phase 2 is deployed.

### Iteration 4 (2026-11-19)
- Human: yuliazhu
- AI: Switchboard 5.5 (Claude Opus 5.5)
- Outcome: Trigger: yuliazhu accepted both new recommendations in chat. Changes: QST-MULTI-TAB = A now, B in Phase 4; QST-CONV-MODEL = A. Both are recorded in the Decision section with rationale and reopening conditions, and cross-tab sync was added to Open Follow-ups. No code change: both were already built as recommended. Status stays Accepted until the Phase 2 deploy is approved.

### Iteration 5 (2026-11-20)
- Human: yuliazhu
- AI: Switchboard 5.5 (Claude Opus 5.5)
- Outcome: Trigger: yuliazhu completed the local Phase 2 review ("I've verified that chat conversations are successfully restored from localStorage after refreshing the browser. I approve the current Phase 2 implementation and UI changes for deployment.") Deployed: commit `dd535fc`, Actions run 44649428848 (test ✓, deploy ✓, 48/48 unit tests on the CI runner). Live verification on https://yuliazhu16.github.io/openrouter-chat-harness/ passed 9/9 (`scripts/ephemeral/2026-11-20-live-verify.mjs`), including the real CORS round-trip from the github.io origin, restore after reload, the key absent from localStorage, layout at 1440×900 and 390×844, and no CSP violations. Status Accepted → **Implemented**. Export/import (Phase 4) and cross-tab sync (Phase 4) remain open follow-ups.

---

## Links

- Related ADRs: ADR-0002 (shared origin, key storage), ADR-0003 (what gets sent), ADR-0005 (storage tests)
