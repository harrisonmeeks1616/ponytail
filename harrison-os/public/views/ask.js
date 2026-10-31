// Ask (Lumen): the top-bar Ask drawer, the Memory card "Ask with AI" and the project block "Catch me up".
// Talks to /api/ask, /api/ai/status, /api/ai/consent and /api/projects/:id/brief (src/ask.js).
// Plain language only: no model names, ids or diagnostics. "AI answer" and "Not AI" are always labelled.

const ASK_TIMEOUT_MS = 40000; // the server's AI deadline is at most 30 s; kit.api's 15 s would cut it short
const MODES = [
  ['retrieve', 'Find'],
  ['plan', 'Plan'],
  ['resume', 'Catch up'],
  ['write', 'Write'],
];
const REASON_WORDS = {
  not_configured: 'AI is not set up, so this comes straight from your saved records.',
  consent_off: 'AI is off for this view. You can turn it on per scope in Memory, under Ask with AI. In All, both Work and Personal need it on.',
  timeout: 'AI took too long, so this comes straight from your saved records.',
  cancelled: 'Stopped. This comes straight from your saved records.',
  provider_error: 'AI could not be reached just now, so this comes straight from your saved records.',
  invalid_output: 'The AI reply could not be checked against your records, so it is not shown.',
};
const SCOPE_WORDS = { all: 'Work and Personal', work: 'Work', personal: 'Personal' };

let kit;
let drawer = null;
let inFlight = null;
let status = null; // last /api/ai/status: { configured, consent: { work, personal } }

async function loadStatus() {
  const r = await kit.api('/api/ai/status');
  if (r.ok && r.data) status = r.data;
  return r;
}

// One request with its own AbortController: Cancel, closing the drawer and the deadline all abort it.
async function postAsk(body, controller) {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ASK_TIMEOUT_MS);
  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });
    let data = null;
    if ((res.headers.get('content-type') || '').includes('application/json')) data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, signin: res.type === 'opaqueredirect' || res.status === 401 };
  } catch {
    return { ok: false, status: 0, data: null, timedOut, cancelled: !timedOut && controller.signal.aborted, offline: !timedOut && !controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

function sourceHref(s) {
  const id = String(s.ref || '').slice(String(s.ref || '').indexOf(':') + 1);
  if (!kit.PATH_ID_RE.test(id)) return null;
  if (s.ref.startsWith('project:')) return `#/project/${kit.enc(id)}`;
  if (s.ref.startsWith('item:')) {
    if (s.kind === 'waiting') return '#/waiting';
    if (s.kind === 'task') return '#/tasks';
    if (s.project_id && kit.PATH_ID_RE.test(String(s.project_id))) return `#/project/${kit.enc(s.project_id)}`;
  }
  return null;
}

function sourceWord(ref) {
  const t = String(ref || '').split(':')[0];
  return { item: 'Item', capture: 'Capture', project: 'Project', event: 'Calendar', pm: 'Company project' }[t] || 'Record';
}

function sourcesList(sources, onNavigate) {
  const { h } = kit;
  if (!Array.isArray(sources) || !sources.length) return null;
  const ul = h('ul', { class: 'list ask-sources', 'aria-label': 'Sources' });
  for (const s of sources) {
    const inner = [
      h('span', { class: 'chips' }, h('span', { class: 'chip chip-kind', text: sourceWord(s.ref) }), kit.scopeChip(s.scope), kit.sampleChip(s)),
      h('span', { class: 'row-title', text: kit.excerpt(s.title || '', 140) || '(untitled)' }),
    ];
    const href = sourceHref(s);
    ul.append(h('li', null, href ? h('a', { class: 'row-link', href, onclick: onNavigate }, inner) : h('div', { class: 'plain-row' }, inner)));
  }
  return ul;
}

function labelChip(live) {
  return kit.h('p', { class: `ask-label ${live ? 'is-ai' : 'is-not-ai'}`, text: live ? 'AI answer' : 'Not AI. Matched from your saved records.' });
}

function renderAnswer(a) {
  const { h } = kit;
  const out = h('div', { class: 'ask-answer' }, labelChip(a.live_ai));
  if (!a.live_ai && REASON_WORDS[a.fallback_reason]) out.append(h('p', { class: 'subtle small', text: REASON_WORDS[a.fallback_reason] }));
  out.append(h('div', { class: 'ask-text', text: a.text || '' }));
  const list = sourcesList(a.sources, () => closeDrawer());
  if (list) out.append(h('h3', { class: 'ask-sub', text: 'Sources' }), list);
  else out.append(h('p', { class: 'subtle small', text: 'No saved records were used.' }));
  return out;
}

// ---------------------------------------------------------------- the drawer

function currentProject() {
  const s = kit.state;
  if (!s.route || s.route.name !== 'project' || !s.project || s.project.id !== s.route.id) return null;
  return { id: s.project.id, name: (s.project.project && s.project.project.name) || 'This project', scope: s.project.scope };
}

function buildDrawer() {
  const { h } = kit;
  const d = h('dialog', { id: 'ask-sheet', class: 'sheet ask-sheet', 'aria-labelledby': 'ask-title' });
  const form = h('form', { class: 'form', novalidate: true });
  const question = h('textarea', { id: 'ask-question', rows: 3, maxlength: 1000, autocomplete: 'off', spellcheck: 'true' });
  const modes = h('fieldset', { class: 'segmented ask-modes' }, h('legend', { text: 'Kind of help' }));
  for (const [value, label] of MODES) {
    modes.append(h('label', { class: 'seg' }, h('input', { type: 'radio', name: 'ask-mode', value, checked: value === 'retrieve' }), h('span', { text: label })));
  }
  const where = h('p', { id: 'ask-where', class: 'subtle small' });
  const contextRow = h('div', { id: 'ask-context', class: 'ask-context' });
  const submit = h('button', { type: 'submit', id: 'ask-submit', class: 'btn btn-primary btn-block', text: 'Ask' });
  const cancel = h('button', { type: 'button', id: 'ask-cancel', class: 'btn btn-secondary btn-block', text: 'Cancel', hidden: true });
  const live = h('p', { id: 'ask-status', class: 'subtle', role: 'status', 'aria-live': 'polite' });
  const result = h('div', { id: 'ask-result' });
  form.append(
    h('div', { class: 'sheet-head' }, h('h2', { id: 'ask-title', text: 'Ask' }), h('button', { type: 'button', class: 'btn btn-ghost', text: 'Close', onclick: () => closeDrawer() })),
    h('label', { for: 'ask-question', text: 'What do you want to know?' }),
    question,
    contextRow,
    modes,
    where,
    submit,
    cancel,
    live,
  );
  d.append(form, result);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runAsk();
  });
  cancel.addEventListener('click', () => inFlight && inFlight.abort());
  d.addEventListener('close', () => inFlight && inFlight.abort());
  document.body.append(d);
  return d;
}

