// Unit tests for site/js/storage.js — saved conversations and preferences (ADR-0004, ADR-0005 Phase 2).
//
// A "reload" is modelled the way the browser does it: a NEW store instance over the SAME
// Storage object. The Storage stand-ins (tests/helpers/storage.js) replace the browser,
// never our code, so every test runs the real load/migrate/save paths.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toApiMessages } from '../site/js/api.js';
import { SCHEMA_VERSION, createChatStore, titleFrom } from '../site/js/storage.js';
import { BlockedStorage, LimitedStorage, MemoryStorage } from './helpers/storage.js';

/** Deterministic ids, like crypto.randomUUID but readable in failures. */
function ids(prefix = 'c') {
  let n = 0;
  return () => `${prefix}${(n += 1)}`;
}

const user = (content, ts) => ({ role: 'user', content, ts });
const assistant = (content, ts, model = 'openrouter/free') => ({ role: 'assistant', content, ts, model });

describe('chat store: save and restore', () => {
  it('restores every conversation, newest first, and reopens the chat that was open — after a reload', () => {
    const local = new MemoryStorage();
    const tab = createChatStore({ storage: local, newId: ids() });

    const first = tab.create(user('What is CORS?', 1000)).id;
    tab.append(first, assistant('Cross-Origin Resource Sharing is…', 1001));
    const second = tab.create(user('Write a haiku about rain', 2000)).id;
    tab.append(second, assistant('Soft rain on the roof…', 2001, 'anthropic/claude-haiku-5.5'));
    tab.append(first, user('And preflight?', 3000)); // older chat continued → it moves to the top
    tab.setActive(second);

    const reloaded = createChatStore({ storage: local });
    assert.deepEqual(
      reloaded.list().map(({ id, title, model }) => ({ id, title, model })),
      [
        { id: first, title: 'What is CORS?', model: 'openrouter/free' },
        { id: second, title: 'Write a haiku about rain', model: 'anthropic/claude-haiku-5.5' },
      ],
    );
    assert.equal(reloaded.activeId, second);
    assert.deepEqual(
      reloaded.get(first).messages.map((m) => m.content),
      ['What is CORS?', 'Cross-Origin Resource Sharing is…', 'And preflight?'],
    );
    assert.equal(reloaded.problem, null);
  });

  it('writes exactly the ADR-0004 v1 layout, so later versions can migrate from it', () => {
    const local = new MemoryStorage();
    const tab = createChatStore({ storage: local, newId: ids() });
    const id = tab.create(user('Hi', 10)).id;
    tab.append(id, assistant('Hello!', 11));

    const stored = local.snapshot();
    assert.deepEqual(Object.keys(stored).sort(), ['orch:active', 'orch:conv:c1', 'orch:index', 'orch:schema']);
    assert.equal(stored['orch:schema'], String(SCHEMA_VERSION));
    assert.equal(stored['orch:active'], 'c1');
    assert.deepEqual(JSON.parse(stored['orch:index']), [
      { id: 'c1', title: 'Hi', model: 'openrouter/free', createdAt: 10, updatedAt: 11 },
    ]);
    assert.deepEqual(JSON.parse(stored['orch:conv:c1']), { id: 'c1', messages: [user('Hi', 10), assistant('Hello!', 11)] });
  });

  it('error and "Stopped." notices come back after a reload but are still never sent to the model', () => {
    const local = new MemoryStorage();
    const tab = createChatStore({ storage: local, newId: ids() });
    const id = tab.create(user('Hi', 1)).id;
    tab.append(id, { role: 'notice', kind: 'error', text: 'Rate limited. Wait a moment and try again.', ts: 2 });
    tab.append(id, { role: 'notice', kind: 'stopped', text: 'Stopped.', ts: 3 });
    tab.append(id, assistant('Hello!', 4));

    const restored = createChatStore({ storage: local }).get(id).messages;
    assert.equal(restored.length, 4, 'notices are part of what the user sees, so they are kept');
    assert.deepEqual(toApiMessages(restored), [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ]);
  });

  it('after New Chat and a refresh, the user lands on a fresh chat and the old ones are still listed', () => {
    const local = new MemoryStorage();
    const tab = createChatStore({ storage: local, newId: ids() });
    tab.create(user('Old question', 1));
    tab.setActive(null); // New Chat: nothing is saved until the first message

    const reloaded = createChatStore({ storage: local });
    assert.equal(reloaded.activeId, null);
    assert.equal(reloaded.list().length, 1);
  });

  it('remembers the chosen model across reloads, separately from conversations', () => {
    const local = new MemoryStorage();
    createChatStore({ storage: local }).setPrefs({ model: 'anthropic/claude-haiku-5.5' });
    assert.equal(createChatStore({ storage: local }).prefs.model, 'anthropic/claude-haiku-5.5');
  });
});

