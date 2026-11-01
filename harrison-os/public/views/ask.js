// Ask (Lumen): the top-bar Ask drawer, the Memory card "Ask with AI" and the project block "Catch me up".
// Talks to /api/ask, /api/ai/status, /api/ai/consent, /api/ai/web, /api/ai/actions, /api/undo and
// /api/projects/:id/brief (src/ask.js).
// Plain language only: no model names, ids or diagnostics. "AI answer" and "Not AI" are always labelled;
// record sources are listed under "From your records", web sources (linked, new tab) under "From the web".

const ASK_TIMEOUT_MS = 40000; // the server's AI deadline is at most 30 s; kit.api's 15 s would cut it short
const MODES = [
  ['retrieve', 'Find'],
  ['plan', 'Plan'],
  ['resume', 'Catch up'],
  ['write', 'Write'],
];
export const REASON_WORDS = {
  not_configured: 'AI is not set up, so this comes straight from your saved records.',
  consent_off: 'AI is off for this view. You can turn it on per scope in Memory, under Ask with AI. In All, both Work and Personal need it on.',
  timeout: 'AI took too long, so this comes straight from your saved records.',
  cancelled: 'Stopped. This comes straight from your saved records.',
  provider_error: 'AI could not be reached just now, so this comes straight from your saved records.',
  auth_rejected: "The AI service rejected the server's API key, so this comes straight from your saved records. The key needs to be replaced in the server settings.",
  permission_denied: "The AI service refused this request for the server's API key (its account or workspace settings), so this comes straight from your saved records.",
  rate_limited: 'The AI service is busy for this account right now, so this comes straight from your saved records. Try again in a minute.',
  invalid_output: 'The AI reply could not be checked against your records, so it is not shown.',
  refused: 'The AI declined to answer this one, so this comes straight from your saved records.',
  incomplete: 'The AI answer was cut off, so it is not shown. This comes straight from your saved records.',
};
// What the answer says about the web. Only "used" means a search or a page actually came back.
const WEB_WORDS = {
  used: 'It searched the web; the pages it cites are linked below.',
  not_needed: 'It did not search the web for this.',
  failed: 'It tried the web, but the search did not work just now, so this is from what it already knows.',
  unavailable: 'Web search is turned off for this Anthropic account, so this is from what it already knows.',
  off: 'Web search is off for Ask, so this is from what it already knows.',
};
const SCOPE_WORDS = { all: 'Work and Personal', work: 'Work', personal: 'Personal' };

let kit;
let drawer = null;
let inFlight = null;
// The conversation, in this page's memory only (never stored): [{ q, a }] for live answers, and the view it
// belongs to. A new view (scope or project) or "New conversation" starts again.
let thread = [];
let threadKey = null;
export const HISTORY_LIMITS = Object.freeze({ exchanges: 6, question: 1000, answer: 6000, total: 30000 });

/** Pure: the history to send for a thread, newest exchanges kept, within the server's limits. */
export function historyFor(turns, limits = HISTORY_LIMITS) {
  const out = [];
  let total = 0;
  for (const t of turns.slice(-limits.exchanges).reverse()) {
    const q = String(t.q || '').slice(0, limits.question);
    const a = String(t.a || '').slice(0, limits.answer);
    if (!q.trim() || !a.trim() || total + q.length + a.length > limits.total) break;
    total += q.length + a.length;
    out.unshift({ role: 'user', text: q }, { role: 'assistant', text: a });
  }
  return out;
}
let status = null; // last /api/ai/status: { configured, consent: { work, personal }, web_allowed, web_server_off, web_available, actions: { mode, scopes } }
const WEB_TOOL_WORDS = { web_search: 'Web search', web_fetch: 'Reading web pages' };

// Full access in force for at least one scope that also has consent (what Ask can actually change).
function canChange(s) {
  return !!(s && s.configured && s.actions && s.actions.mode === 'full' && s.actions.scopes.some((x) => s.consent && s.consent[x]));
}

// What a stop or a timeout means for records: with Full, a change Ask already made stays.
function stoppedWords() {
  return canChange(status) ? 'Any change Ask had already made stays; check your records.' : 'Nothing was changed.';
}

