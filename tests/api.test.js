// Unit tests for site/js/api.js — the OpenRouter client (ADR-0003, ADR-0005).
//
// The network boundary is replaced by a fetch stand-in that returns real
// `Response` objects (Node's built-in WHATWG fetch types), so these tests run
// the module's own parsing and mapping code end to end, with no dependencies.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CHAT_URL, ChatError, buildChatRequest, sendChat, toApiMessages } from '../site/js/api.js';

const KEY = 'sk-or-v1-test-key-not-real';
const MODEL = 'openrouter/free';

/** A short conversation as app.js holds it: real turns plus UI-only notices. */
function conversationWithNotices() {
  return [
    { role: 'user', content: 'Hi', ts: 1 },
    { role: 'notice', kind: 'error', text: 'Rate limited. Wait a moment and try again.', ts: 2 },
    { role: 'notice', kind: 'stopped', text: 'Stopped.', ts: 3 },
    { role: 'assistant', content: 'Hello! How can I help?', model: MODEL, ts: 4 },
    { role: 'user', content: 'What is CORS?', ts: 5 },
  ];
}

/** fetch stand-in: answers every call with one canned HTTP response. */
function respondWith(status, body, contentType = 'application/json') {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { 'content-type': contentType } });
  };
  return { fetchImpl, calls };
}

async function sendExpectingError(status, body, contentType) {
  const { fetchImpl } = respondWith(status, body, contentType);
  try {
    await sendChat({ apiKey: KEY, model: MODEL, history: conversationWithNotices(), fetchImpl });
  } catch (err) {
    assert.ok(err instanceof ChatError, `expected ChatError, got ${err}`);
    return err;
  }
  assert.fail(`expected HTTP ${status} to reject`);
}

describe('buildChatRequest', () => {
  it('sends only the real conversation turns, in order — error and "Stopped." notices never reach the model', () => {
    const { init } = buildChatRequest({ apiKey: KEY, model: MODEL, history: conversationWithNotices() });
    assert.deepEqual(JSON.parse(init.body), {
      model: MODEL,
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello! How can I help?' },
        { role: 'user', content: 'What is CORS?' },
      ],
    });
  });

  it('puts the API key only in the Authorization header — never in the URL or the request body', () => {
    const { url, init } = buildChatRequest({ apiKey: KEY, model: MODEL, history: conversationWithNotices() });
    assert.equal(url, CHAT_URL);
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
    assert.ok(!url.includes(KEY));
    assert.ok(!init.body.includes(KEY));
  });

  it('identifies the app to OpenRouter with the attribution headers (both allowed by its CORS preflight)', () => {
    const { init } = buildChatRequest({
      apiKey: KEY,
      model: MODEL,
      history: conversationWithNotices(),
      referer: 'https://example.github.io/openrouter-chat-harness/',
    });
    assert.equal(init.headers['X-Title'], 'OpenRouter Chat Harness');
    assert.equal(init.headers['HTTP-Referer'], 'https://example.github.io/openrouter-chat-harness/');
  });

  it('accepts a key pasted with surrounding whitespace or a trailing newline', () => {
    const { init } = buildChatRequest({ apiKey: `  ${KEY}\n`, model: MODEL, history: conversationWithNotices() });
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  });

  it('rejects a key mangled by copy-paste (smart quote) up front, instead of failing later as a fake "network" error', () => {
    assert.throws(
      () => buildChatRequest({ apiKey: `“${KEY}”`, model: MODEL, history: conversationWithNotices() }),
      (err) => err instanceof ChatError && err.kind === 'config' && /unusual characters/.test(err.message),
    );
  });

  it('refuses to send without a key or a model, with a message that points to Settings', () => {
    for (const [apiKey, model] of [['', MODEL], [KEY, '  ']]) {
      assert.throws(
        () => buildChatRequest({ apiKey, model, history: conversationWithNotices() }),
        (err) => err instanceof ChatError && err.kind === 'config' && /Settings/.test(err.message),
      );
    }
  });
});

describe('toApiMessages', () => {
  it('drops entries that are not user/assistant text turns', () => {
    const turns = toApiMessages([
      { role: 'notice', kind: 'info', text: 'Reply was cut off (length limit).' },
      { role: 'assistant', content: null }, // never a valid turn
      { role: 'user', content: 'ok' },
    ]);
    assert.deepEqual(turns, [{ role: 'user', content: 'ok' }]);
  });
});

