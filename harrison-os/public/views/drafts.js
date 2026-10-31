// Drafts view (#/drafts): list, new draft form, editable draft with the claim check beside the original facts.
// Nothing here sends anything: the user copies the draft. Uses only the kit from app.js.

const DRAFT_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const KINDS = [
  ['email', 'Email'],
  ['update', 'Project update'],
  ['handoff', 'Handoff'],
  ['materials', 'Materials list'],
  ['call_brief', 'Call brief'],
];
const KIND_WORDS = Object.fromEntries(KINDS);
const AI_REASON = {
  not_configured: 'AI is not set up',
  no_consent: 'AI is not turned on for this scope',
  timeout: 'the AI took too long',
  cancelled: 'it was cancelled',
  provider_error: 'the AI service had a problem',
  invalid_output: 'the AI answer could not be used',
};
const TRIPWIRE =
  'This check is a tripwire, not proof. It looks for changed amounts, dates and who does what, a firmer status ' +
  '(for example requested becoming confirmed), dropped conditions or "probably", added promises, and missing or extra facts. ' +
  'Read the draft yourself before you send it.';

let kit;
let seq = 0;
let fromProject = null; // { id, scope, name } when opened from a project
let lastCreate = null; // { id, ai } to explain an AI fallback once
const knownScope = new Map();

export function register(k) {
  kit = k;
  k.addRoute('drafts', { title: 'Drafts', load });
  k.addProjectBlock(projectBlock);
  k.addMemoryBlock(memoryBlock);
}

function scopeWord(s) {
  return s === 'personal' ? 'Personal' : 'Work';
}

function load(route, body) {
  const my = ++seq;
  if (route.id === 'new') return renderForm(body, my);
  if (route.id && DRAFT_ID_RE.test(route.id)) return loadDetail(route.id, body, my);
  return loadList(body, my);
}

// ---------------------------------------------------------------- blocks

function projectBlock(pd) {
  if (!pd || !pd.id || !pd.project) return null;
  const { h, section, go } = kit;
  const open = (kind) => () => {
    fromProject = { id: pd.id, scope: pd.scope, name: pd.project.name || 'this project', kind };
    go('drafts', 'new');
  };
  return section(
    'Drafts',
    h(
      'div',
      { class: 'button-row' },
      h('button', { type: 'button', class: 'btn btn-secondary', text: 'Draft an update', onclick: open('update') }),
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Draft a handoff', onclick: open('handoff') }),
    ),
    'project-drafts',
  );
}

function memoryBlock() {
  const { h, section } = kit;
  return section(
    'Drafts',
    h(
      'a',
      { class: 'link-card', href: '#/drafts' },
      h('span', { class: 'eyebrow', text: 'Emails, updates, handoffs' }),
      h('span', { class: 'link-card-title', text: 'Drafts' }),
    ),
    'memory-drafts',
  );
}

// ---------------------------------------------------------------- list

async function loadList(body, my) {
  const { h, api, state, qs, noticeBlock, failWords } = kit;
  body.setAttribute('aria-busy', 'true');
  body.replaceChildren(h('p', { class: 'subtle', text: 'Loading.' }));
  const r = await api(`/api/drafts?${qs({ scope: state.scope })}`);
  if (my !== seq) return;
  body.setAttribute('aria-busy', 'false');
  const newBtn = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: 'New draft',
    onclick: () => {
      fromProject = null;
      kit.go('drafts', 'new');
    },
  });
  const intro = h('p', { class: 'subtle', text: 'Turn rough notes into an email, update, handoff, materials list or call brief. Nothing is sent: you copy it.' });
  if (!r.ok) {
    body.replaceChildren(intro, h('div', { class: 'button-row' }, newBtn), noticeBlock(failWords(r, 'load drafts'), () => loadList(body, ++seq)));
    return;
  }
  const drafts = (r.data && Array.isArray(r.data.drafts) ? r.data.drafts : []).filter((d) => d && DRAFT_ID_RE.test(String(d.id || '')));
  for (const d of drafts) knownScope.set(d.id, d.scope);
  const active = drafts.filter((d) => d.state !== 'archived');
  const archived = drafts.filter((d) => d.state === 'archived');
  const out = [intro, h('div', { class: 'button-row' }, newBtn)];
  if (!active.length) out.push(h('p', { class: 'empty', text: 'No drafts yet.' }));
  else out.push(h('ul', { class: 'list drafts-list' }, active.map(draftRow)));
  if (archived.length) {
    out.push(h('details', { class: 'drafts-archived' }, h('summary', { text: `Archived (${archived.length})` }), h('ul', { class: 'list drafts-list' }, archived.map(draftRow))));
  }
  body.replaceChildren(...out);
}

