// Minimal implementations of the Web Storage interface (getItem/setItem/removeItem/key/length)
// for tests of modules that take a Storage-shaped object (ADR-0005, Explicitation #4).
// These stand in for the BROWSER, not for our own code: the module under test runs unmodified.

/** Behaves like a working sessionStorage/localStorage. */
export class MemoryStorage {
  #items = new Map();
  getItem(name) {
    return this.#items.has(name) ? this.#items.get(name) : null;
  }
  setItem(name, value) {
    this.#items.set(name, String(value));
  }
  removeItem(name) {
    this.#items.delete(name);
  }
  key(index) {
    return [...this.#items.keys()][index] ?? null;
  }
  get length() {
    return this.#items.size;
  }
  /** Test convenience (not part of Web Storage): a plain-object snapshot of everything stored. */
  snapshot() {
    return Object.fromEntries(this.#items);
  }
}

/**
 * Behaves like localStorage on a nearly full origin: once the stored keys + values would
 * exceed `capacity` characters, setItem throws the browser's QuotaExceededError and
 * leaves the old value in place. (Browsers count UTF-16 code units; so does .length.)
 */
export class LimitedStorage extends MemoryStorage {
  constructor(capacity) {
    super();
    this.capacity = capacity;
  }
  used() {
    let total = 0;
    for (let i = 0; i < this.length; i += 1) {
      const name = this.key(i);
      total += name.length + this.getItem(name).length;
    }
    return total;
  }
  setItem(name, value) {
    const text = String(value);
    const existing = this.getItem(name);
    const after = this.used() - (existing === null ? 0 : name.length + existing.length) + name.length + text.length;
    if (after > this.capacity) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    super.setItem(name, text);
  }
}

/** Behaves like storage in a browser mode that blocks it: every access throws. */
export class BlockedStorage {
  getItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  setItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  removeItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  key() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  get length() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
}
