// DOM rendering for chat messages (ADR-0002, QST-RENDERING = B; Phase 1 = plain text).
//
// INVARIANT: model output and provider error text are only ever assigned via
// textContent — never innerHTML, insertAdjacentHTML, or similar. A reply that
// contains "<script>" or "<img onerror=…>" is displayed as those characters.

const ROLE_LABEL = { user: 'You', assistant: 'Assistant', notice: 'Notice' };

/**
 * @param {{role: 'user'|'assistant'|'notice', content?: string, text?: string, kind?: string, model?: string}} msg
 * @param {{actions?: Array<{label: string, onClick: () => void}>}} [options]
 */
export function renderMessage(msg, { actions = [] } = {}) {
  const li = document.createElement('li');
  li.className = `msg msg--${msg.role}`;
  if (msg.kind) li.classList.add(`msg--${msg.kind}`);

  const label = document.createElement('span');
  label.className = 'visually-hidden';
  label.textContent = `${ROLE_LABEL[msg.role] ?? msg.role}: `;
  li.append(label);

  const body = document.createElement('div');
  body.className = 'msg__body';
  body.textContent = msg.role === 'notice' ? msg.text : msg.content;
  li.append(body);

  if (msg.role === 'assistant' && msg.model) {
    const meta = document.createElement('div');
    meta.className = 'msg__meta';
    meta.textContent = msg.model;
    li.append(meta);
  }

  if (actions.length > 0) {
    const row = document.createElement('div');
    row.className = 'msg__actions';
    for (const { label: text, onClick } of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--small';
      button.textContent = text;
      button.addEventListener('click', onClick);
      row.append(button);
    }
    li.append(row);
  }

  return li;
}

/** The "waiting for a reply" bubble. */
export function renderPending() {
  const li = document.createElement('li');
  li.className = 'msg msg--assistant msg--pending';
  const sr = document.createElement('span');
  sr.className = 'visually-hidden';
  sr.textContent = 'Waiting for a reply…';
  li.append(sr);
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    li.append(dot);
  }
  return li;
}