function draftRow(d) {
  const { h, enc, chip, scopeChip, sampleChip, formatAt, plural } = kit;
  const n = Array.isArray(d.flags) ? d.flags.length : 0;
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'row-link', href: `#/drafts/${enc(d.id)}` },
      h('span', { class: 'row-title', text: d.title || KIND_WORDS[d.kind] || 'Draft' }),
      h(
        'span',
        { class: 'chips' },
        chip('chip-kind', KIND_WORDS[d.kind] || 'Draft'),
        scopeChip(d.scope),
        sampleChip(d),
        chip('chip-kind', d.generated_by === 'ai' ? 'AI draft' : 'Template draft'),
        d.state === 'reviewed' ? chip('chip-good', 'Reviewed') : null,
        n ? chip('chip-due', plural(n, 'thing to check', 'things to check')) : null,
      ),
      h('span', { class: 'row-meta', text: d.updated_at ? `Changed ${formatAt(d.updated_at)}` : '' }),
    ),
  );
}

// ---------------------------------------------------------------- new draft

async function renderForm(body, my) {
  const { h, api, state, writeScope, scopeChip } = kit;
  const project = fromProject;
  const scope = project && kit.isScope(project.scope) ? project.scope : state.scope === 'all' ? writeScope() : state.scope;
  const form = h('form', { class: 'form drafts-form', novalidate: true });
  const kindSel = h(
    'select',
    { id: 'draft-kind', name: 'kind' },
    KINDS.map(([v, label]) => h('option', { value: v, text: label, selected: (project ? project.kind : 'email') === v })),
  );
  const recipient = h('input', { type: 'text', id: 'draft-recipient', maxlength: 120, autocomplete: 'off', 'aria-describedby': 'draft-recipient-hint' });
  const facts = h('textarea', { id: 'draft-facts', rows: 7, maxlength: 4000, 'aria-describedby': 'draft-facts-hint' });
  const projectLine = project
    ? h(
        'p',
        { class: 'drafts-from' },
        `From project: ${project.name}. Its saved place, open tasks, Waiting and decisions are included word for word. `,
        h('button', {
          type: 'button',
          class: 'btn btn-ghost',
          text: 'Leave the project out',
          onclick: () => {
            fromProject = null;
            renderForm(body, ++seq);
          },
        }),
      )
    : null;
  const aiSlot = h('div', { class: 'drafts-ai', 'aria-live': 'polite' }, h('p', { class: 'subtle small', text: 'Checking whether AI rewrite is available.' }));
  const status = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Make draft' });
  form.append(
    h('p', { class: 'subtle', text: 'Write the facts in your own words. You get a draft that keeps them, checked against what you wrote. Nothing is sent: you copy it.' }),
    h('p', { class: 'chips' }, h('span', { text: 'Saved in ' }), scopeChip(scope)),
    projectLine,
    h('label', { for: 'draft-kind', text: 'What are you writing?' }),
    kindSel,
    h('label', { for: 'draft-recipient', text: 'To (optional)' }),
    h('span', { id: 'draft-recipient-hint', class: 'subtle small', text: 'A name or role, like "Dana" or "the GC".' }),
    recipient,
    h('label', { for: 'draft-facts', text: 'Your facts' }),
    h('span', { id: 'draft-facts-hint', class: 'subtle small', text: 'One per line is fine. Keep who, how many, when, and anything that is only requested or depends on something.' }),
    facts,
    aiSlot,
    status,
    h('div', { class: 'button-row' }, submit, h('a', { class: 'btn btn-ghost', href: '#/drafts', text: 'Cancel' })),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    kit.guarded(submit, () => create(form, { scope, project, kindSel, recipient, facts, status }));
  });
  body.replaceChildren(form);
  if (my === seq) facts.focus({ preventScroll: true });

  // AI rewrite is offered only when it is set up and allowed for this scope (src/ai.js, when present).
  const r = await api('/api/ai/status');
  if (my !== seq) return;
  const consent = r.ok && r.data && r.data.consent ? r.data.consent[scope] === true : false;
  if (r.ok && r.data && r.data.configured === true && consent) {
    aiSlot.replaceChildren(
      h(
        'label',
        { class: 'check-row', for: 'draft-use-ai' },
        h('input', { type: 'checkbox', id: 'draft-use-ai', name: 'use_ai' }),
        h('span', { text: `Rewrite with AI. Your facts for this draft are sent to the AI provider. The result is checked the same way.` }),
      ),
    );
  } else {
    const why = r.ok && r.data && r.data.configured === true ? `AI is not turned on for ${scopeWord(scope)}` : 'AI rewrite is not set up';
    aiSlot.replaceChildren(h('p', { class: 'subtle small', text: `${why}. You get a template draft that keeps your words.` }));
  }
}

