// The API key, session-scoped (ADR-0002, QST-KEY-STORAGE = B).
//
// PURE MODULE (no DOM): tests/keystore.test.js passes its own Storage-shaped object.
//
// The key lives in sessionStorage: it survives a page refresh but is forgotten when
// the tab closes. Phase 3 adds the opt-in "Remember key on this device".
// Phase 1 also kept the chosen model here; since Phase 2 the model is a persistent
// preference in localStorage (ADR-0004, storage.js), and handOverLegacyModel() moves
// a Phase 1 tab's model across once.
//
// If storage is unavailable (some private-browsing modes, blocked site data),
// values fall back to memory: the app keeps working, it just forgets on reload.

const KEY_ITEM = 'orch:apiKey';
const LEGACY_MODEL_ITEM = 'orch:session:model'; // Phase 1 only

export function createKeystore(storage = defaultSessionStorage()) {
  const memory = new Map();
  let backend = isUsable(storage) ? storage : null;

  const read = (name) => {
    if (backend) {
      try {
        return backend.getItem(name);
      } catch {
        backend = null;
      }
    }
    return memory.get(name) ?? null;
  };

  const write = (name, value) => {
    memory.set(name, value);
    if (backend) {
      try {
        backend.setItem(name, value);
      } catch {
        backend = null; // quota or access error: keep working from memory
      }
    }
  };

  const remove = (name) => {
    memory.delete(name);
    if (backend) {
      try {
        backend.removeItem(name);
      } catch {
        backend = null;
      }
    }
  };

  return {
    /** True while values will survive a page refresh. */
    get persistsAcrossReload() {
      return backend !== null;
    },
    getKey: () => read(KEY_ITEM) ?? '',
    setKey: (key) => write(KEY_ITEM, String(key ?? '').trim()),
    forgetKey: () => remove(KEY_ITEM),
    /**
     * One-time Phase 1 → Phase 2 move of the model out of sessionStorage. `save(model)`
     * stores it as a preference and returns true once it is safely persisted; only then
     * is the session copy removed, so a failed save never loses the user's choice.
     */
    handOverLegacyModel(save) {
      const model = (read(LEGACY_MODEL_ITEM) ?? '').trim();
      if (!model) return;
      if (save(model)) remove(LEGACY_MODEL_ITEM);
    },
  };
}

function defaultSessionStorage() {
  try {
    return globalThis.sessionStorage ?? null; // the getter itself can throw when storage is blocked
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
    return false;
  }
}