/** An http(s) link for a web source, else null: nothing else (javascript:, data:, relative) becomes a link. */
export function webLinkHref(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

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

function webList(sources) {
  const { h } = kit;
  const rows = (Array.isArray(sources) ? sources : []).map((s) => [s, webLinkHref(s && s.url)]).filter(([, href]) => href);
  if (!rows.length) return null;
  const ul = h('ul', { class: 'list ask-sources ask-web', 'aria-label': 'Web sources' });
  for (const [s, href] of rows) {
    ul.append(
      h(
        'li',
        null,
        h(
          'a',
          { class: 'row-link', href, target: '_blank', rel: 'noopener noreferrer' },
          h('span', { class: 'chips' }, h('span', { class: 'chip chip-kind', text: new URL(href).hostname })),
          h('span', { class: 'row-title', text: kit.excerpt(s.title || href, 140) }),
          s.cited_text ? h('span', { class: 'row-meta', text: `“${kit.excerpt(s.cited_text, 160)}”` }) : null,
        ),
      ),
    );
  }
  return ul;
}

function labelChip(live) {
  return kit.h('p', { class: `ask-label ${live ? 'is-ai' : 'is-not-ai'}`, text: live ? 'AI answer' : 'Not AI. Matched from your saved records.' });
}

// What was sent and what the web did, in one line under a live answer.
function liveNote(a) {
  const sent = a.records_shared
    ? `Your ${(a.shared_scopes || []).map((s) => SCOPE_WORDS[s] || s).join(' and ')} records were sent to AI for this answer.`
    : 'No saved records were sent to AI for this answer.';
  const web = a.web === 'used' && !(a.web_sources || []).length ? 'It searched the web, but the answer cites no page: treat it as unchecked.' : WEB_WORDS[a.web];
  const partly = a.web !== 'unavailable' && (a.web_unavailable || []).length
    ? `${a.web_unavailable.map((t) => WEB_TOOL_WORDS[t] || t).join(' and ')} is turned off for this Anthropic account.`
    : null;
  const can = a.actions_mode === 'full' ? 'Ask has Full access here: the list below shows exactly what it changed.' : 'Ask cannot change anything.';
  return [sent, web, partly, `${can} AI can be wrong: check anything important.`].filter(Boolean).join(' ');
}

const TOOL_WORDS = { create_item: 'Added', update_item: 'Changed', item_action: 'Updated', record_decision: 'Recorded a decision', delete_item: 'Deleted an item', undo_change: 'Undid a change',
  create_project: 'Added a project', update_project: 'Changed a project', save_place: 'Saved a place', review_capture: 'Reviewed a capture', delete_capture: 'Deleted a capture',
  capture_text: 'Captured', create_reminder: 'Added a reminder', edit_reminder: 'Changed a reminder', cancel_reminder: 'Cancelled a reminder', set_preference: 'Saved a preference',
  delete_preference: 'Deleted a preference', create_draft: 'Prepared a draft', edit_draft: 'Changed a draft', check_draft: 'Checked a draft', delete_draft: 'Deleted a draft',
  weekly_review_select: 'Picked for the week', weekly_review_defer: 'Moved to a later week', weekly_review_complete: 'Marked the weekly review done',
  pm_create_record: 'Created a record', pm_update_record: 'Changed a record', pm_archive_record: 'Archived a record', pm_restore_record: 'Restored a record',
  field_edit_record: 'Changed a Field Hub record', field_retry_operation: 'Retried a Field Hub change' };
const APP_WORDS = { pm: 'Electrical PM', field: 'Field Hub, through Electrical PM' };

/** Pure: one change Ask attempted, in plain words. In another app only a "saved" receipt is called done. */
export function actionWords(a) {
  const source = a.app && a.app !== 'hos';
  const status = source && a.receipt ? a.receipt.status : null;
  const state = !a.ok ? 'Not done' : !source || status === 'saved' ? 'Done' : status === 'pending' ? 'Sent, waiting for Field Hub to confirm' : 'Sent, not confirmed as saved';
  const where = APP_WORDS[a.app] ? ` in ${APP_WORDS[a.app]}` : a.scope ? ` (${SCOPE_WORDS[a.scope] || a.scope})` : '';
  return `${state}: ${TOOL_WORDS[a.tool] || String(a.tool || '').replaceAll('_', ' ')}${where}`;
}

// Every change Ask attempted, from the server's own record of each call (not from the AI's words), each with
// Undo where the app keeps history. Shown also on a Not AI answer: a change made before the AI failed still stands.
function actionsList(actions) {
  const { h } = kit;
  if (!Array.isArray(actions) || !actions.length) return null;
  const ul = h('ul', { class: 'list ask-actions', 'aria-label': 'What Ask changed' });
  for (const a of actions) {
    const what = actionWords(a);
    const detail = a.ok ? [(a.ids || []).join(', '), a.receipt && a.receipt.status ? `PM: ${a.receipt.status}` : ''].filter(Boolean).join(' · ') : a.message || '';
    const li = h('li', { class: 'plain-row' }, h('span', { class: 'row-title', text: what }), detail ? h('span', { class: 'row-meta', text: detail }) : null);
    const changes = a.ok && a.tool !== 'undo_change' ? (a.change_ids || []).filter((c) => /^[0-9]{1,15}$/.test(String(c))) : [];
    if (changes.length) {
      const undo = h('button', { type: 'button', class: 'btn btn-ghost', text: 'Undo' });
      const note = h('span', { class: 'subtle small', 'aria-live': 'polite' });
      undo.addEventListener('click', () =>
        kit.guarded(undo, async () => {
          for (const c of [...changes].reverse()) {
            const r = await kit.api(`/api/undo/${kit.enc(c)}`, { method: 'POST', body: {} });
            if (!r.ok) {
              note.textContent = r.status === 409 ? 'Could not undo: it was changed again since.' : kit.failWords(r, 'undo');
              return;
            }
          }
          undo.hidden = true;
          note.textContent = 'Undone.';
        }),
      );
      li.append(undo, note);
    }
    ul.append(li);
  }
  return ul;
}

function renderAnswer(a) {
  const { h } = kit;
  const out = h('div', { class: 'ask-answer' }, labelChip(a.live_ai));
  if (!a.live_ai && REASON_WORDS[a.fallback_reason]) out.append(h('p', { class: 'subtle small', text: REASON_WORDS[a.fallback_reason] }));
  out.append(h('div', { class: 'ask-text', text: a.text || '' }));
  if (a.live_ai) out.append(h('p', { class: 'subtle small ask-note', text: liveNote(a) }));
  const acts = actionsList(a.actions);
  if (acts) out.append(h('h3', { class: 'ask-sub', text: 'What Ask changed' }), acts);
  const list = sourcesList(a.sources, () => closeDrawer());
  if (list) out.append(h('h3', { class: 'ask-sub', text: 'From your records' }), list);
  else if (!a.live_ai) out.append(h('p', { class: 'subtle small', text: 'No saved records were used.' }));
  const web = webList(a.web_sources);
  if (web) out.append(h('h3', { class: 'ask-sub', text: 'From the web' }), web);
  // Matches from scopes not shared with AI: shown here only, never sent.
  if (a.local) {
    out.append(
      h(
        'div',
        { class: 'ask-local' },
        h('p', { class: 'ask-label is-not-ai', text: 'From your saved records. Not sent to AI.' }),
        h('div', { class: 'ask-text', text: a.local.text || '' }),
        sourcesList(a.local.sources, () => closeDrawer()),
      ),
    );
  }
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
  const earlier = h('div', { id: 'ask-thread' });
  const fresh = h('button', { type: 'button', id: 'ask-new', class: 'btn btn-ghost', text: 'New conversation', hidden: true });
  fresh.addEventListener('click', () => {
    thread = [];
    renderThread();
    result.replaceChildren();
    live.textContent = 'New conversation. Earlier questions are forgotten.';
    question.focus();
  });
  form.append(
    h('div', { class: 'sheet-head' }, h('h2', { id: 'ask-title', text: 'Ask' }), h('button', { type: 'button', class: 'btn btn-ghost', text: 'Close', onclick: () => closeDrawer() })),
    h('label', { for: 'ask-question', text: 'What do you want to know?' }),
    question,
    contextRow,
    modes,
    where,
    submit,
    cancel,
    fresh,
    live,
  );
  d.append(form, earlier, result);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runAsk();
  });
  cancel.addEventListener('click', () => inFlight && inFlight.abort());
  d.addEventListener('close', () => inFlight && inFlight.abort());
  document.body.append(d);
  return d;
}