function renderContext() {
  const { h } = kit;
  const row = document.getElementById('ask-context');
  const p = drawer.dataset.projectId ? { id: drawer.dataset.projectId, name: drawer.dataset.projectName } : null;
  row.replaceChildren();
  if (p) {
    row.append(
      h('span', { class: 'chip ask-chip', text: `About: ${kit.excerpt(p.name, 60)}` }),
      h('button', {
        type: 'button',
        class: 'btn btn-ghost',
        text: 'Ask about everything',
        onclick: () => {
          delete drawer.dataset.projectId;
          renderContext();
        },
      }),
    );
  }
  const scope = drawer.dataset.projectScope || kit.state.scope;
  document.getElementById('ask-where').textContent = `Looks only in ${SCOPE_WORDS[scope] || 'this view'}. Ask reads your records and never changes them.`;
}

function openDrawer() {
  if (!drawer) drawer = buildDrawer();
  const p = currentProject();
  if (p) Object.assign(drawer.dataset, { projectId: p.id, projectName: p.name, projectScope: p.scope });
  else for (const k of ['projectId', 'projectName', 'projectScope']) delete drawer.dataset[k];
  renderContext();
  if (!drawer.open) {
    try {
      drawer.showModal();
    } catch {
      drawer.setAttribute('open', '');
    }
  }
  setTimeout(() => document.getElementById('ask-question').focus(), 30);
}

function closeDrawer() {
  if (inFlight) inFlight.abort();
  if (drawer && drawer.open) drawer.close();
}

