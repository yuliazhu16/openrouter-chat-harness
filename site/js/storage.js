// Saved conversations and preferences in localStorage (ADR-0004, schema v1).
//
// PURE MODULE (no DOM): tests/storage.test.js passes its own Storage-shaped object.
//
// Keys (ADR-0004, COD: proposed-storage-schema). The "orch:" prefix is naming, not
// isolation: every <user>.github.io page shares this origin (ADR-0002), so this module
// only ever reads, writes, or deletes keys under its own prefix.
//
//   orch:schema     → "1"
//   orch:prefs      → { model, rememberKey, theme }
//   orch:index      → [{ id, title, model, createdAt, updatedAt }]   newest first
//   orch:active     → "<conversation id>"
//   orch:conv:<id>  → { id, messages: [{ role: "user"|"assistant", content, ts, model? }
//                                       | { role: "notice", kind, text, ts }] }   notices are UI-only
//
// Implementation choices within the ADR (recorded in ADR-0004, Iteration 3):
//  - All conversations are read at load. The index is written on every change (so the
//    sidebar shape exists in storage), but on load it is treated as a rebuildable cache:
//    every orch:conv:* key is also scanned, so a conversation whose index write failed
//    (storage full, or another tab rewrote the index) is never lost.
//  - Failure handling (ADR-0004, NOT: failure-handling): storage unavailable → run in
//    memory; QuotaExceededError → keep the data in memory and report 'quota'; a
//    conversation that can't be parsed → skip it, report it, never delete or rewrite it.
//    Data from a NEWER schema version → don't touch storage at all (see load()).

export const SCHEMA_VERSION = 1;

const SCHEMA_KEY = 'orch:schema';
const PREFS_KEY = 'orch:prefs';
const INDEX_KEY = 'orch:index';
const ACTIVE_KEY = 'orch:active';
const CONV_PREFIX = 'orch:conv:';

export const DEFAULT_PREFS = Object.freeze({ model: '', rememberKey: false, theme: 'system' });

const TITLE_MAX = 60;
const UNTITLED = 'New chat';

/**
 * Migrations from version N to N+1, run in order on load. Each receives raw-storage helpers.
 * 0 → 1: "version 0" is a Phase 1 browser. Phase 1 kept the key and model in sessionStorage
 * and wrote NOTHING to localStorage, so there is no conversation data to reshape; stamping the
 * version is the whole migration. (The model's move from sessionStorage to prefs crosses
 * storages, so keystore.handOverLegacyModel() does it — see app.js.)
 */
const MIGRATIONS = {
  0: () => {},
};

/**
 * @param {object} [options]
 * @param {Storage|null} [options.storage]  a Web Storage object; defaults to window.localStorage
 * @param {() => string} [options.newId]    conversation id factory; defaults to crypto.randomUUID
 */
