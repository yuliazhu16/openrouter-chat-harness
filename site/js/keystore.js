// Session-scoped settings: the API key and the chosen model (ADR-0002, QST-KEY-STORAGE = B).
//
// PURE MODULE (no DOM): tests/keystore.test.js passes its own Storage-shaped object.
//
// Phase 1 keeps BOTH values in sessionStorage: they survive a page refresh but
// are forgotten when the tab closes. Phase 2 moves the model into persistent
// preferences (ADR-0004); Phase 3 adds the opt-in "Remember key on this device".
//
// If storage is unavailable (some private-browsing modes, blocked site data),
// values fall back to memory: the app keeps working, it just forgets on reload.

const KEY_ITEM = 'orch:apiKey';
const MODEL_ITEM = 'orch:session:model';

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
    getModel: () => read(MODEL_ITEM) ?? '',
    setModel: (model) => write(MODEL_ITEM, String(model ?? '').trim()),
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