async function runAsk() {
  const q = document.getElementById('ask-question').value.trim();
  const live = document.getElementById('ask-status');
  const result = document.getElementById('ask-result');
  if (!q) {
    live.textContent = 'Type a question first.';
    document.getElementById('ask-question').focus();
    return;
  }
  if (inFlight) return;
  const mode = (drawer.querySelector('input[name="ask-mode"]:checked') || {}).value || 'retrieve';
  const projectId = drawer.dataset.projectId || null;
  const scope = projectId ? drawer.dataset.projectScope : kit.state.scope;
  const submit = document.getElementById('ask-submit');
  const cancel = document.getElementById('ask-cancel');
  const controller = new AbortController();
  inFlight = controller;
  submit.disabled = true;
  cancel.hidden = false;
  live.textContent = 'Looking through your records…';
  result.replaceChildren();
  try {
    const r = await postAsk({ scope, question: q, mode, context: projectId ? { project_id: projectId } : undefined, tz: kit.deviceTimeZone() }, controller);
    if (r.ok && r.data && r.data.answer) {
      result.replaceChildren(renderAnswer(r.data.answer));
      live.textContent = r.data.answer.live_ai ? 'AI answer ready.' : 'Answer ready. Not AI.';
    } else if (r.cancelled) {
      live.textContent = 'Stopped. Nothing was changed.';
    } else if (r.timedOut) {
      live.textContent = 'No answer within 40 seconds. Nothing was changed. Try again, or ask a narrower question.';
    } else if (r.offline) {
      live.textContent = 'No connection. Ask needs the server; try again when you are back online.';
    } else if (r.signin) {
      live.textContent = 'Sign in again, then ask again.';
    } else if (r.status === 404) {
      live.textContent = 'That project is no longer here. Tap Ask about everything and try again.';
    } else {
      const code = r.data && r.data.error && r.data.error.code;
      live.textContent = `Could not ask (${code || `HTTP ${r.status}`}).`;
    }
  } finally {
    inFlight = null;
    submit.disabled = false;
    cancel.hidden = true;
  }
}

// ---------------------------------------------------------------- Memory card: Ask with AI

async function memoryCard() {
  const { h } = kit;
  const card = h('div', { class: 'card ask-ai-card' });
  const r = await loadStatus();
  if (!r.ok || !status) {
    card.append(kit.noticeBlock(kit.failWords(r, 'load the AI setting'), () => kit.reloadCurrent()));
    return kit.section('Ask with AI', card, 'memory-ask-ai');
  }
  card.append(
    h('p', { class: 'ask-setup', text: status.configured ? 'Set up.' : 'Not set up.' }),
    h(
      'p',
      { class: 'subtle small' },
      status.configured
        ? 'Ask can use Claude, an AI service from Anthropic, for the scopes you allow below.'
        : 'AI needs an Anthropic API key added to the server. Until then Ask still answers, straight from your saved records, labelled Not AI.',
    ),
    h('p', { class: 'small', text: 'When a scope is allowed, Ask sends your question and the matching records from that scope (titles, dates, who owes what and short notes) to Anthropic to write the answer. Harrison OS does not save your questions or answers. Records from a scope that is not allowed are never sent.' }),
  );
  for (const scope of ['work', 'personal']) {
    const id = `ask-consent-${scope}`;
    const box = h('input', { type: 'checkbox', id, checked: !!status.consent[scope] });
    const note = h('span', { class: 'subtle small', 'aria-live': 'polite' });
    box.addEventListener('change', async () => {
      const want = box.checked;
      box.disabled = true;
      const res = await kit.api('/api/ai/consent', { method: 'PUT', body: { scope, allowed: want } });
      box.disabled = false;
      if (res.ok && res.data) {
        status = res.data;
        box.checked = !!status.consent[scope];
        note.textContent = box.checked ? 'Allowed.' : 'Off. Nothing from here is sent.';
      } else {
        box.checked = !want;
        note.textContent = kit.failWords(res, 'save that');
      }
    });
    card.append(h('div', { class: 'ask-toggle' }, box, h('label', { for: id, text: `Allow ${SCOPE_WORDS[scope]} text to be sent to AI` }), note));
  }
  return kit.section('Ask with AI', card, 'memory-ask-ai');
}

// ---------------------------------------------------------------- project block: Catch me up

