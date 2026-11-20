// Entry point: wires the page to the pure modules (ADR-0001 layout).
//
// Phase 1 (ADR-0005): settings, non-streaming send/receive, loading + Stop, mapped errors.
// Phase 2 (ADR-0004): conversations and preferences saved in localStorage (storage.js);
// sidebar/drawer with New chat, switching, delete-one, and Clear history.
//
// State lives in two places: `chats` (the store — conversations, prefs, active id; it
// persists what it can) and the few UI-only variables below. render() redraws the page
// from that state, so every action is "change state, then render()".

import { ChatError, sendChat, toApiMessages } from './api.js?v=ca07c07f';
import { createKeystore } from './keystore.js?v=ca07c07f';
import { SUGGESTED_MODELS } from './models.js?v=ca07c07f';
import { renderConversationItem, renderMessage, renderPending } from './render.js?v=ca07c07f';
import { createChatStore } from './storage.js?v=ca07c07f';

const keystore = createKeystore();
const chats = createChatStore();

// Phase 1 kept the model in sessionStorage; it is a saved preference now. Hand it over once.
keystore.handOverLegacyModel((model) => chats.adoptModel(model));

/** The open conversation's id, or null for a fresh chat that isn't saved until its first message. */
let activeId = chats.activeId;
/**
 * The request in flight, or null. One request at a time (ADR-0003). It belongs to the
 * conversation it was sent from: the reply lands there even if the user switches away.
 * @type {{controller: AbortController, convId: string, pending: HTMLElement} | null}
 */
let inFlight = null;

const $ = (id) => document.getElementById(id);
const el = {
  chat: $('chat'),
  messages: $('messages'),
  emptyState: $('empty-state'),
  emptyConfigNote: $('empty-config-note'),
  emptyOpenSettings: $('empty-open-settings'),
  composer: $('composer'),
  prompt: $('prompt'),
  send: $('send'),
  stop: $('stop'),
  modelChip: $('model-chip'),
  openSettings: $('open-settings'),
  banner: $('storage-banner'),
  sidebar: $('sidebar'),
  sidebarToggle: $('sidebar-toggle'),
  closeSidebar: $('close-sidebar'),
  chatTitle: $('chat-title'),
  backdrop: $('backdrop'),
  newChat: $('new-chat'),
  topbarNewChat: $('topbar-new-chat'),
  convList: $('conv-list'),
  convEmpty: $('conv-empty'),
  clearHistory: $('clear-history'),
  dialog: $('settings'),
  form: $('settings-form'),
  keyInput: $('api-key'),
  toggleKey: $('toggle-key'),
  modelInput: $('model'),
  modelList: $('model-suggestions'),
  settingsError: $('settings-error'),
  forgetKey: $('forget-key'),
  cancelSettings: $('cancel-settings'),
};

const finePointer = window.matchMedia('(pointer: fine)');
const wideScreen = window.matchMedia('(min-width: 768px)'); // keep in sync with styles.css

// ---------------------------------------------------------------------------
// state → UI

const currentModel = () => chats.prefs.model;
const isConfigured = () => Boolean(keystore.getKey() && currentModel());
const activeMessages = () => (activeId ? chats.get(activeId)?.messages ?? [] : []);

/** True when the last real turn is the user's, i.e. there is something to (re)send. */
function awaitingReply(messages) {
  const turns = toApiMessages(messages);
  return turns.length > 0 && turns[turns.length - 1].role === 'user';
}

function render({ scroll = true } = {}) {
  renderSidebar();
  renderMessages();
  refreshChrome();
  if (scroll) el.chat.scrollTop = el.chat.scrollHeight;
}

function renderSidebar() {
  const entries = chats.list();
  el.convList.replaceChildren(
    ...entries.map((entry) =>
      renderConversationItem(entry, {
        active: entry.id === activeId,
        busy: entry.id === inFlight?.convId,
        onOpen: () => openConversation(entry.id),
        onDelete: () => deleteConversation(entry.id),
      }),
    ),
  );
  el.convEmpty.hidden = entries.length > 0;
  el.clearHistory.disabled = entries.length === 0 && chats.unreadable.length === 0;
}