// The earlier exchanges of this conversation, collapsed, above the newest answer.
function renderThread() {
  const { h } = kit;
  const box = document.getElementById('ask-thread');
  const btn = document.getElementById('ask-new');
  if (!box || !btn) return;
  btn.hidden = !thread.length;
  const before = thread.slice(0, -1);
  if (!before.length) return void box.replaceChildren();
  const ul = h('ul', { class: 'list ask-earlier', 'aria-label': 'Earlier in this conversation' });
  for (const t of before) ul.append(h('li', { class: 'stack' }, h('p', { class: 'row-title', text: t.q }), h('p', { class: 'subtle small', text: kit.excerpt(t.a, 400) })));
  box.replaceChildren(h('details', { class: 'ask-more' }, h('summary', { class: 'btn btn-ghost', text: `Earlier in this conversation (${before.length})` }), ul));
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
  const words = SCOPE_WORDS[scope] || 'this view';
  document.getElementById('ask-where').textContent = status && status.configured
    ? `Your question goes to AI${status.web_available ? ', which may search the web' : ''}. Records from ${words} are sent only where allowed in Memory. ${canChange(status) ? 'Ask has Full access where set in Memory: it can make the changes you ask for, and lists each one.' : 'Ask never changes anything.'}`
    : `Looks only in ${words}. Ask reads your records and never changes them.`;
}

