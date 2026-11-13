// Entry point: wires the page to the pure modules (ADR-0001 layout).
//
// Phase 1 scope (ADR-0005): settings, non-streaming send/receive, loading + Stop,
// mapped errors with Retry, multi-turn history IN MEMORY. Saving conversations
// (and New Chat / Clear History) arrives in Phase 2 (ADR-0004).

import { ChatError, sendChat, toApiMessages } from './api.js';
import { createKeystore } from './keystore.js';
import { SUGGESTED_MODELS } from './models.js';
import { renderMessage, renderPending } from './render.js';

const store = createKeystore();

/** The conversation: user/assistant turns plus UI-only "notice" entries (never sent; see api.js). */
const history = [];
/** AbortController of the request in flight, or null. One request at a time (ADR-0003). */
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

// ---------------------------------------------------------------------------
// state → UI

const isConfigured = () => Boolean(store.getKey() && store.getModel());

function refreshChrome() {
  const model = store.getModel();
  el.modelChip.textContent = model || 'Choose model';
  el.modelChip.classList.toggle('model-chip--unset', !model);

  const ready = isConfigured();
  const busy = inFlight !== null;
  el.prompt.placeholder = ready ? 'Message…' : 'Set key & model in Settings'; // must fit one line at 375px
  el.send.disabled = !ready || busy; // ADR-0003: Send disabled until key + model are set
  el.send.hidden = busy;
  el.stop.hidden = !busy;

  el.emptyState.hidden = history.length > 0;
  el.emptyConfigNote.hidden = ready;
}

function scrollToBottom() {
  el.chat.scrollTop = el.chat.scrollHeight;
}

function append(msg, options) {
  history.push(msg);
  el.messages.append(renderMessage(msg, options));
  refreshChrome();
  scrollToBottom();
}

function addNotice(kind, text, actions = []) {
  append({ role: 'notice', kind, text, ts: Date.now() }, { actions });
}

// ---------------------------------------------------------------------------
// sending

/** True when the last real turn is the user's, i.e. there is something to (re)send. */
function awaitingReply() {
  const turns = toApiMessages(history);
  return turns.length > 0 && turns[turns.length - 1].role === 'user';
}

async function requestReply() {
  if (inFlight || !awaitingReply()) return;

  const controller = new AbortController();
  inFlight = controller;
  const pending = renderPending();
  el.messages.append(pending);
  refreshChrome();
  scrollToBottom();

  try {
    const reply = await sendChat({
      apiKey: store.getKey(),
      model: store.getModel(),
      history,
      referer: `${location.origin}${location.pathname}`,
      signal: controller.signal,
    });
    pending.remove();
    append({ role: 'assistant', content: reply.content, model: reply.model, ts: Date.now() });
    if (reply.finishReason === 'length') addNotice('info', 'Reply was cut off (length limit).');
  } catch (err) {
    pending.remove();
    showFailure(err);
  } finally {
    inFlight = null;
    refreshChrome();
    if (finePointer.matches) el.prompt.focus(); // don't pop the on-screen keyboard on phones
  }
}

function showFailure(err) {
  const error =
    err instanceof ChatError ? err : new ChatError('unknown', 'Something went wrong. Please try again.');
  if (error.kind === 'aborted') {
    addNotice('stopped', 'Stopped.', [{ label: 'Retry', onClick: requestReply }]);
    return;
  }
  const actions = [{ label: 'Retry', onClick: requestReply }];
  if (['auth', 'config', 'credits', 'model'].includes(error.kind)) {
    actions.unshift({ label: 'Open Settings', onClick: () => openSettings() });
  }
  addNotice('error', error.message, actions);
}

el.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = el.prompt.value.trim();
  if (!text || inFlight) return;
  if (!isConfigured()) {
    openSettings('Add your API key and choose a model to start chatting.');
    return;
  }
  append({ role: 'user', content: text, ts: Date.now() });
  el.prompt.value = '';
  autoGrow();
  requestReply();
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

el.stop.addEventListener('click', () => inFlight?.abort());

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
  el.keyInput.value = store.getKey();
  el.modelInput.value = store.getModel();
  setKeyVisible(false);
  showSettingsError(reason);
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

  store.setKey(key);
  store.setModel(model);
  el.dialog.close();
  refreshChrome();
  if (!store.persistsAcrossReload) {
    addNotice('info', "This browser blocks storage here, so your key will be forgotten when you reload.");
  }
  el.prompt.focus();
});

el.toggleKey.addEventListener('click', () => setKeyVisible(el.keyInput.type === 'password'));
el.cancelSettings.addEventListener('click', () => el.dialog.close());
el.forgetKey.addEventListener('click', () => {
  store.forgetKey();
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
refreshChrome();
// First run (ADR-0003, QST-DEFAULT-MODEL = C): no default model — ask for key and model together.
if (!isConfigured()) openSettings();
