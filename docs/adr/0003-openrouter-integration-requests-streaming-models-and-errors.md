<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# ADR-0003: OpenRouter integration — requests, streaming, models, and errors

- **Date**: 2026-11-12
- **Iteration**: 2
- **Status**: Accepted
- **Deciders**: yuliazhu (human), Switchboard 5.5 (Claude Opus 5.5)

**TL;DR**: The browser POSTs directly to `https://openrouter.ai/api/v1/chat/completions` (CORS verified: preflight and error responses both carry `Access-Control-Allow-Origin: *`); v1 is non-streaming with an abortable loading state, the model is a free-text field with suggestions, and every failure maps to a human-readable message.

---

## Originating Context

**Source**: Human brief, 2026-11-12 (kickoff message); evidence: `scripts/ephemeral/2026-11-12-cors-preflight-probe.sh` (commit `chore: script for probing OpenRouter CORS…`).

> 2. **OpenRouter API via frontend CORS:** The browser should directly call the OpenRouter Chat Completions API using `fetch()` and an API key supplied by the user.
>
> - Support multi-turn conversations with message history
> - Select or enter an OpenRouter model ID
> - Loading indicators and useful API error messages
> - Validate that direct browser requests work with OpenRouter's CORS policy.

**Agency Grant**: question cards with options, recommendations, rationale, and reopening conditions; no implementation before approval.

---

## Explicitation

**What I understand**:

1. **CORS is validated at the protocol level** (probe run 2026-11-12, keyless, generic origin `https://example.github.io`):
   - `OPTIONS /api/v1/chat/completions` → **204**, `access-control-allow-origin: *`, allowed headers include `Authorization`, `Content-Type`, `HTTP-Referer`, `X-Title`, `X-Openrouter-Title`.
   - Unauthenticated `POST` → **401 with `access-control-allow-origin: *`** and JSON body `{"error":{"message":"No cookie auth credentials found","code":401}}`. So **error statuses and bodies are readable from page JS** — "useful API error messages" is achievable. But the raw message is misleading for a BYOK app → we must map it.
   - `GET /api/v1/models` → **200** with `access-control-allow-origin: *` → a keyless model list is feasible.
   - **Not yet verified**: an authenticated round-trip and SSE streaming *from a real browser tab on the deployed Pages URL*. That is the first manual check of Phase 1 (ADR-0005).
2. **`ACAO: *` means no cookies** — fine, we authenticate with `Authorization: Bearer`, and `fetch` must use the default `credentials: 'same-origin'` (never `'include'`, which `*` forbids).
3. **"Multi-turn" means we resend history** — the Chat Completions API is stateless; every request carries the prior `messages`. Long chats therefore grow in cost and can exceed a model's context window.
4. **Attribution headers are optional and harmless** — `HTTP-Referer` (the app URL) and `X-Title` ("OpenRouter Chat Harness") let OpenRouter attribute usage to the app; both are CORS-allowed.

**Assumptions**:

- OpenAI-compatible request/response shape: `{model, messages[, stream]}` → `choices[0].message.content`, plus `usage`.
- Error bodies follow `{error: {code, message, metadata?}}` (observed for 401; other codes per OpenRouter's docs — verify as they occur).

**Confirm**: yuliazhu — and note the one remaining unverified link (authenticated browser round-trip) is scheduled, not assumed.

---

## Questions

### QST-STREAMING: Should v1 stream responses token-by-token, or wait for the complete reply?
- Status: answered
- Why asking: Streaming (Server-Sent Events, `stream: true`) makes a chat app feel fast, because text appears as it is generated; without it the user sees only a loading indicator until the whole answer arrives, which can take 10–60 s for long answers or reasoning models. Streaming costs more code (an SSE line parser over `ReadableStream`, partial-message state, mid-stream errors). The brief asks for a "simple first version" with "loading indicators".
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Non-streaming in v1, streaming in Phase 3**: one `fetch`, one JSON response, a typing indicator, and a Stop button (`AbortController`). Streaming arrives later as a contained upgrade of `api.js` + the message renderer.
- **B — Streaming from v1**: SSE from the start; the loading indicator becomes "waiting for first token", then text grows in place. A Stop button aborts the stream and keeps the partial reply.
- **C — Non-streaming only**: never stream; keep the code minimal permanently.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**A — Non-streaming in v1, streaming in Phase 3.** *Rationale*: The brief's minimum features (loading indicators, error messages, multi-turn) are all fully met by A, and A gives Phase 1 a single, easy-to-debug request path for the one unverified link — the first authenticated browser round-trip. Streaming is then an isolated upgrade with its own pure, unit-testable SSE parser (ADR-0005), rather than a variable in the first deploy. C gives up the single biggest UX improvement for a chat client. *Confidence*: 0.65 — because this is a sequencing judgment; if perceived latency matters to you from day one, B is perfectly reasonable. *If wrong*: if early use shows multi-second blank waits are common (reasoning models, long answers), this flips to **B** — i.e. pull Phase 3's streaming forward.

**ANS:** (by yuliazhu)
A — Non-streaming in v1, streaming in Phase 3. Accepted as recommended. (Blanket acceptance given in chat, 2026-11-12: "I agree on every suggestion you brought up to each question you've been raised. Just followed what you suggested." — transcribed by Switchboard 5.5.)

---

### QST-MODEL-PICKER: How does the user choose a model?
- Status: answered
- Why asking: The brief says "select or enter an OpenRouter model ID". OpenRouter's catalog is large and changes often, so a hard-coded dropdown goes stale; a free-text field alone makes users look IDs up elsewhere. The probe confirmed `GET /api/v1/models` is public and CORS-enabled, so a live list is possible without a key.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Free-text input only**: user types or pastes an ID like `anthropic/claude-sonnet-4.5`. Always current; no help.
- **B — Free-text input + a short curated suggestion list**: an `<input list>` with a `<datalist>` of ~6–10 hand-picked IDs (a mix of free and paid) in one constant in `site/js/`. Users can still type any ID. The list may slowly go stale.
- **C — Free-text input + live suggestions from `/api/v1/models`**: the same `<datalist>`, filled from the public models endpoint, cached in localStorage for ~24 h, falling back to the curated list (B) if the fetch fails. Can show `(free)` tags and context length.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**B in Phase 1, upgraded to C in Phase 3.** *Rationale*: Free-text keeps "enter any ID" true in every option, and the `<datalist>` gives "select" behavior natively (works on mobile) at no dependency cost. Shipping B first keeps Phase 1's network surface to the single chat endpoint; C is a contained follow-on whose CORS feasibility is already verified (probe #3). *Confidence*: 0.75 — because every option preserves the requirement; the only question is how much help to give, and when. *If wrong*: if the curated list is stale before Phase 3 or users mostly want to browse models, this flips to **C** immediately.

**ANS:** (by yuliazhu)
B in Phase 1 (free-text + curated datalist), upgraded to C (live /models suggestions) in Phase 3. Accepted as recommended. (Blanket acceptance given in chat, 2026-11-12 — transcribed by Switchboard 5.5.)

---

### QST-DEFAULT-MODEL: Which model is used before the user picks one?
- Status: answered
- Why asking: First-run behavior has cost consequences for whoever's key is in use. OpenRouter's `openrouter/auto` picks a model per prompt (can be a paid, expensive one). Free model IDs (`…:free`) cost nothing but are rate-limited, and the free lineup changes, so a hard-coded free default can break silently. A brand-new key with $0 credit gets a 402 on paid models.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — `openrouter/auto`**: never goes stale; the response's `model` field shows which model answered; spending is unpredictable.
- **B — A hard-coded free model**: zero cost on first run; will need updating when that free model is retired (the error mapper would explain "model unavailable, pick another").
- **C — No default; first run asks for key and model together**: the Settings panel opens on first visit with the key field and the model field (with suggestions, free ones marked); Send is disabled until both are set.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**C — No default; first run asks for key and model together.** *Rationale*: First run must already open Settings for the key (BYOK, ADR-0002), so asking for a model in the same panel adds one field, not one step — and it avoids both failure modes: surprise spending (A) and a silently stale default (B). Suggestions from QST-MODEL-PICKER make the choice one tap. *Confidence*: 0.65 — because it trades a sliver of first-run friction for predictability, and how you weigh that depends on who will use the public site. *If wrong*: if first-run testing shows people stall on the model field, this flips to **B** with the model field pre-filled from the free suggestions.

**ANS:** (by yuliazhu)
C — No default; first run asks for key and model together. Accepted as recommended. (Blanket acceptance given in chat, 2026-11-12 — transcribed by Switchboard 5.5.)

---

### QST-HISTORY-LIMIT: How much conversation history is sent with each request?
- Status: answered
- Why asking: The API is stateless, so multi-turn works by resending prior messages every time. Sending everything is simplest and most faithful, but each turn gets more expensive, and a long chat will eventually exceed the model's context window (the API returns a 400 error).
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Send the full history; explain the overflow error**: no truncation. When the context limit is hit, the error mapper says "This conversation is too long for the selected model — start a New Chat or choose a model with a larger context."
- **B — Send the last N messages (setting, default e.g. 20)**: bounded cost; the model silently "forgets" early turns, which surprises users unless the UI marks the cut.
- **C — Token-budget truncation**: estimate tokens (~4 chars/token) against the model's `context_length` from `/models` and drop the oldest turns to fit. Most automatic, most code, and only approximate.

**Recommendation**: (by Switchboard 5.5, Claude Opus 5.5, 2026-11-12)

**A — Send the full history; explain the overflow error.** *Rationale*: It is the only option where what the user sees is exactly what the model sees — no invisible forgetting — and the failure is loud and explained, not silent. Typical personal chats stay far below modern context windows (commonly 128k+ tokens). B and C add a correctness surprise to save cost the user can already control with New Chat. *Confidence*: 0.7 — because cost sensitivity varies per user and per model. *If wrong*: if per-turn costs on long chats become noticeable in real use, this flips to **B** (with a visible "earlier messages not sent" marker).

**ANS:** (by yuliazhu)
A — Send the full history; explain the overflow error. Accepted as recommended. (Blanket acceptance given in chat, 2026-11-12 — transcribed by Switchboard 5.5.)

---

## Supporting Materials

### API: chat-completion
**Request:**
```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <user's key — from keystore.js, never hardcoded>
Content-Type: application/json
HTTP-Referer: <location.origin + location.pathname>
X-Title: OpenRouter Chat Harness

{"model": "<chosen id>", "messages": [{"role": "user", "content": "…"}, {"role": "assistant", "content": "…"}, …]}
```

**Response (success, abridged):**
```json
{"id": "gen-…", "model": "<model that answered>",
 "choices": [{"message": {"role": "assistant", "content": "…"}, "finish_reason": "stop"}],
 "usage": {"prompt_tokens": 12, "completion_tokens": 34, "total_tokens": 46}}
```

### COD: error-mapping-table (proposed; implemented in `api.js`, unit-tested)
| Condition | Shown to user |
|---|---|
| `fetch` throws (offline, DNS, blocked by extension/CSP) | "Couldn't reach OpenRouter. Check your connection (or a blocking extension) and try again." |
| User pressed Stop (`AbortError`) | "Stopped." (not styled as an error) |
| 400 | "OpenRouter rejected the request: ‹message›" — with the context-overflow wording from QST-HISTORY-LIMIT when the message indicates length |
| 401 | "Your API key is missing or invalid. Open Settings to check it." (the raw "No cookie auth credentials found" is never shown) |
| 402 | "Your OpenRouter account is out of credits. Add credits or choose a free (`:free`) model." |
| 403 | "The request was blocked by moderation: ‹message›" |
| 404 | "Model ‹id› wasn't found or has no available provider. Pick another model in Settings." |
| 408 / 504 | "The model took too long to respond. Try again." |
| 429 | "Rate limited. Wait a moment and try again (free models have tight limits)." |
| 5xx | "The model provider had a problem (‹code›). Try again or switch models." |
| 200 but no `choices[0].message.content` / an `error` object in the body | "The model returned an empty or error response: ‹message›" |
| `finish_reason: "length"` | reply shown, plus a note: "Reply was cut off (length limit)." |

Unknown shapes fall back to "Unexpected response (HTTP ‹status›)" plus the raw `error.message` as *text*. The key is never included in any message or log.

---

## Decision

*Decided 2026-11-12 (Iteration 2): all recommendations accepted by yuliazhu.*

### Chosen
- **Streaming**: non-streaming in Phase 1 (loading indicator + Stop via `AbortController`); SSE streaming in Phase 3. (QST-STREAMING = A)
- **Model picker**: free-text `<input list>` + a curated `<datalist>` in Phase 1; live suggestions from `/api/v1/models` (24 h cache, curated fallback) in Phase 3. (QST-MODEL-PICKER = B → C)
- **Default model**: none — first run opens Settings for key + model together; Send disabled until both are set. (QST-DEFAULT-MODEL = C)
- **History**: full history sent each turn; context overflow mapped to a clear "start a New Chat or pick a larger-context model" message. (QST-HISTORY-LIMIT = A)

### Also decided (proposed in Iteration 1, not objected to)
Direct `fetch` (no proxy — CORS verified); default `credentials` mode; `HTTP-Referer` + `X-Title` attribution headers; the error table above; one request in flight per conversation (Send disabled while waiting; Stop enabled).

---

## Open Follow-ups

- [ ] Unverified assumption: an authenticated round-trip from the deployed Pages URL succeeds — first manual check of Phase 1 (ADR-0005).
- [ ] Unverified assumption: OpenRouter error codes other than 401 match the table — refine the table as real errors are observed (and add regression tests per the Third Directive).
- [ ] Future task: optional system prompt and temperature in Settings — not in the brief; not planned unless asked.
- [ ] Future task: show `usage` tokens (and model that answered) under each reply — cheap, useful for cost awareness; Phase 3 candidate.

---

## Action Items

- [ ] Answer QST-STREAMING, QST-MODEL-PICKER, QST-DEFAULT-MODEL, QST-HISTORY-LIMIT - Owner: yuliazhu
- [ ] Implement `api.js` (request builder, sender, error mapper) with unit tests in Phase 1 - Owner: Switchboard 5.5
- [ ] Run the authenticated browser round-trip on the deployed site with a credit-limited key - Owner: yuliazhu (the key is yours; Switchboard never handles it)

---

## Validation

- [ ] yuliazhu: The error wording is the tone you want users to see
- [ ] yuliazhu: The remaining unverified link (authenticated round-trip) is acceptable to verify in Phase 1
- [x] Switchboard 5.5: CORS preflight, readable 401 error, and public `/models` verified by probe (2026-11-12)

**Notes**: —

---

## Iterations

### Iteration 1 (2026-11-12)
- Trigger: initial draft from the human's kickoff brief + the CORS probe results
- Contributors: Switchboard 5.5 (Claude Opus 5.5)
- Changes: four questions; request shape; proposed error-mapping table
- Outcome: Draft — awaiting answers

### Iteration 2 (2026-11-12)
- Human: yuliazhu
- AI: Switchboard 5.5 (Claude Opus 5.5)
- Outcome: Trigger: human's blanket acceptance of all recommendations in chat. Changes: all four questions answered per recommendation; Decision section finalized. Status Draft → Accepted.

---

## Glossary (optional)

- **SSE**: Server-Sent Events — the `text/event-stream` format OpenRouter uses when `stream: true`; read in the browser via `response.body.getReader()`.
- **Preflight**: the browser's automatic `OPTIONS` request before a cross-origin request with custom headers (like `Authorization`).

---

## Links

- Related ADRs: ADR-0002 (key storage, CSP `connect-src`), ADR-0004 (what history is stored), ADR-0005 (tests for `api.js`)
- Related code: `scripts/ephemeral/2026-11-12-cors-preflight-probe.sh`