function renderMessages() {
  const messages = activeMessages();
  const nodes = messages.map((m) => renderMessage(m));

  // Saved notices are plain records; the buttons for the conversation's current state are
  // added here, so they look the same live, after switching back, and after a reload.
  const actions = tailActions(messages);
  if (actions.length > 0) {
    const last = messages.at(-1);
    if (last.role === 'notice') nodes[nodes.length - 1] = renderMessage(last, { actions });
    else nodes.push(renderMessage({ role: 'notice', kind: 'info', text: 'No reply yet.' }, { actions })); // e.g. reloaded mid-request
  }
  if (inFlight && inFlight.convId === activeId) nodes.push(inFlight.pending);

  el.messages.replaceChildren(...nodes);
}

function tailActions(messages) {
  if (inFlight || !awaitingReply(messages)) return [];
  const actions = [{ label: 'Retry', onClick: () => requestReply(activeId) }];
  if (messages.at(-1)?.kind === 'error') actions.unshift({ label: 'Open Settings', onClick: () => openSettings() });
  return actions;
}

function refreshChrome() {
  const model = currentModel();
  // "anthropic/" + "claude-haiku-5.5": phones hide the provider part (styles.css) so the name fits.
  const slash = model.indexOf('/');
  const vendor = document.createElement('span');
  vendor.className = 'model-chip__vendor';
  vendor.textContent = slash > 0 ? model.slice(0, slash + 1) : '';
  el.modelChip.replaceChildren(vendor, model ? model.slice(slash + 1) : 'Choose model');
  el.modelChip.title = model ? `Model: ${model} (change)` : 'Choose a model';
  el.modelChip.classList.toggle('model-chip--unset', !model);

  const ready = isConfigured();
  const busy = inFlight !== null;
  el.prompt.placeholder = ready ? 'Message…' : 'Set key & model in Settings'; // must fit one line at 375px
  el.send.disabled = !ready || busy; // ADR-0003: Send disabled until key + model are set
  el.send.hidden = busy;
  el.stop.hidden = !busy;

  el.emptyState.hidden = activeMessages().length > 0;
  el.emptyConfigNote.hidden = ready;

  // The header names the open chat (user text → textContent, ADR-0002).
  const title = (activeId && chats.get(activeId)?.title) || 'New chat';
  el.chatTitle.textContent = title;
  el.chatTitle.title = title;

  renderBanner();
}

/** ADR-0004, NOT: failure-handling — say plainly when chats aren't being saved, and why. */
function renderBanner() {
  const lines = [];
  if (chats.problem === 'unavailable') {
    lines.push("This browser isn't letting the app save data (private mode or blocked site data), so chats will be lost when you reload.");
  } else if (chats.problem === 'quota') {
    lines.push("Storage is full, so recent messages weren't saved. Delete old conversations to keep saving.");
  } else if (chats.problem === 'newer-schema') {
    lines.push('Your saved chats were made by a newer version of this app. Reload to get it; changes made in this tab won\'t be saved.');
  }
  if (chats.problem !== 'unavailable' && !keystore.persistsAcrossReload) {
    lines.push('Your API key will be forgotten when you reload.');
  }
  const unreadable = chats.unreadable.length;
  if (unreadable > 0) {
    lines.push(
      `${unreadable === 1 ? '1 saved conversation' : `${unreadable} saved conversations`} couldn't be read and ${unreadable === 1 ? 'was' : 'were'} skipped (left in storage, not deleted).`,
    );
  }
  el.banner.textContent = lines.join(' ');
  el.banner.hidden = lines.length === 0;
}

// ---------------------------------------------------------------------------
// conversations

function setDrawer(open) {
  if (wideScreen.matches) open = false; // the sidebar is always visible on wide screens
  document.body.classList.toggle('drawer-open', open);
  el.backdrop.hidden = !open;
  el.sidebarToggle.setAttribute('aria-expanded', String(open));
  el.sidebarToggle.setAttribute('aria-label', open ? 'Hide chats' : 'Show chats');
}

function focusPrompt() {
  if (finePointer.matches) el.prompt.focus(); // don't pop the on-screen keyboard on phones
}

function newChat() {
  activeId = null;
  chats.setActive(null);
  setDrawer(false);
  render();
  focusPrompt();
}