describe('sendChat — success', () => {
  it('returns the reply text, the model that actually answered, and the finish reason', async () => {
    const { fetchImpl, calls } = respondWith(200, {
      id: 'gen-1',
      model: 'google/gemma-4-31b-it:free', // openrouter/free routed to a concrete model
      choices: [{ message: { role: 'assistant', content: 'CORS lets a page call another origin.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 9, total_tokens: 29 },
    });
    const reply = await sendChat({ apiKey: KEY, model: MODEL, history: conversationWithNotices(), fetchImpl });
    assert.equal(reply.content, 'CORS lets a page call another origin.');
    assert.equal(reply.model, 'google/gemma-4-31b-it:free');
    assert.equal(reply.finishReason, 'stop');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
  });

  it('reports a reply cut off by the length limit so the UI can say so', async () => {
    const { fetchImpl } = respondWith(200, {
      model: MODEL,
      choices: [{ message: { role: 'assistant', content: 'The answer begins…' }, finish_reason: 'length' }],
    });
    const reply = await sendChat({ apiKey: KEY, model: MODEL, history: conversationWithNotices(), fetchImpl });
    assert.equal(reply.finishReason, 'length');
  });
});

describe('sendChat — error mapping (ADR-0003 error table)', () => {
  it('401: explains the key problem and hides OpenRouter\'s confusing "cookie" wording', async () => {
    // Body observed verbatim by scripts/ephemeral/2026-11-12-cors-preflight-probe.sh.
    const err = await sendExpectingError(401, { error: { message: 'No cookie auth credentials found', code: 401 } });
    assert.equal(err.kind, 'auth');
    assert.match(err.message, /API key is missing or invalid/);
    assert.doesNotMatch(err.message, /cookie/i);
  });

  it('402: out of credits — suggests a free model', async () => {
    const err = await sendExpectingError(402, { error: { message: 'Insufficient credits', code: 402 } });
    assert.equal(err.kind, 'credits');
    assert.match(err.message, /openrouter\/free/);
  });

  it('400 context overflow: tells the user to start a new chat or switch models (ADR-0003, QST-HISTORY-LIMIT = A)', async () => {
    const err = await sendExpectingError(400, {
      error: { message: "This endpoint's maximum context length is 131072 tokens. However, you requested about 140000 tokens.", code: 400 },
    });
    assert.equal(err.kind, 'context');
    assert.match(err.message, /too long for the selected model/);
  });

  it('400 otherwise: passes the provider\'s explanation through as text', async () => {
    const err = await sendExpectingError(400, { error: { message: 'openrouter/fre is not a valid model ID', code: 400 } });
    assert.equal(err.kind, 'bad-request');
    assert.match(err.message, /openrouter\/fre is not a valid model ID/);
  });

  it('404: unknown model points the user back to Settings', async () => {
    const err = await sendExpectingError(404, { error: { message: 'No endpoints found for acme/nope.', code: 404 } });
    assert.equal(err.kind, 'model');
    assert.match(err.message, /Pick another model in Settings/);
  });

  it('429: rate limited', async () => {
    const err = await sendExpectingError(429, { error: { message: 'Rate limit exceeded: free-models-per-day', code: 429 } });
    assert.equal(err.kind, 'rate-limit');
  });

  it('502 with an HTML error page (a CDN in front of the API) still produces a readable message', async () => {
    const err = await sendExpectingError(502, '<html><body><h1>502 Bad Gateway</h1></body></html>', 'text/html');
    assert.equal(err.kind, 'provider');
    assert.match(err.message, /HTTP 502/);
  });

  it('an error reported inside an HTTP 200 body is still treated as an error', async () => {
    const err = await sendExpectingError(200, { error: { message: 'Provider returned error', code: 502 } });
    assert.equal(err.kind, 'provider');
  });

  it('an empty reply is an error, not a blank bubble', async () => {
    const err = await sendExpectingError(200, {
      model: MODEL,
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
    });
    assert.equal(err.kind, 'empty');
    assert.match(err.message, /ran out of tokens/);
  });

  it('never displays a key-shaped string echoed back by an upstream provider', async () => {
    const err = await sendExpectingError(400, {
      error: { message: 'Incorrect API key provided: sk-proj-abc123def456ghi789. You can find your key…', code: 400 },
    });
    assert.doesNotMatch(err.message, /sk-proj-abc123/);
    assert.match(err.message, /\[redacted key\]/);
  });
});

describe('sendChat — transport failures', () => {
  it('a network failure (offline, DNS, blocked by an extension) becomes a "couldn\'t reach" message', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(
      sendChat({ apiKey: KEY, model: MODEL, history: conversationWithNotices(), fetchImpl }),
      (err) => err instanceof ChatError && err.kind === 'network' && /Couldn't reach OpenRouter/.test(err.message),
    );
  });

  it('pressing Stop aborts the request and reports "Stopped.", not an error', async () => {
    const controller = new AbortController();
    // Behaves like browser fetch: rejects with AbortError when the signal fires.
    const fetchImpl = (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('The user aborted a request.', 'AbortError')));
      });
    const pending = sendChat({
      apiKey: KEY,
      model: MODEL,
      history: conversationWithNotices(),
      signal: controller.signal,
      fetchImpl,
    });
    controller.abort();
    await assert.rejects(pending, (err) => err instanceof ChatError && err.kind === 'aborted' && err.message === 'Stopped.');
  });
});