export function createChatStore({ storage = defaultLocalStorage(), newId = () => crypto.randomUUID() } = {}) {
  /** The Storage we persist to, or null when running in memory only. */
  let backend = isUsable(storage) ? storage : null;
  /** null | 'unavailable' | 'quota' | 'newer-schema' — what the UI should tell the user. */
  let problem = backend ? null : 'unavailable';
  /** id → { id, messages } for every readable conversation. The in-memory source of truth. */
  const conversations = new Map();
  /** Ids of stored conversations that could not be read. Left untouched in storage. */
  const unreadable = [];
  let prefs = { ...DEFAULT_PREFS };
  let activeId = null;

  // --- raw storage access: every call is guarded, because any of them can throw ---

  const read = (name) => {
    if (!backend) return null;
    try {
      return backend.getItem(name);
    } catch {
      goMemoryOnly('unavailable');
      return null;
    }
  };

  /** Returns true if the value reached storage. */
  const write = (name, value) => {
    if (!backend) return false;
    try {
      backend.setItem(name, value);
      return true;
    } catch (err) {
      if (isQuotaError(err)) return false; // keep the backend: deleting chats can free space
      goMemoryOnly('unavailable');
      return false;
    }
  };

  const remove = (name) => {
    if (!backend) return false;
    try {
      backend.removeItem(name);
      return true;
    } catch {
      goMemoryOnly('unavailable');
      return false;
    }
  };

  const storedKeys = () => {
    if (!backend) return [];
    const keys = [];
    try {
      for (let i = 0; i < backend.length; i += 1) {
        const key = backend.key(i);
        if (key !== null) keys.push(key);
      }
    } catch {
      goMemoryOnly('unavailable');
    }
    return keys;
  };

  function goMemoryOnly(reason) {
    backend = null;
    problem = reason;
  }

  /** Run a group of writes and record whether they all landed. Returns true on full success. */
  function persist(...writes) {
    if (!backend) return false;
    const ok = writes.map((fn) => fn()).every(Boolean);
    if (backend) {
      if (!ok) problem = 'quota';
      else if (problem === 'quota') problem = null; // space was freed and saving works again
    }
    return ok;
  }

  // --- load ---

  function load() {
    if (!backend) return;

    const rawVersion = read(SCHEMA_KEY);
    const version = rawVersion === null ? 0 : Number(rawVersion);
    if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) {
      // Written by a newer release (e.g. a cached old app.js after an update), or not ours
      // to interpret. Reading it could misread it and writing could destroy it, so this
      // page view runs in memory and leaves every stored key exactly as it was.
      goMemoryOnly('newer-schema');
      return;
    }
    for (let v = version; v < SCHEMA_VERSION; v += 1) MIGRATIONS[v]({ read, write, remove, storedKeys });
    if (version < SCHEMA_VERSION) write(SCHEMA_KEY, String(SCHEMA_VERSION));

    prefs = parsePrefs(read(PREFS_KEY));

    const ids = new Set();
    const index = parseJson(read(INDEX_KEY));
    if (Array.isArray(index)) {
      for (const entry of index) if (typeof entry?.id === 'string' && entry.id) ids.add(entry.id);
    }
    for (const key of storedKeys()) {
      if (key.startsWith(CONV_PREFIX) && key.length > CONV_PREFIX.length) ids.add(key.slice(CONV_PREFIX.length));
    }
    for (const id of ids) {
      const raw = read(CONV_PREFIX + id);
      if (raw === null) continue; // listed in the index but deleted (e.g. by another tab)
      const conversation = parseConversation(raw, id);
      if (conversation === null) unreadable.push(id);
      else if (conversation.messages.length > 0) conversations.set(id, conversation);
    }

    const storedActive = read(ACTIVE_KEY);
    activeId = storedActive && conversations.has(storedActive) ? storedActive : null;
  }

  // --- writes of our own records ---

  const writeConversation = (conversation) => () =>
    write(CONV_PREFIX + conversation.id, JSON.stringify({ id: conversation.id, messages: conversation.messages }));
  const writeIndex = () => write(INDEX_KEY, JSON.stringify(list()));
  const writeActive = () => (activeId === null ? remove(ACTIVE_KEY) : write(ACTIVE_KEY, activeId));

  function list() {
    return [...conversations.values()].map(summarize).sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  }

  load();

  return {
    /** True while changes are being saved to localStorage (they may still fail with 'quota'). */
    get persistent() {
      return backend !== null;
    },
    /** null, or why saving isn't working: 'unavailable' | 'quota' | 'newer-schema'. */
    get problem() {
      return problem;
    },
    /** Ids of saved conversations that couldn't be read (skipped, left in storage untouched). */
    get unreadable() {
      return [...unreadable];
    },

    /** Sidebar entries, newest first. */
    list,

    has: (id) => conversations.has(id),

    /** A copy of one conversation, or null. */
    get(id) {
      const conversation = conversations.get(id);
      return conversation ? { ...summarize(conversation), messages: conversation.messages.map((m) => ({ ...m })) } : null;
    },

    /** Start a conversation with its first message. Returns { id, saved }. */
    create(message) {
      const id = newId();
      const conversation = { id, messages: [{ ...message }] };
      conversations.set(id, conversation);
      activeId = id;
      const saved = persist(writeConversation(conversation), writeIndex, writeActive);
      return { id, saved };
    },

    /**
     * Add a message to an existing conversation. Returns { saved }, or null when the
     * conversation no longer exists (e.g. deleted while its reply was on the way) — a
     * late reply must never resurrect a deleted chat.
     */
    append(id, message) {
      const conversation = conversations.get(id);
      if (!conversation) return null;
      conversation.messages.push({ ...message });
      return { saved: persist(writeConversation(conversation), writeIndex) };
    },

    get activeId() {
      return activeId;
    },

    /** Remember which conversation is open (null = a fresh, not-yet-saved chat). */
    setActive(id) {
      activeId = id !== null && conversations.has(id) ? id : null;
      return persist(writeActive);
    },

    /** Delete one conversation. */
    remove(id) {
      if (!conversations.delete(id)) return false;
      if (activeId === id) activeId = null;
      return persist(() => remove(CONV_PREFIX + id), writeIndex, writeActive);
    },

    /**
     * Clear History (ADR-0004, QST-CLEAR-SCOPE = A): every conversation — including any
     * unreadable ones, since the user asked for all of them — and nothing else. Preferences,
     * the schema stamp, the API key (sessionStorage, or orch:apiKey if opted in later), and
     * other same-origin apps' keys are untouched. Returns how many conversations were removed.
     */
    clearAll() {
      const count = conversations.size + unreadable.length;
      conversations.clear();
      unreadable.length = 0;
      activeId = null;
      const convKeys = storedKeys().filter((key) => key.startsWith(CONV_PREFIX));
      persist(...convKeys.map((key) => () => remove(key)), () => remove(INDEX_KEY), () => remove(ACTIVE_KEY));
      return count;
    },

    /** A copy of the preferences. */
    get prefs() {
      return { ...prefs };
    },

    /** Merge known preference fields. Returns true if the change reached storage. */
    setPrefs(patch) {
      prefs = parsePrefs(JSON.stringify({ ...prefs, ...patch }));
      return persist(() => write(PREFS_KEY, JSON.stringify(prefs)));
    },

    /**
     * Phase 1 → 2 handover (keystore.handOverLegacyModel): keep a saved model if there is
     * one, otherwise save `model`. True once a model is safely in localStorage.
     */
    adoptModel(model) {
      if (prefs.model) return backend !== null;
      return this.setPrefs({ model });
    },
  };
}

