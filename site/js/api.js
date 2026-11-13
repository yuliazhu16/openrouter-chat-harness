// OpenRouter Chat Completions client (ADR-0003).
//
// PURE MODULE: no DOM access, so tests/api.test.js imports it directly under Node
// (ADR-0005). The browser calls OpenRouter directly — CORS verified by
// scripts/ephemeral/2026-11-12-cors-preflight-probe.sh: preflight 204 and error
// responses both carry `access-control-allow-origin: *`.

export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const APP_TITLE = 'OpenRouter Chat Harness';

/**
 * Every failure the UI can show. `message` is user-facing; `detail` is the
 * provider's raw message (key-shaped strings redacted), displayed only as text.
 * kind: config | network | aborted | auth | credits | moderation | model |
 *       timeout | rate-limit | context | bad-request | provider | empty | unknown
 */
export class ChatError extends Error {
  constructor(kind, message, { status = null, detail = null } = {}) {
    super(message);
    this.name = 'ChatError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

const NETWORK_MESSAGE =
  "Couldn't reach OpenRouter. Check your connection (or a blocking extension) and try again.";

// Headers must be printable ASCII; a key pasted with a smart quote or an inner
// space would make fetch() throw a TypeError that looks exactly like a network
// failure. Catch it here and say what is actually wrong.
const KEY_SHAPE = /^[\x21-\x7E]+$/;

// Provider wording for context-window overflow varies; these cover the common forms.
const CONTEXT_OVERFLOW = /context (length|window)|maximum context|too many tokens|token limit|prompt is too long|too long for/i;

/**
 * Only real conversation turns go to the model. UI-only entries (role "notice":
 * errors, "Stopped.", cut-off warnings) live in the same history array but must
 * never be sent (ADR-0004, Explicitation #4).
 */
export function toApiMessages(history) {
  return history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(({ role, content }) => ({ role, content }));
}

/** Build the fetch() arguments. Throws ChatError('config') for anything we can catch before the network. */
export function buildChatRequest({ apiKey, model, history, referer }) {
  const key = (apiKey ?? '').trim();
  const modelId = (model ?? '').trim();
  if (!key) throw new ChatError('config', 'Add your OpenRouter API key in Settings first.');
  if (!KEY_SHAPE.test(key)) {
    throw new ChatError('config', 'That API key contains spaces or unusual characters. Paste it again in Settings.');
  }
  if (!modelId) throw new ChatError('config', 'Choose a model in Settings first.');

  const messages = toApiMessages(history ?? []);
  if (messages.length === 0) throw new ChatError('config', 'There is no message to send.');

  const headers = {
    Authorization: `Bearer ${key}`, // the ONLY place the key ever goes
    'Content-Type': 'application/json',
    'X-Title': APP_TITLE,
  };
  if (referer) headers['HTTP-Referer'] = referer;

  return {
    url: CHAT_URL,
    init: { method: 'POST', headers, body: JSON.stringify({ model: modelId, messages }) },
  };
}

/** Send the conversation and return the assistant's reply. Always throws ChatError on failure. */
export async function sendChat({ apiKey, model, history, referer, signal, fetchImpl = globalThis.fetch }) {
  const { url, init } = buildChatRequest({ apiKey, model, history, referer });

  let response;
  let text;
  try {
    response = await fetchImpl(url, { ...init, signal });
    text = await response.text();
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw new ChatError('aborted', 'Stopped.');
    throw new ChatError('network', NETWORK_MESSAGE);
  }

  const body = parseJson(text);
  if (!response.ok) throw describeHttpError(response.status, body);
  return parseCompletion(body, response.status);
}

/** Map an HTTP error status (+ parsed body, possibly null) to a user-facing ChatError. */
export function describeHttpError(status, body) {
  const detail = providerMessage(body);
  const withDetail = (lead) => (detail ? `${lead}: ${detail}` : `${lead}.`);

  switch (status) {
    case 400:
      if (detail && CONTEXT_OVERFLOW.test(detail)) {
        return new ChatError(
          'context',
          'This conversation is too long for the selected model. Start a new chat or choose a model with a larger context window.',
          { status, detail },
        );
      }
      return new ChatError('bad-request', withDetail('OpenRouter rejected the request'), { status, detail });
    case 401:
      // OpenRouter's own text here is "No cookie auth credentials found", which
      // means nothing to a BYOK user, so it is deliberately not shown.
      return new ChatError('auth', 'Your API key is missing or invalid. Open Settings to check it.', { status, detail });
    case 402:
      return new ChatError(
        'credits',
        'Your OpenRouter account is out of credits. Add credits, or choose a free model such as openrouter/free.',
        { status, detail },
      );
    case 403:
      return new ChatError('moderation', withDetail('The request was blocked by moderation'), { status, detail });
    case 404:
      return new ChatError(
        'model',
        "That model wasn't found or has no available provider. Pick another model in Settings.",
        { status, detail },
      );
    case 408:
    case 504:
      return new ChatError('timeout', 'The model took too long to respond. Try again.', { status, detail });
    case 429:
      return new ChatError(
        'rate-limit',
        'Rate limited. Wait a moment and try again (free models have tight limits).',
        { status, detail },
      );
    default:
      if (status >= 500) {
        return new ChatError(
          'provider',
          `The model provider had a problem (HTTP ${status}). Try again or switch models.`,
          { status, detail },
        );
      }
      return new ChatError('unknown', withDetail(`Unexpected response (HTTP ${status})`), { status, detail });
  }
}

// ---------------------------------------------------------------------------

function parseCompletion(body, status) {
  if (!body || typeof body !== 'object') {
    throw new ChatError('unknown', `Unexpected response (HTTP ${status}).`, { status });
  }

  // OpenRouter can report a failure inside an HTTP 200 body, at the top level
  // or on the choice itself.
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
  const embedded = body.error ?? choice?.error;
  if (embedded) {
    const code = Number(embedded.code);
    if (Number.isInteger(code) && code >= 400) throw describeHttpError(code, { error: embedded });
    const detail = providerMessage({ error: embedded });
    throw new ChatError('empty', detail ? `The model returned an error: ${detail}` : 'The model returned an error.', {
      status,
      detail,
    });
  }

  const content = choice?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    const hint = choice?.finish_reason === 'length' ? ' It ran out of tokens before answering.' : '';
    throw new ChatError('empty', `The model returned an empty response.${hint} Try again or switch models.`, { status });
  }

  return {
    content,
    model: typeof body.model === 'string' ? body.model : null,
    finishReason: choice.finish_reason ?? null,
    usage: body.usage ?? null,
  };
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // e.g. an HTML error page from a CDN in front of the API
  }
}

function providerMessage(body) {
  const raw = body?.error?.message;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  // Upstream providers sometimes echo the key they were given ("Incorrect API key
  // provided: sk-…"). Never let anything key-shaped reach the screen.
  const redacted = raw.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted key]').trim();
  return redacted.length > 300 ? `${redacted.slice(0, 300)}…` : redacted;
}