describe('chat store: deleting', () => {
  it('deleting one conversation removes only that one, and a reload does not bring it back', () => {
    const local = new MemoryStorage();
    const tab = createChatStore({ storage: local, newId: ids() });
    const keep = tab.create(user('Keep me', 1)).id;
    const drop = tab.create(user('Delete me', 2)).id; // also becomes the open chat

    tab.remove(drop);

    assert.equal(tab.activeId, null, 'deleting the open chat leaves a fresh chat open');
    const reloaded = createChatStore({ storage: local });
    assert.deepEqual(reloaded.list().map((c) => c.id), [keep]);
    assert.equal(local.getItem(`orch:conv:${drop}`), null);
  });

  it('a reply that arrives after its conversation was deleted does not resurrect it', () => {
    // app.js: user deletes a chat while its request is in flight; the reply then lands.
    const local = new MemoryStorage();
    const tab = createChatStore({ storage: local, newId: ids() });
    const id = tab.create(user('Long question…', 1)).id;
    tab.remove(id);

    assert.equal(tab.append(id, assistant('Late answer', 2)), null);
    assert.equal(createChatStore({ storage: local }).list().length, 0);
  });

  it('Clear History deletes every conversation but keeps preferences, the key slot, and other apps\' data', () => {
    const local = new MemoryStorage();
    // Same github.io origin = same localStorage (ADR-0002): another project page's data lives here too.
    local.setItem('other-pages-app:settings', '{"theme":"dark"}');
    // Where Phase 3's opt-in "Remember key" will keep the key (ADR-0004 schema). Clear must never touch it.
    local.setItem('orch:apiKey', 'sk-or-v1-placeholder-not-a-key');
    const tab = createChatStore({ storage: local, newId: ids() });
    tab.setPrefs({ model: 'openrouter/free' });
    tab.create(user('One', 1));
    tab.create(user('Two', 2));
    local.setItem('orch:conv:broken', '{"id":"broken","messages":[{"role":"us'); // unreadable leftovers go too

    const reloaded = createChatStore({ storage: local });
    const removed = reloaded.clearAll();

    assert.equal(removed, 3);
    assert.deepEqual(local.snapshot(), {
      'other-pages-app:settings': '{"theme":"dark"}',
      'orch:apiKey': 'sk-or-v1-placeholder-not-a-key',
      'orch:schema': '1',
      'orch:prefs': JSON.stringify({ model: 'openrouter/free', rememberKey: false, theme: 'system' }),
    });
    const afterReload = createChatStore({ storage: local });
    assert.deepEqual(afterReload.list(), []);
    assert.deepEqual(afterReload.unreadable, []);
    assert.equal(afterReload.prefs.model, 'openrouter/free');
  });
});

describe('chat store: damaged or competing data', () => {
  it('skips a corrupt conversation, loads the rest, and never deletes or rewrites the corrupt one', () => {
    const local = new MemoryStorage();
    const tab = createChatStore({ storage: local, newId: ids() });
    const good = tab.create(user('Still fine', 1)).id;
    const truncated = '{"id":"cut","messages":[{"role":"user","content":"Half a mess';
    const wrongShape = JSON.stringify({ id: 'odd', messages: [{ role: 'user', content: 42 }] });
    local.setItem('orch:conv:cut', truncated); // e.g. an interrupted write, or a hand edit
    local.setItem('orch:conv:odd', wrongShape);

    const reloaded = createChatStore({ storage: local, newId: ids('n') });
    assert.deepEqual(reloaded.list().map((c) => c.id), [good]);
    assert.deepEqual(reloaded.unreadable.sort(), ['cut', 'odd']);

    // Normal use afterwards must leave the damaged values exactly as they were.
    reloaded.append(good, assistant('Reply', 2));
    reloaded.create(user('New chat', 3));
    reloaded.remove(good);
    assert.equal(local.getItem('orch:conv:cut'), truncated);
    assert.equal(local.getItem('orch:conv:odd'), wrongShape);
  });

  it('a corrupt index loses nothing: conversations are recovered from their own keys', () => {
    const local = new MemoryStorage();
    const tab = createChatStore({ storage: local, newId: ids() });
    tab.create(user('First', 1));
    tab.create(user('Second', 2));
    local.setItem('orch:index', '[{"id":"c1","title":"Fir'); // truncated

    const reloaded = createChatStore({ storage: local });
    assert.deepEqual(reloaded.list().map((c) => c.title), ['Second', 'First']);
    assert.deepEqual(reloaded.unreadable, [], 'the index is derived data, not a lost conversation');
  });

  it('two open tabs: a chat started in one is not lost when the other rewrites the index', () => {
    const local = new MemoryStorage();
    const tabA = createChatStore({ storage: local, newId: ids('a') });
    const tabB = createChatStore({ storage: local, newId: ids('b') }); // loaded before tab A's chat existed
    tabA.create(user('From tab A', 1));
    tabB.create(user('From tab B', 2)); // writes an index that doesn't mention tab A's chat

    const reloaded = createChatStore({ storage: local });
    assert.deepEqual(reloaded.list().map((c) => c.title).sort(), ['From tab A', 'From tab B']);
  });

  it('corrupt preferences fall back to defaults instead of breaking the app', () => {
    const local = new MemoryStorage();
    local.setItem('orch:schema', '1');
    local.setItem('orch:prefs', '{"model": ');
    const tab = createChatStore({ storage: local });
    assert.deepEqual(tab.prefs, { model: '', rememberKey: false, theme: 'system' });
    assert.equal(tab.problem, null);
  });
});