function openConversation(id) {
  activeId = id;
  chats.setActive(id);
  setDrawer(false);
  render();
  focusPrompt();
}

function deleteConversation(id) {
  const entry = chats.get(id);
  if (!entry) return;
  if (!window.confirm(`Delete "${entry.title}"? This can't be undone.`)) return;
  if (inFlight?.convId === id) inFlight.controller.abort(); // its late reply is dropped (chats.append → null)
  chats.remove(id);
  if (activeId === id) activeId = null;
  render();
}

/** ADR-0004, QST-CLEAR-SCOPE = A: all conversations, after a confirm showing the count; key and prefs stay. */
function clearHistory() {
  const readable = chats.list().length;
  const unreadable = chats.unreadable.length;
  const total = readable + unreadable;
  if (total === 0) return;
  const what = `${readable === 1 ? '1 conversation' : `all ${readable} conversations`}${unreadable ? ` (plus ${unreadable} unreadable)` : ''}`;
  if (!window.confirm(`Delete ${what}? This can't be undone. Your API key and settings are kept.`)) return;
  inFlight?.controller.abort();
  chats.clearAll();
  activeId = null;
  setDrawer(false);
  render();
}

// ---------------------------------------------------------------------------
// sending

async function requestReply(convId) {
  if (inFlight || !convId) return;
  const conversation = chats.get(convId);
  if (!conversation || !awaitingReply(conversation.messages)) return;

  const controller = new AbortController();
  inFlight = { controller, convId, pending: renderPending() };
  render();

  try {
    const reply = await sendChat({
      apiKey: keystore.getKey(),
      model: currentModel(),
      history: conversation.messages,
      referer: `${location.origin}${location.pathname}`,
      signal: controller.signal,
    });
    // chats.append ignores a conversation deleted while the reply was on its way (it stays deleted).
    chats.append(convId, { role: 'assistant', content: reply.content, model: reply.model, ts: Date.now() });
    if (reply.finishReason === 'length') {
      chats.append(convId, { role: 'notice', kind: 'info', text: 'Reply was cut off (length limit).', ts: Date.now() });
    }
  } catch (err) {
    chats.append(convId, failureNotice(err));
  } finally {
    inFlight = null;
    // Don't yank the view to the bottom if the reply landed in a chat the user switched away from.
    render({ scroll: convId === activeId });
    if (convId === activeId) focusPrompt();
  }
}

function failureNotice(err) {
  const error =
    err instanceof ChatError ? err : new ChatError('unknown', 'Something went wrong. Please try again.');
  if (error.kind === 'aborted') return { role: 'notice', kind: 'stopped', text: 'Stopped.', ts: Date.now() };
  return { role: 'notice', kind: 'error', text: error.message, ts: Date.now() };
}

el.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = el.prompt.value.trim();
  if (!text || inFlight) return;
  if (!isConfigured()) {
    openSettings('Add your API key and choose a model to start chatting.');
    return;
  }
  const message = { role: 'user', content: text, ts: Date.now() };
  if (activeId && chats.has(activeId)) {
    chats.append(activeId, message);
  } else {
    activeId = chats.create(message).id; // a fresh chat is saved with its first message
  }
  el.prompt.value = '';
  autoGrow();
  requestReply(activeId);
});

el.prompt.addEventListener('keydown', (event) => {
  // Enter sends on keyboards; on touch devices Enter inserts a newline and the
  // Send button sends. isComposing protects IME input (e.g. Chinese/Japanese).
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && finePointer.matches) {
    event.preventDefault();
    el.composer.requestSubmit();
  }
});

function autoGrow() {
  el.prompt.style.height = 'auto';
  el.prompt.style.height = `${Math.min(el.prompt.scrollHeight, 192)}px`;
}
el.prompt.addEventListener('input', autoGrow);

el.stop.addEventListener('click', () => inFlight?.controller.abort());

// ---------------------------------------------------------------------------
// sidebar wiring