async function create(form, { scope, project, kindSel, recipient, facts, status }) {
  const { api, go, failWords } = kit;
  status.hidden = true;
  const useAi = form.querySelector('#draft-use-ai');
  const payload = {
    scope,
    kind: kindSel.value,
    facts: facts.value,
    recipient_label: recipient.value,
    source_refs: project ? [`project:${project.id}`] : [],
    use_ai: !!(useAi && useAi.checked),
  };
  const r = await api('/api/drafts', { method: 'POST', body: payload });
  if (!r.ok) {
    const code = r.data && r.data.error && r.data.error.code;
    status.textContent =
      code === 'nothing_to_draft'
        ? 'Add some facts first.'
        : code === 'source_not_found'
          ? 'That project is not available here any more. Leave it out and try again.'
          : code === 'sources_too_long'
            ? 'That is too much material for one draft. Shorten the facts or leave the project out.'
            : failWords(r, 'make the draft');
    status.hidden = false;
    return;
  }
  const d = r.data && r.data.draft;
  if (!d || !DRAFT_ID_RE.test(String(d.id || ''))) return;
  knownScope.set(d.id, d.scope);
  lastCreate = { id: d.id, ai: r.data.ai || null };
  fromProject = null;
  go('drafts', d.id);
}

// ---------------------------------------------------------------- one draft

async function loadDetail(id, body, my) {
  const { h, api, qs, enc, noticeBlock, failWords } = kit;
  body.setAttribute('aria-busy', 'true');
  body.replaceChildren(h('p', { class: 'subtle', text: 'Loading.' }));
  const order = knownScope.has(id) ? [knownScope.get(id)] : ['work', 'personal'];
  let r = null;
  for (const s of order) {
    r = await api(`/api/drafts/${enc(id)}?${qs({ scope: s })}`);
    if (my !== seq) return;
    if (r.ok || r.status !== 404) break;
  }
  body.setAttribute('aria-busy', 'false');
  if (!r.ok || !r.data || !r.data.draft) {
    body.replaceChildren(
      noticeBlock(r.status === 404 ? 'This draft was not found. It may have been deleted.' : failWords(r, 'load the draft'), r.status === 404 ? null : () => loadDetail(id, body, ++seq)),
      h('p', null, h('a', { class: 'inline-link', href: '#/drafts', text: 'All drafts' })),
    );
    return;
  }
  knownScope.set(id, r.data.draft.scope);
  renderDetail(r.data.draft, body);
}