/** Sidebar title: the first user message, whitespace collapsed, truncated by characters (not UTF-16 units). */
export function titleFrom(messages) {
  const first = messages.find((m) => m.role === 'user');
  const text = first ? first.content.replace(/\s+/g, ' ').trim() : '';
  if (!text) return UNTITLED;
  const chars = Array.from(text);
  return chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX - 1).join('').trimEnd()}…` : text;
}

// ---------------------------------------------------------------------------

/** Everything in an index entry is derived from the messages, so a lost index loses nothing. */
function summarize({ id, messages }) {
  const lastModel = messages.findLast((m) => m.role === 'assistant' && typeof m.model === 'string')?.model ?? null;
  return {
    id,
    title: titleFrom(messages),
    model: lastModel,
    createdAt: toTs(messages[0]?.ts),
    updatedAt: toTs(messages.at(-1)?.ts),
  };
}

function toTs(value) {
  return Number.isFinite(value) ? value : 0;
}

function isValidMessage(m) {
  if (!m || typeof m !== 'object') return false;
  if (m.role === 'user' || m.role === 'assistant') return typeof m.content === 'string';
  if (m.role === 'notice') return typeof m.text === 'string';
  return false;
}

/**
 * A stored conversation, or null if it can't be trusted. All-or-nothing on purpose:
 * dropping just the bad messages and saving the rest would silently delete user data
 * the next time the conversation is written.
 */
function parseConversation(raw, id) {
  const value = parseJson(raw);
  if (!value || typeof value !== 'object' || !Array.isArray(value.messages)) return null;
  if (!value.messages.every(isValidMessage)) return null;
  return { id, messages: value.messages };
}

function parsePrefs(raw) {
  const value = parseJson(raw);
  const prefs = { ...DEFAULT_PREFS };
  if (!value || typeof value !== 'object') return prefs;
  if (typeof value.model === 'string') prefs.model = value.model.trim();
  if (typeof value.rememberKey === 'boolean') prefs.rememberKey = value.rememberKey;
  if (['system', 'light', 'dark'].includes(value.theme)) prefs.theme = value.theme;
  return prefs;
}

function parseJson(raw) {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isQuotaError(err) {
  return (
    err?.name === 'QuotaExceededError' ||
    err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || // older Firefox
    err?.code === 22 ||
    err?.code === 1014
  );
}

function defaultLocalStorage() {
  try {
    return globalThis.localStorage ?? null; // the getter itself throws when site data is blocked
  } catch {
    return null;
  }
}

function isUsable(storage) {
  if (!storage) return false;
  try {
    const probe = '__orch_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return true;
  } catch {
    // A QuotaExceededError here means "full", not "unavailable" — but with no room for
    // even a probe byte, nothing could be saved anyway; treat it as unavailable.
    return false;
  }
}