function briefNode(brief) {
  const { h } = kit;
  const out = h('div', { class: 'ask-brief' }, labelChip(false));
  if (brief.gap_note) out.append(h('p', { class: 'ask-gap', text: brief.gap_note }));
  if (kit.sampleChip(brief.project)) out.append(h('p', { class: 'chips' }, kit.sampleChip(brief.project), h('span', { class: 'subtle small', text: 'This project is sample data, not real.' })));
  const refRow = (title, meta, row) => h('div', { class: 'plain-row' }, kit.sampleChip(row) ? h('span', { class: 'chips' }, kit.sampleChip(row)) : null, h('span', { class: 'row-title', text: title }), meta ? h('span', { class: 'row-meta', text: meta }) : null);
  if (brief.next_action) {
    out.append(h('h3', { class: 'ask-sub', text: 'Next' }), refRow(brief.next_action.text, brief.next_action.reason, brief.next_action));
  }
  const c = brief.checkpoint;
  if (c) {
    const dl = h('dl', { class: 'rows rows-stacked' });
    const row = (label, part) => part && dl.append(h('div', null, h('dt', { text: label }), h('dd', { text: part.text })));
    row('Stopped at', c.stopped_at);
    row('Open question', c.open_question);
    row('Next step', c.next_step);
    out.append(h('h3', { class: 'ask-sub', text: `Where you left off, ${kit.formatAt(c.at)}` }), dl);
  } else out.append(h('p', { class: 'subtle', text: 'No saved place yet. Showing the last two weeks.' }));
  const list = (title, rows) => {
    if (!rows.length) return;
    const ul = h('ul', { class: 'list' });
    for (const x of rows) ul.append(h('li', null, refRow(`${x.label}: ${x.title || ''}`, [x.detail, x.at ? kit.formatAt(x.at) : null].filter(Boolean).join(' · '), x)));
    out.append(h('h3', { class: 'ask-sub', text: title }), ul);
  };
  list(c ? 'Since then' : 'Recent changes', brief.changes || []);
  if (c && !(brief.changes || []).length) out.append(h('p', { class: 'subtle small', text: 'Nothing recorded on this project since then.' }));
  if (brief.changes_more) out.append(h('p', { class: 'subtle small', text: `${kit.plural(brief.changes_more, 'older change', 'older changes')} not shown.` }));
  list('Still open', brief.unresolved || []);
  const src = sourcesList(brief.sources);
  if (src) out.append(h('details', { class: 'ask-more' }, h('summary', { class: 'btn btn-ghost', text: `Sources (${brief.sources.length})` }), src));
  return out;
}

async function projectBlock(pd) {
  const { h } = kit;
  if (!pd || !pd.id || !kit.isScope(pd.scope)) return null;
  const holder = h('div', { class: 'ask-brief-holder' });
  const aiHolder = h('div', { class: 'ask-ai-summary' });
  const go = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Catch me up' });
  const aiBtn = h('button', { type: 'button', class: 'btn btn-ghost', text: 'Add an AI summary', hidden: true });
  const path = (ai) => `/api/projects/${kit.enc(pd.id)}/brief?${kit.qs({ scope: pd.scope, tz: kit.deviceTimeZone(), ai: ai ? '1' : '' })}`;
  go.addEventListener('click', () =>
    kit.guarded(go, async () => {
      const r = await kit.api(path(false));
      if (!r.ok || !r.data || !r.data.brief) {
        holder.replaceChildren(kit.noticeBlock(kit.failWords(r, 'build the catch-up'), null));
        return;
      }
      holder.replaceChildren(briefNode(r.data.brief));
      go.textContent = 'Refresh';
      if (!status) await loadStatus();
      aiBtn.hidden = !(status && status.configured && status.consent[pd.scope]);
    }),
  );
  aiBtn.addEventListener('click', () =>
    kit.guarded(aiBtn, async () => {
      aiHolder.replaceChildren(h('p', { class: 'subtle', role: 'status', text: 'Writing a summary…' }));
      const r = await kit.api(path(true));
      const ai = r.ok && r.data && r.data.brief && r.data.brief.ai;
      if (ai && ai.live_ai) aiHolder.replaceChildren(h('div', { class: 'ask-answer' }, labelChip(true), h('div', { class: 'ask-text', text: ai.text }), sourcesList(ai.sources)));
      else aiHolder.replaceChildren(h('p', { class: 'subtle small', text: ai ? REASON_WORDS[ai.fallback_reason] || 'No AI summary this time.' : kit.failWords(r, 'add an AI summary') }));
    }),
  );
  const body = h('div', { class: 'stack' }, h('p', { class: 'subtle small', text: 'What changed since you last saved your place, what is still open and the next useful step. Built from your saved records.' }), h('div', { class: 'button-row' }, go, aiBtn), aiHolder, holder);
  return kit.section('Catch me up', body, 'project-catch-up');
}

// ---------------------------------------------------------------- registration

export function register(k) {
  kit = k;
  const btn = kit.addTopbarButton({ label: 'Ask', id: 'ask-open', onClick: openDrawer });
  if (btn) {
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.replaceChildren(
      kit.h('span', { class: 'ask-icon', 'aria-hidden': 'true', text: '✦' }),
      kit.h('span', { class: 'ask-open-text', text: 'Ask' }),
    );
    btn.setAttribute('aria-label', 'Ask');
  }
  kit.addMemoryBlock(() => memoryCard());
  kit.addProjectBlock((pd) => projectBlock(pd));
}