function openDrawer() {
  if (!drawer) drawer = buildDrawer();
  const p = currentProject();
  if (p) Object.assign(drawer.dataset, { projectId: p.id, projectName: p.name, projectScope: p.scope });
  else for (const k of ['projectId', 'projectName', 'projectScope']) delete drawer.dataset[k];
  if (!status) loadStatus().then(() => drawer && drawer.open && renderContext(), () => {});
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
  // A conversation belongs to one view: switching scope or project starts a new one.
  const key = `${scope}|${projectId || ''}`;
  if (key !== threadKey) {
    thread = [];
    threadKey = key;
    renderThread();
  }
  const submit = document.getElementById('ask-submit');
  const cancel = document.getElementById('ask-cancel');
  const controller = new AbortController();
  inFlight = controller;
  submit.disabled = true;
  cancel.hidden = false;
  live.textContent = status && status.configured ? 'Working on an answer…' : 'Looking through your records…';
  result.replaceChildren();
  try {
    const history = historyFor(thread);
    const r = await postAsk({ scope, question: q, mode, context: projectId ? { project_id: projectId } : undefined, tz: kit.deviceTimeZone(), ...(history.length ? { history } : {}) }, controller);
    if (r.ok && r.data && r.data.answer) {
      // Only live answers continue the conversation; a Not AI answer is not something the AI said.
      if (r.data.answer.live_ai && r.data.answer.text) {
        thread.push({ q, a: r.data.answer.text });
        document.getElementById('ask-question').value = '';
      }
      renderThread();
      result.replaceChildren(renderAnswer(r.data.answer));
      live.textContent = r.data.answer.live_ai ? 'AI answer ready.' : 'Answer ready. Not AI.';
    } else if (r.cancelled) {
      live.textContent = `Stopped. ${stoppedWords()}`;
    } else if (r.timedOut) {
      live.textContent = `No answer within 40 seconds. ${stoppedWords()} Try again, or ask a narrower question.`;
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
        ? 'Ask uses Claude, an AI service from Anthropic. It answers general questions as well as questions about your records: your question is always sent to Anthropic to write the answer.'
        : 'AI needs an Anthropic API key added to the server. Until then Ask answers straight from your saved records, labelled Not AI, and cannot answer general questions or search the web.',
    ),
    h('p', { class: 'small', text: 'Saved records are sent only from the scopes you allow below (titles, dates, who owes what and short notes). Records from a scope that is not allowed are never sent; Ask may still show matches from them, marked Not sent to AI. Harrison OS does not save your questions or answers.' }),
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
  card.append(webToggle(), actionsForm());
  return kit.section('Ask with AI', card, 'memory-ask-ai');
}

/** Pure: what Ask may do, in plain words. */
export function actionsWords(s) {
  const a = (s && s.actions) || { mode: 'read', scopes: [] };
  if (a.mode !== 'full') return 'Read only: Ask reads and answers; it never changes your records.';
  const on = a.scopes.filter((x) => s.consent && s.consent[x]);
  const off = a.scopes.filter((x) => !on.includes(x));
  const words = (list) => list.map((x) => SCOPE_WORDS[x]).join(' and ');
  return `Full access to ${words(a.scopes)} records: when you ask, Ask can add, change, review, archive and delete them, and lists each change with Undo where the app has it.${off.length ? ` Not in ${words(off)} until sending its text to AI is allowed above.` : ''}${s.configured ? '' : ' Nothing happens until AI is set up.'}`;
}

// The owner's choice of what Ask may do: Read only (default) or Full, and in which scopes. Only this owner
// screen can change it; Ask's own tools cannot reach the setting.
function actionsForm() {
  const { h } = kit;
  const a = status.actions || { mode: 'read', scopes: [] };
  const modes = [['read', 'Read only'], ['full', 'Full']];
  const modeInputs = modes.map(([value]) => h('input', { type: 'radio', name: 'ask-actions-mode', value, checked: a.mode === value }));
  const scopeInputs = ['work', 'personal'].map((x) => h('input', { type: 'checkbox', id: `ask-actions-${x}`, value: x, checked: a.mode === 'full' && a.scopes.includes(x) }));
  const now = h('p', { class: 'conn-grant-now', text: `Now: ${actionsWords(status)}` });
  const note = h('p', { class: 'small', role: 'status' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save what Ask may do' });
  async function submit(e) {
    e.preventDefault();
    const mode = (modeInputs.find((i) => i.checked) || {}).value || 'read';
    const scopes = mode === 'full' ? scopeInputs.filter((i) => i.checked).map((i) => i.value) : [];
    if (mode === 'full' && !scopes.length) return void (note.textContent = 'Choose Work, Personal or both, or choose Read only.');
    await kit.guarded(save, async () => {
      const res = await kit.api('/api/ai/actions', { method: 'PUT', body: { mode, scopes } });
      if (res.ok && res.data) {
        status = res.data;
        now.textContent = `Now: ${actionsWords(status)}`;
        note.textContent = 'Saved.';
      } else note.textContent = kit.failWords(res, 'save that');
    });
  }
  return h(
    'form',
    { class: 'conn-grant ask-actions-form', onsubmit: submit },
    h('h4', { class: 'conn-grant-title', text: 'What Ask may do' }),
    now,
    h('fieldset', { class: 'segmented conn-grant-modes' }, h('legend', { text: 'Ask may' }),
      ...modes.map(([, label], i) => h('label', { class: 'seg' }, modeInputs[i], h('span', { text: label })))),
    h('fieldset', { class: 'conn-grant-scopes' }, h('legend', { text: 'Full access in' }),
      ...scopeInputs.map((box) => h('span', { class: 'conn-check' }, box, h('label', { for: box.id, text: SCOPE_WORDS[box.value] })))),
    h('p', { class: 'subtle small', text: 'Full works only where sending that scope\'s text to AI is allowed above. Deleting is permanent; most other changes can be undone. Calendar and company project copies stay read-only, and nothing is ever sent to anyone.' }),
    note,
    h('div', { class: 'button-row' }, save),
  );
}

// Says "on" only when it really is offered: the key is set, the server allows it and so does the owner.
function webWords(s) {
  if (s.web_server_off) return 'Turned off in the server settings.';
  if (!s.web_allowed) return 'Off. Ask answers from what the AI already knows.';
  if (!s.configured) return 'Allowed, but there is no web search until AI is set up.';
  return 'On. When a question needs current facts, Anthropic searches the web or reads a page for the AI, and the answer links what it used. Each search costs a little extra on the Anthropic account, and the account\'s own settings can still turn web search off; an answer says so when that happens.';
}

function webToggle() {
  const { h } = kit;
  const box = h('input', { type: 'checkbox', id: 'ask-web', checked: !!status.web_allowed, disabled: !!status.web_server_off });
  const note = h('span', { class: 'subtle small', 'aria-live': 'polite', text: webWords(status) });
  box.addEventListener('change', async () => {
    const want = box.checked;
    box.disabled = true;
    const res = await kit.api('/api/ai/web', { method: 'PUT', body: { allowed: want } });
    if (res.ok && res.data) {
      status = res.data;
      box.checked = !!status.web_allowed;
      note.textContent = webWords(status);
    } else {
      box.checked = !want;
      note.textContent = kit.failWords(res, 'save that');
    }
    box.disabled = !!status.web_server_off;
  });
  return h('div', { class: 'ask-toggle' }, box, h('label', { for: 'ask-web', text: 'Let Ask search the web' }), note);
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
