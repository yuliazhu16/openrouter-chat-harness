// Unit tests for site/js/keystore.js — where the API key and model live (ADR-0002, QST-KEY-STORAGE = B).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createKeystore } from '../site/js/keystore.js';
import { BlockedStorage, MemoryStorage } from './helpers/storage.js';

describe('keystore', () => {
  it('keeps the key and model across a page refresh in the same tab', () => {
    const tab = new MemoryStorage(); // sessionStorage outlives a reload, not the tab
    const beforeReload = createKeystore(tab);
    beforeReload.setKey('sk-or-v1-session-key');
    beforeReload.setModel('openrouter/free');

    const afterReload = createKeystore(tab); // a fresh page load builds a new keystore
    assert.equal(afterReload.getKey(), 'sk-or-v1-session-key');
    assert.equal(afterReload.getModel(), 'openrouter/free');
    assert.equal(afterReload.persistsAcrossReload, true);
  });

  it('"Forget key" removes the key from storage but keeps the chosen model', () => {
    const tab = new MemoryStorage();
    const store = createKeystore(tab);
    store.setKey('sk-or-v1-session-key');
    store.setModel('openrouter/free');

    store.forgetKey();

    assert.equal(store.getKey(), '');
    assert.equal(createKeystore(tab).getKey(), '', 'a reload must not bring the key back');
    assert.equal(store.getModel(), 'openrouter/free');
  });

  it('when the browser blocks storage, the app still works for this page view (and says it will not persist)', () => {
    const store = createKeystore(new BlockedStorage());
    store.setKey('sk-or-v1-session-key');
    store.setModel('openrouter/free');
    assert.equal(store.getKey(), 'sk-or-v1-session-key');
    assert.equal(store.getModel(), 'openrouter/free');
    assert.equal(store.persistsAcrossReload, false);
  });
});
