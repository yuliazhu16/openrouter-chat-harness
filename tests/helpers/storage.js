// Minimal implementations of the Web Storage interface (getItem/setItem/removeItem)
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
  get length() {
    return this.#items.size;
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
}
