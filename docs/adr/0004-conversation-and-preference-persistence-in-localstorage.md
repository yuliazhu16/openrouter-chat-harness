<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# ADR-0004: Conversation and preference persistence in localStorage

- **Date**: 2026-11-12
- **Iteration**: 2
- **Status**: Accepted
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

---

## Decision

*Decided 2026-11-12 (Iteration 2): all recommendations accepted by yuliazhu.*

### Chosen
- **Conversations**: multiple saved conversations, auto-titled from the first user message, listed newest-first in a sidebar (drawer on mobile); New Chat starts a fresh one; each can be deleted individually. (QST-CONVERSATIONS = B)
- **Clear History**: deletes all conversations after a confirm dialog showing the count; keeps the API key and preferences. "Forget API key" lives in Settings. (QST-CLEAR-SCOPE = A)

### Also decided (proposed in Iteration 1, not objected to)
The v1 schema above with a `schema` version and `migrate()`; one key per conversation; UI-only notices stored as `role: "notice"` and filtered out before every API call; never auto-delete user data.

---

## Open Follow-ups

- [ ] Future task: Export / import conversations as a JSON file — the only backup a localStorage app can offer; Phase 4 candidate.
- [ ] Concern: same-origin pages share the ~5 MB quota as well as read access (ADR-0002); if storage-full is ever observed in practice, revisit the custom-domain option there.

---

## Action Items

- [ ] Answer QST-CONVERSATIONS and QST-CLEAR-SCOPE - Owner: yuliazhu
- [ ] Implement `storage.js` (schema v1, migrate, quota handling) with unit tests in Phase 2 - Owner: Switchboard 5.5

---

## Validation

- [ ] yuliazhu: Multiple-conversation reading of the brief (Explicitation #1) matches intent
- [ ] yuliazhu: Deletion semantics are what users of this app should expect
- [ ] Switchboard 5.5: Schema reviewed against the final answers before Phase 2 starts

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

---

## Links

- Related ADRs: ADR-0002 (shared origin, key storage), ADR-0003 (what gets sent), ADR-0005 (storage tests)