function renderDetail(d, body) {
  const { h, chip, scopeChip, sampleChip, formatAt } = kit;
  const head = h(
    'div',
    { class: 'drafts-head' },
    h('h2', { class: 'card-title', text: d.title || KIND_WORDS[d.kind] || 'Draft' }),
    h(
      'p',
      { class: 'chips' },
      chip('chip-kind', KIND_WORDS[d.kind] || 'Draft'),
      scopeChip(d.scope),
      sampleChip(d),
      chip(d.generated_by === 'ai' ? 'chip-kind drafts-ai-chip' : 'chip-kind', d.generated_by === 'ai' ? 'AI draft' : 'Template draft'),
      d.state === 'reviewed' ? chip('chip-good', 'Reviewed') : null,
      d.state === 'archived' ? chip('chip-kind', 'Archived') : null,
    ),
    h('p', { class: 'row-meta', text: `Changed ${formatAt(d.updated_at)}` }),
  );
  const notices = [];
  if (lastCreate && lastCreate.id === d.id) {
    const ai = lastCreate.ai;
    if (ai && ai.requested && !ai.used) {
      notices.push(h('div', { class: 'notice notice-warn' }, h('p', { text: `AI rewrite was not used: ${AI_REASON[ai.reason] || 'it was not available'}. This is a template draft that keeps your words.` })));
    }
    lastCreate = null;
  }
  if (d.generated_by === 'template') {
    notices.push(h('p', { class: 'subtle small', text: 'Template draft: your words arranged under plain headings. Not written by AI.' }));
  } else {
    notices.push(h('p', { class: 'subtle small', text: 'AI draft: rewritten by the AI from your facts. Check every flag below.' }));
  }

  const editor = h('textarea', { id: 'draft-body', rows: 14, maxlength: 20000, value: d.body, spellcheck: 'true' });
  const dirty = h('p', { class: 'note-warn', hidden: true, role: 'status', text: 'Unsaved changes. The check below is for the saved version. Save to check again.' });
  editor.addEventListener('input', () => {
    dirty.hidden = editor.value === d.body;
  });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Save and check' });
  saveBtn.addEventListener('click', () => kit.guarded(saveBtn, () => patch(d, { body: editor.value }, body, 'Saved and checked.')));
  const copyBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Copy' });
  copyBtn.addEventListener('click', () => copy(editor));
  const reviewBtn =
    d.state === 'draft'
      ? h('button', { type: 'button', class: 'btn btn-secondary', text: 'Mark reviewed' })
      : null;
  if (reviewBtn) {
    reviewBtn.addEventListener('click', () => {
      if (editor.value !== d.body) {
        kit.showNotice('Save your changes first, then mark it reviewed.');
        return;
      }
      kit.guarded(reviewBtn, () => patch(d, { state: 'reviewed' }, body, 'Marked reviewed.'));
    });
  }
  const archiveBtn = h('button', { type: 'button', class: 'btn btn-ghost', text: d.state === 'archived' ? 'Bring back' : 'Archive' });
  archiveBtn.addEventListener('click', () =>
    kit.guarded(archiveBtn, () => patch(d, { state: d.state === 'archived' ? 'draft' : 'archived' }, body, d.state === 'archived' ? 'Back in your drafts.' : 'Archived.')),
  );
  const deleteBtn = h('button', { type: 'button', class: 'btn btn-danger', text: 'Delete' });
  deleteBtn.addEventListener('click', () => kit.guarded(deleteBtn, () => remove(d)));

  const editorCard = h(
    'section',
    { class: 'card drafts-editor', 'aria-labelledby': 'draft-body-label' },
    h('label', { id: 'draft-body-label', for: 'draft-body', class: 'drafts-label', text: 'Draft' }),
    editor,
    dirty,
    h('div', { class: 'button-row' }, saveBtn, copyBtn, reviewBtn, archiveBtn, deleteBtn),
  );

  body.replaceChildren(
    head,
    ...notices,
    h('div', { class: 'drafts-grid' }, editorCard, h('div', { class: 'drafts-side' }, flagsCard(d), factsCard(d))),
    h('p', null, h('a', { class: 'inline-link', href: '#/drafts', text: 'All drafts' })),
  );
}