describe('chat store: storage full or unavailable', () => {
  it('when storage is full: the message stays on screen, the problem is reported, nothing is deleted, and saving resumes once space is freed', () => {
    const local = new LimitedStorage(1500);
    const tab = createChatStore({ storage: local, newId: ids() });
    const old = tab.create(user('An old conversation', 1)).id;
    tab.append(old, assistant('x'.repeat(500), 2));
    const current = tab.create(user('Current chat', 3)).id;

    const result = tab.append(current, assistant('y'.repeat(800), 4));

    assert.deepEqual(result, { saved: false });
    assert.equal(tab.problem, 'quota');
    assert.equal(tab.persistent, true, 'still trying to save: deleting chats can free space');
    assert.equal(tab.get(current).messages.length, 2, 'the reply is still shown for this session');
    assert.deepEqual(createChatStore({ storage: local }).list().map((c) => c.id).sort(), [old, current].sort());

    tab.remove(old); // what the banner asks the user to do
    assert.deepEqual(tab.append(current, user('Thanks', 5)), { saved: true });
    assert.equal(tab.problem, null);
    assert.equal(createChatStore({ storage: local }).get(current).messages.length, 3, 'the unsaved reply is saved too');
  });

  it('when the browser blocks storage (private mode, blocked site data), chats work for this page view and the store says it is not saving', () => {
    for (const storage of [new BlockedStorage(), null]) {
      const tab = createChatStore({ storage, newId: ids() });
      assert.equal(tab.persistent, false);
      assert.equal(tab.problem, 'unavailable');

      const id = tab.create(user('Hello?', 1)).id;
      assert.deepEqual(tab.append(id, assistant('Hi!', 2)), { saved: false });
      assert.equal(tab.get(id).messages.length, 2);
      assert.equal(tab.setPrefs({ model: 'openrouter/free' }), false);
      assert.equal(tab.prefs.model, 'openrouter/free');
    }
  });
});

describe('chat store: schema versions', () => {
  it('first load after Phase 1 (no schema stamp, nothing of ours in localStorage) stamps v1 and touches nothing else', () => {
    const local = new MemoryStorage();
    local.setItem('other-pages-app:data', 'unchanged');

    const tab = createChatStore({ storage: local });

    assert.deepEqual(local.snapshot(), { 'other-pages-app:data': 'unchanged', 'orch:schema': '1' });
    assert.deepEqual(tab.list(), []);
    assert.equal(tab.problem, null);
  });

  it('data from a NEWER schema version is left exactly as it is, and this page view runs in memory', () => {
    // E.g. a cached old app.js running after a later release has upgraded the data.
    const local = new MemoryStorage();
    local.setItem('orch:schema', '2');
    local.setItem('orch:conv:x', '{"id":"x","turns":[]}');
    local.setItem('orch:prefs', '{"model":"openrouter/free","v2field":true}');
    const before = local.snapshot();

    const tab = createChatStore({ storage: local, newId: ids() });
    tab.create(user('typed in the old tab', 1));
    tab.setPrefs({ model: 'something-else' });
    tab.clearAll();

    assert.equal(tab.problem, 'newer-schema');
    assert.equal(tab.persistent, false);
    assert.deepEqual(local.snapshot(), before);
  });
});

describe('titleFrom', () => {
  it('titles a chat by its first user message: one line, cut at 60 characters without splitting an emoji', () => {
    assert.equal(titleFrom([user('  Explain\n\nthis   error  ', 1)]), 'Explain this error');
    const long = `${'a'.repeat(58)}🙂🙂🙂 and more`;
    const title = titleFrom([user(long, 1)]);
    assert.equal(Array.from(title).length, 60);
    assert.ok(title.endsWith('🙂…'), title);
    assert.equal(titleFrom([{ role: 'notice', kind: 'error', text: 'x', ts: 1 }]), 'New chat');
  });
});