el.newChat.addEventListener('click', newChat);
el.topbarNewChat.addEventListener('click', newChat);
el.clearHistory.addEventListener('click', clearHistory);
el.sidebarToggle.addEventListener('click', () => {
  const opening = !document.body.classList.contains('drawer-open');
  setDrawer(opening);
  if (opening) el.newChat.focus();
});
el.backdrop.addEventListener('click', () => setDrawer(false));
el.closeSidebar.addEventListener('click', () => {
  setDrawer(false);
  el.sidebarToggle.focus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('drawer-open') && !el.dialog.open) {
    setDrawer(false);
    el.sidebarToggle.focus();
  }
});
wideScreen.addEventListener('change', () => setDrawer(false));

// iOS Safari doesn't shrink the layout when the on-screen keyboard opens; it overlays it, so a
// 100dvh layout would hide the composer behind the keyboard. Size the shell to the *visible*
// viewport instead (styles.css: --app-height). Skipped while pinch-zoomed, when the visual
// viewport is small for a different reason. Android Chrome resizes the layout itself
// (interactive-widget=resizes-content), where this is a harmless no-op.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fitToVisibleViewport = () => {
    if (vv.scale > 1.01) return;
    // If the reader was at the latest message, keep it in view as the panel shrinks/grows.
    const atBottom = el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight < 24;
    document.documentElement.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
    if (atBottom) el.chat.scrollTop = el.chat.scrollHeight;
    if (vv.offsetTop > 0) window.scrollTo(0, 0); // iOS scrolls the page to show the input; undo it
  };
  vv.addEventListener('resize', fitToVisibleViewport);
  fitToVisibleViewport();
}

// ---------------------------------------------------------------------------
// settings dialog

function populateModelSuggestions() {
  for (const { id, label } of SUGGESTED_MODELS) {
    const option = document.createElement('option');
    option.value = id;
    option.label = label;
    option.textContent = label;
    el.modelList.append(option);
  }
}

function showSettingsError(text) {
  el.settingsError.textContent = text ?? '';
  el.settingsError.hidden = !text;
}

function openSettings(reason) {
  el.keyInput.value = keystore.getKey();
  el.modelInput.value = currentModel();
  setKeyVisible(false);
  showSettingsError(reason);
  setDrawer(false);
  if (!el.dialog.open) el.dialog.showModal();
  (el.keyInput.value ? el.modelInput : el.keyInput).focus();
}

function setKeyVisible(visible) {
  el.keyInput.type = visible ? 'text' : 'password';
  el.toggleKey.textContent = visible ? 'Hide' : 'Show';
  el.toggleKey.setAttribute('aria-pressed', String(visible));
}

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const key = el.keyInput.value.trim();
  const model = el.modelInput.value.trim();
  if (!key) return showSettingsError('Enter your OpenRouter API key.');
  if (/\s/.test(key) || !/^[\x21-\x7E]+$/.test(key)) {
    return showSettingsError('That key contains spaces or unusual characters. Copy it again from openrouter.ai/keys.');
  }
  if (!model) return showSettingsError('Choose or type a model ID.');
  if (/\s/.test(model)) return showSettingsError('Model IDs have no spaces, e.g. openrouter/free.');

  keystore.setKey(key); // sessionStorage only (ADR-0002)
  chats.setPrefs({ model }); // localStorage preference (ADR-0004)
  el.dialog.close();
  render({ scroll: false });
  el.prompt.focus();
});

el.toggleKey.addEventListener('click', () => setKeyVisible(el.keyInput.type === 'password'));
el.cancelSettings.addEventListener('click', () => el.dialog.close());
el.forgetKey.addEventListener('click', () => {
  keystore.forgetKey();
  el.keyInput.value = '';
  showSettingsError('');
  refreshChrome();
  el.keyInput.focus();
});
// Clicking the backdrop (outside the form) closes the dialog.
el.dialog.addEventListener('click', (event) => {
  if (event.target === el.dialog) el.dialog.close();
});

el.openSettings.addEventListener('click', () => openSettings());
el.modelChip.addEventListener('click', () => {
  openSettings();
  el.modelInput.focus();
  el.modelInput.select();
});
el.emptyOpenSettings.addEventListener('click', () => openSettings());

// ---------------------------------------------------------------------------
// boot

populateModelSuggestions();
render();
// First run (ADR-0003, QST-DEFAULT-MODEL = C): no default model — ask for key and model together.
// A returning user with a saved model but a closed tab (sessionStorage key gone) lands here too.
if (!isConfigured()) openSettings();