function flagsCard(d) {
  const { h, plural } = kit;
  const flags = Array.isArray(d.flags) ? d.flags : [];
  const card = h('section', { class: 'card drafts-check', 'aria-labelledby': 'drafts-check-h' }, h('h2', { id: 'drafts-check-h', class: 'card-title', text: 'Check before you send' }));
  if (!flags.length) {
    card.append(h('p', { class: 'drafts-clear', text: 'Nothing flagged.' }));
  } else {
    card.append(h('p', { text: `${plural(flags.length, 'thing', 'things')} to check:` }));
    const ul = h('ul', { class: 'plain-list drafts-flags' });
    for (const f of flags) {
      ul.append(
        h(
          'li',
          { class: 'drafts-flag' },
          h('p', { class: 'drafts-flag-msg', text: typeof f.message === 'string' ? f.message : 'Check this part.' }),
          f.source_quote ? h('p', { class: 'drafts-quote' }, h('span', { class: 'drafts-quote-label', text: 'Your notes: ' }), `"${f.source_quote}"`) : null,
          f.draft_quote ? h('p', { class: 'drafts-quote' }, h('span', { class: 'drafts-quote-label', text: 'Draft: ' }), `"${f.draft_quote}"`) : null,
        ),
      );
    }
    card.append(ul);
  }
  card.append(h('p', { class: 'subtle small', text: TRIPWIRE }));
  return card;
}

function factsCard(d) {
  const { h, enc, sourceWords } = kit;
  const card = h('section', { class: 'card drafts-facts', 'aria-labelledby': 'drafts-facts-h' }, h('h2', { id: 'drafts-facts-h', class: 'card-title', text: 'What this draft is based on' }));
  card.append(h('div', { class: 'original-text', text: d.source_text || d.facts || 'No facts saved.' }));
  const refs = Array.isArray(d.source_refs) ? d.source_refs : [];
  const projects = refs.filter((r) => /^project:[A-Za-z0-9_-]{1,120}$/.test(r));
  const others = refs.length - projects.length;
  if (projects.length || others) {
    const ul = h('ul', { class: 'plain-list' });
    for (const p of projects) ul.append(h('li', null, h('a', { class: 'inline-link', href: `#/project/${enc(p.slice(8))}`, text: 'Open the project' })));
    if (others) ul.append(h('li', { class: 'subtle', text: `${sourceWords(refs.find((r) => !r.startsWith('project:'))) || 'From your records'}${others > 1 ? ` and ${others - 1} more` : ''}` }));
    card.append(ul);
  }
  return card;
}

async function patch(d, change, body, done) {
  const { api, enc, failWords, setStatus, showNotice } = kit;
  const r = await api(`/api/drafts/${enc(d.id)}`, { method: 'PATCH', body: { scope: d.scope, ...change } });
  if (!r.ok || !r.data || !r.data.draft) {
    showNotice(failWords(r, 'save the draft'));
    return;
  }
  const next = r.data.draft;
  renderDetail(next, body);
  const n = Array.isArray(next.flags) ? next.flags.length : 0;
  setStatus(`${done} ${n ? `${kit.plural(n, 'thing', 'things')} to check.` : 'Nothing flagged.'}`);
}

async function remove(d) {
  const { api, enc, qs, failWords, showNotice, showToast, go } = kit;
  const ok = window.confirm('Delete this draft? Its text and check results are removed from Harrison OS. Anything you already copied or sent is not affected.');
  if (!ok) return;
  const r = await api(`/api/drafts/${enc(d.id)}?${qs({ scope: d.scope })}`, { method: 'DELETE' });
  if (!r.ok) {
    showNotice(failWords(r, 'delete the draft'));
    return;
  }
  knownScope.delete(d.id);
  showToast('Draft deleted.');
  go('drafts');
}

async function copy(editor) {
  const text = editor.value;
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    copied = false;
  }
  if (!copied) {
    editor.focus();
    editor.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
  }
  kit.showToast(copied ? 'Copied. Paste it where you send it.' : 'Could not copy. The text is selected: copy it from the menu.');
}
