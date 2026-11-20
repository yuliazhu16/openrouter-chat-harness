// Unit tests for site/js/keystore.js — where the API key lives (ADR-0002, QST-KEY-STORAGE = B).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createKeystore } from '../site/js/keystore.js';
import { createChatStore } from '../site/js/storage.js';
import { BlockedStorage, MemoryStorage } from './helpers/storage.js';

describe('keystore', () => {
  it('keeps the key across a page refresh in the same tab — and only in sessionStorage', () => {
    const tab = new MemoryStorage(); // sessionStorage outlives a reload, not the tab
    const local = new MemoryStorage();
    createChatStore({ storage: local }).setPrefs({ model: 'openrouter/free' });
    createKeystore(tab).setKey('sk-or-v1-session-key');

    const afterReload = createKeystore(tab); // a fresh page load builds a new keystore
    assert.equal(afterReload.getKey(), 'sk-or-v1-session-key');
    assert.equal(afterReload.persistsAcrossReload, true);
    assert.ok(
      !Object.values(local.snapshot()).some((value) => value.includes('sk-or-v1-session-key')),
      'saving preferences and chats must never put the key in localStorage (ADR-0002)',
    );
  });

  it('"Forget key" removes the key from storage', () => {
    const tab = new MemoryStorage();
    const store = createKeystore(tab);
    store.setKey('sk-or-v1-session-key');

    store.forgetKey();

    assert.equal(store.getKey(), '');
    assert.equal(createKeystore(tab).getKey(), '', 'a reload must not bring the key back');
  });

  it('when the browser blocks storage, the key still works for this page view (and says it will not persist)', () => {
    const store = createKeystore(new BlockedStorage());
    store.setKey('sk-or-v1-session-key');
    assert.equal(store.getKey(), 'sk-or-v1-session-key');
    assert.equal(store.persistsAcrossReload, false);
  });
});

describe('Phase 1 → Phase 2 model handover', () => {
  // A tab opened on the Phase 1 site has the model in sessionStorage ("orch:session:model").
  // After the Phase 2 deploy, its next refresh must keep that model, now as a saved preference.

  it('moves a Phase 1 tab\'s model into saved preferences and removes the session copy', () => {
    const tab = new MemoryStorage();
    tab.setItem('orch:session:model', 'anthropic/claude-haiku-5.5');
    const local = new MemoryStorage();

    const chats = createChatStore({ storage: local });
    createKeystore(tab).handOverLegacyModel((model) => chats.adoptModel(model));

    assert.equal(createChatStore({ storage: local }).prefs.model, 'anthropic/claude-haiku-5.5');
    assert.equal(tab.getItem('orch:session:model'), null);
  });

  it('does not overwrite a model already saved (e.g. by another tab already on Phase 2)', () => {
    const tab = new MemoryStorage();
    tab.setItem('orch:session:model', 'openrouter/free');
    const local = new MemoryStorage();
    createChatStore({ storage: local }).setPrefs({ model: 'anthropic/claude-sonnet-5.5' });

    const chats = createChatStore({ storage: local });
    createKeystore(tab).handOverLegacyModel((model) => chats.adoptModel(model));

    assert.equal(createChatStore({ storage: local }).prefs.model, 'anthropic/claude-sonnet-5.5');
    assert.equal(tab.getItem('orch:session:model'), null);
  });

  it('keeps the session copy when localStorage is blocked, so the model is not lost on reload', () => {
    const tab = new MemoryStorage();
    tab.setItem('orch:session:model', 'openrouter/free');

    const chats = createChatStore({ storage: new BlockedStorage() });
    createKeystore(tab).handOverLegacyModel((model) => chats.adoptModel(model));

    assert.equal(chats.prefs.model, 'openrouter/free', 'usable for this page view');
    assert.equal(tab.getItem('orch:session:model'), 'openrouter/free');
  });
});
