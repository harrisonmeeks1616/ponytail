// Memory card "Connections": one plain-words line per outside connection, with its status and what it needs.
// Statuses come only from what the server reports. "Set up" never means "working" unless there is evidence.

// tone: 'good' | 'warn' | 'bad' | 'none'. Each row: { name, status, tone, detail, need }.
const UNAVAILABLE = (name) => ({ name, status: 'Not available yet', tone: 'none', detail: 'This part of Harrison OS is not on this server yet.', need: null });
const UNCHECKED = (name) => ({ name, status: 'Could not check', tone: 'none', detail: 'The server did not answer just now.', need: 'Try again when you are online.' });
const NAMES = ['Ask with AI', 'Calendar', 'Company projects', 'AI clients (MCP)', 'iPhone Shortcut', 'Electrical PM app', 'Field Hub'];
// The official apps: Harrison OS links to them and never copies or changes their records.
const APPS = [['pm', 'Electrical PM app', 'PM_APP_URL'], ['field_hub', 'Field Hub', 'FIELD_APP_URL']];

function sourcesRow(name, results, key, { none, problem }) {
  if (!results.some((r) => r && r.ok)) return UNAVAILABLE(name);
  // A 'not_connected' entry is a placeholder for a source that was never added, not a source.
  const list = rowsOf(results, key).filter((c) => c && c.state !== 'not_connected');
  if (!list.length) return { name, status: 'Not set up', tone: 'none', detail: null, need: none };
  const real = list.filter((c) => !c.sample);
  if (list.some((c) => c.state === 'error')) return { name, status: 'Problem', tone: 'bad', detail: problem, need: 'Open its card below to refresh it or check the link.' };
  if (!real.length) return { name, status: 'Sample only', tone: 'warn', detail: 'Showing labelled sample data, not a real source.', need: none };
  const ok = real.filter((c) => c.state === 'ok').length;
  if (!ok) return { name, status: 'Added, not loaded yet', tone: 'warn', detail: null, need: 'Refresh it once to load it.' };
  return { name, status: 'Copy loaded', tone: 'good', detail: `${ok} of ${real.length} loaded. Change these in their own app; Harrison OS shows a copy.`, need: null };
}

function rowsOf(results, key) {
  const out = [];
  for (const r of results) {
    if (r && r.ok && r.data && Array.isArray(r.data[key])) out.push(...r.data[key]);
  }
  return out;
}

/** Pure: API answers -> rows. ai, mcp: one api() result; calendar, pm: an array of api() results (one per scope). */
// Every row, on every path (including "Could not check" when offline), carries its group: the card renders by group.
export function summarize(input, opts) {
  const rows = summarizeRows(input, opts);
  for (const r of rows) r.group = SOURCE_ROWS.has(r.name) ? 'source' : 'setup';
  return rows;
}

function summarizeRows({ ai, calendar = [], pm = [], mcp, apps = null, crossapp = null }, { formatAt = (v) => v } = {}) {
  // The MCP status route says which other routes exist; if it did not answer (offline, server error), nothing is known.
  if (!mcp || (!mcp.ok && mcp.status !== 404)) return NAMES.map(UNCHECKED);
  const rows = [];

  if (!ai || !ai.ok || !ai.data) rows.push(UNAVAILABLE('Ask with AI'));
  else if (!ai.data.configured) {
    rows.push({ name: 'Ask with AI', status: 'Not set up', tone: 'none', detail: 'Ask still answers from your saved records without AI.', need: 'An AI provider key added to the server settings.' });
  } else {
    const allowed = ['work', 'personal'].filter((s) => ai.data.consent && ai.data.consent[s]);
    rows.push(
      allowed.length
        ? { name: 'Ask with AI', status: 'Set up', tone: 'good', detail: `May read ${allowed.map(word).join(' and ')} records.`, need: null }
        : { name: 'Ask with AI', status: 'Set up, not allowed yet', tone: 'warn', detail: 'No records are sent to the AI provider yet.', need: 'Allow it per scope in Ask with AI.' },
    );
  }

  rows.push(sourcesRow('Calendar', calendar, 'connections', {
    none: "Add a calendar's private ICS link or import a calendar file.",
    problem: 'A calendar could not be updated.',
  }));
  rows.push(sourcesRow('Company projects', pm, 'sources', {
    none: 'Import a project export file from Electrical PM. A live copy needs the private PM digest connection, which is waiting for approval.',
    problem: 'A project source could not be updated.',
  }));

  if (!mcp || !mcp.ok || !mcp.data) rows.push(UNAVAILABLE('AI clients (MCP)'));
  else if (!mcp.data.configured) {
    rows.push({ name: 'AI clients (MCP)', status: 'Not set up', tone: 'none', detail: null, need: 'A separate Cloudflare Access service token for AI clients. Steps are in docs/MCP.md.' });
  } else {
    const g = grantOf(mcp.data);
    const detail = `${grantWords(g)} ` + (mcp.data.last_call_at ? `Last used ${formatAt(mcp.data.last_call_at)}.` : 'No AI client has connected yet.');
    rows.push({
      name: 'AI clients (MCP)',
      status: g.mode === 'off' ? 'Set up, turned off' : mcp.data.last_call_at ? 'Set up, used' : 'Set up, not used yet',
      tone: g.mode === 'off' ? 'none' : mcp.data.last_call_at ? 'good' : 'warn',
      detail,
      need: null,
    });
  }

  const shortcutDetail = 'Sends a capture to your inbox when the phone is online. It does not keep captures while offline.';
  const shortcutSet = mcp.ok && mcp.data ? mcp.data.shortcut_configured : undefined;
  // Which scopes the server lets the Shortcut credential write (SHORTCUT_SCOPES), not what the Shortcut sends.
  const scWords = mcp.ok && mcp.data && Array.isArray(mcp.data.shortcut_scopes) ? mcp.data.shortcut_scopes.map(word) : null;
  const scopeLine = scWords ? (scWords.length ? ` The server lets it save to ${scWords.join(' and ')} only.` : ' The server lets it save nowhere (check SHORTCUT_SCOPES).') : '';
  const shortcutNeed = 'A Cloudflare Access service token for the Shortcut. Steps are in docs/MCP.md, "iPhone Shortcut".';
  rows.push(
    shortcutSet === true
      ? { name: 'iPhone Shortcut', status: 'Set up', tone: 'warn', detail: `${shortcutDetail}${scopeLine} This shows the server is ready, not that the phone has sent anything.`, need: null }
      : shortcutSet === false
        ? { name: 'iPhone Shortcut', status: 'Not set up', tone: 'none', detail: shortcutDetail, need: shortcutNeed }
        : { name: 'iPhone Shortcut', status: 'Not checked here', tone: 'none', detail: shortcutDetail, need: shortcutNeed },
  );
  const changes = crossWords(crossapp);
  for (const [key, name, setting] of APPS) {
    const url = apps && apps[key];
    rows.push(
      url
        ? { name, status: 'Linked', tone: 'none', detail: `Opens ${hostOf(url)}. It stays the official record. ${changes}`, need: null, url }
        : { name, status: 'Not linked', tone: 'none', detail: `Add its web address to open it from Harrison OS. ${changes}`, need: `${setting} in the server settings (docs/DEPLOY.md).` },
    );
  }
  return rows;
}

// Calendar, company projects and the two official apps hold their own records: Harrison OS shows a copy or a
// link, and changes are made there. Everything else in the list is an optional service that needs setup.
const SOURCE_ROWS = new Set(['Calendar', 'Company projects', 'Electrical PM app', 'Field Hub']);

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'the app';
  }
}

const CROSS_WRITES = ['record.create', 'record.update', 'record.archive', 'record.restore', 'field.edit', 'field.retry'];

/** Pure: whether AI may change the official apps, from the cross-app status (null: this server has none). */
export function crossWords(c) {
  const data = c && c.ok && c.data;
  if (!data) return 'Harrison OS does not change it.';
  const g = data.grant || { clients: [], actions: [], projects: [] };
  const writes = g.actions.filter((a) => CROSS_WRITES.includes(a));
  if (!g.clients.length || !g.actions.length || !g.projects.length) return 'AI clients may not read or change it (AI actions below are off).';
  const who = g.clients.map((x) => (x === 'ask' ? 'Ask' : 'MCP clients')).join(' and ');
  const what = writes.length ? 'read and change' : 'read';
  return `${who} may ${what} it through the private PM connection, in ${g.projects.length === 1 ? 'one project' : `${g.projects.length} projects`}${data.configured ? '' : ', once that connection is set up (it is not yet)'}.`;
}

// The owner's control for AI actions on Electrical PM and Field Hub: which clients, which projects, which actions.
// Saved through the owner-only route; an AI client can never reach it. Nothing is allowed until saved here.
const CROSS_GROUPS = [
  ['Read Electrical PM', ['project.read', 'project.schema', 'records.list', 'record.read']],
  ['Change Electrical PM records', ['record.create', 'record.update', 'record.archive', 'record.restore']],
  ['Read Field Hub', ['field.status', 'field.read', 'field.pending']],
  ['Change Field Hub records', ['field.edit', 'field.retry']],
];
function crossForm(kit, data, onSaved) {
  const { h } = kit;
  const g = data.grant;
  const clientBoxes = [['ask', 'Ask'], ['mcp', 'MCP clients']].map(([v, label]) => [h('input', { type: 'checkbox', id: `cross-client-${v}`, value: v, checked: g.clients.includes(v) }), label]);
  const groupBoxes = CROSS_GROUPS.map(([label, acts], i) => [h('input', { type: 'checkbox', id: `cross-group-${i}`, checked: acts.every((a) => g.actions.includes(a)) }), label, acts]);
  const projects = h('textarea', { id: 'cross-projects', rows: 2, maxlength: 2600, spellcheck: 'false', autocomplete: 'off' });
  projects.value = g.projects.join('\n');
  const note = h('p', { class: 'small', role: 'status' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save AI actions' });
  async function submit(e) {
    e.preventDefault();
    const body = {
      clients: clientBoxes.filter(([b]) => b.checked).map(([b]) => b.value),
      projects: [...new Set(projects.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))],
      actions: groupBoxes.filter(([b]) => b.checked).flatMap(([, , acts]) => acts),
    };
    await kit.guarded(save, async () => {
      const res = await kit.api('/api/connections/crossapp/grant', { method: 'PUT', body });
      if (res.ok && res.data) onSaved(res.data);
      else note.textContent = kit.failWords(res, 'save AI actions');
    });
  }
  return h(
    'form',
    { class: 'conn-grant cross-grant', onsubmit: submit },
    h('h4', { class: 'conn-grant-title', text: 'AI actions in Electrical PM and Field Hub' }),
    h('p', { class: 'conn-grant-now', text: `Now: ${crossWords({ ok: true, data })}` }),
    h('fieldset', { class: 'conn-grant-scopes' }, h('legend', { text: 'Which AI' }),
      ...clientBoxes.map(([b, label]) => h('span', { class: 'conn-check' }, b, h('label', { for: b.id, text: label })))),
    h('fieldset', { class: 'conn-grant-scopes' }, h('legend', { text: 'May' }),
      ...groupBoxes.map(([b, label]) => h('span', { class: 'conn-check' }, b, h('label', { for: b.id, text: label })))),
    h('label', { for: 'cross-projects', text: 'Electrical PM project ids (one per line)' }),
    projects,
    h('p', { class: 'subtle small', text: 'Every change goes through Electrical PM itself, which checks it, keeps its history and can refuse it; Field Hub changes go through Electrical PM too. Ask also needs Full access for Work above, and an MCP client needs Full for Work, to change anything. The AI cannot change this setting.' }),
    note,
    h('div', { class: 'button-row' }, save),
  );
}

function word(scope) {
  return scope === 'work' ? 'Work' : scope === 'personal' ? 'Personal' : 'no';
}

// The access in force, from the status route. An older server has no grant: read only, as it reports.
function grantOf(data) {
  return data.grant || { mode: 'read', scopes: data.scopes || [], allow_capture: !!data.allow_capture, set_by: 'default' };
}

/** Pure: the grant in plain words. */
export function grantWords(g) {
  const can = (g.scopes || []).map(word).join(' and ');
  if (g.mode === 'off') return 'Turned off: AI clients cannot read or change anything.';
  if (g.mode === 'full') return `Full access to ${can} records: can add, change, review, archive and delete them. Cannot change this setting.`;
  return `${can ? `Can read ${can} records` : 'Can read nothing'}. ${g.allow_capture ? 'Can add captures to your inbox for review.' : 'Cannot change anything.'}`;
}

// The owner's control for AI client access: Off, Read only or Full, and which scopes. Saved through the owner-only
// route; an AI client can never reach it. onSaved gets the stored grant.
function grantForm(kit, grant, onSaved) {
  const { h } = kit;
  const modes = [['off', 'Off'], ['read', 'Read only'], ['full', 'Full']];
  const modeInputs = modes.map(([value]) => h('input', { type: 'radio', name: 'mcp-grant-mode', value, checked: grant.mode === value }));
  const scopeInputs = ['work', 'personal'].map((s) => h('input', { type: 'checkbox', id: `mcp-grant-${s}`, value: s, checked: grant.mode !== 'off' && grant.scopes.includes(s) }));
  const note = h('p', { class: 'small', role: 'status' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save access' });
  async function submit(e) {
    e.preventDefault();
    const mode = (modeInputs.find((i) => i.checked) || {}).value;
    const scopes = scopeInputs.filter((i) => i.checked).map((i) => i.value);
    if (!mode) return void (note.textContent = 'Choose Off, Read only or Full.');
    if (mode !== 'off' && !scopes.length) return void (note.textContent = 'Choose Work, Personal or both, or choose Off.');
    await kit.guarded(save, async () => {
      const res = await kit.api('/api/connections/mcp/grant', { method: 'PUT', body: { mode, scopes } });
      if (res.ok && res.data) onSaved(res.data);
      else note.textContent = kit.failWords(res, 'save AI client access');
    });
  }
  return h(
    'form',
    { class: 'conn-grant', onsubmit: submit },
    h('h4', { class: 'conn-grant-title', text: 'AI client access' }),
    h('p', { class: 'conn-grant-now', text: `Now: ${grantWords(grant)}${grant.set_by === 'default' ? ' This is the server default until you save a choice here.' : ''}` }),
    h('fieldset', { class: 'segmented conn-grant-modes' }, h('legend', { text: 'What a connected AI client may do' }),
      ...modes.map(([, label], i) => h('label', { class: 'seg' }, modeInputs[i], h('span', { text: label })))),
    h('fieldset', { class: 'conn-grant-scopes' }, h('legend', { text: 'In which records' }),
      ...scopeInputs.map((box) => h('span', { class: 'conn-check' }, box, h('label', { for: box.id, text: word(box.value) })))),
    h('p', { class: 'small', text: 'Read only lets a connected AI client look up records in the chosen scopes. Full lets a connected AI client add, change, review, archive and delete records in the chosen scopes. It cannot change this setting.' }),
    h('p', { class: 'subtle small', text: 'Calendar events and company projects stay read-only copies: they change in their own apps. A change here applies from the next request; Off stops every request.' }),
    note,
    h('div', { class: 'button-row' }, save),
  );
}

const TONE_CLASS = { good: 'chip-good', warn: 'chip-sample', bad: 'chip-bad', none: 'chip-status' };

export function register(kit) {
  const { h, api, chip, section, formatAt, state } = kit;
  kit.addMemoryBlock(async () => {
    // Only the scopes on screen are asked about, so a Work view never counts Personal connections.
    const scopes = state.scope === 'all' ? ['work', 'personal'] : [state.scope];
    // Ask only for routes the server says it has: a missing route would be a 404 (a console error) on every visit.
    const mcp = await api('/api/connections/mcp');
    const has = (mcp.ok && mcp.data && mcp.data.features) || {};
    const each = (on, path) => (on ? Promise.all(scopes.map((s) => api(`${path}?scope=${s}`))) : []);
    const [ai, calendar, pm, crossapp] = await Promise.all([
      has.ai ? api('/api/ai/status') : null,
      each(has.calendar, '/api/calendar/connections'),
      each(has.pm, '/api/pm/sources'),
      has.crossapp ? api('/api/connections/crossapp') : null,
    ]);
    const input = { ai, mcp, calendar, pm, crossapp, apps: await appLinks() };
    let content = build();
    return section('Connections', content, 'connections');

    // After the owner saves AI client access, the card is redrawn in place with the stored grant (no reload).
    function saved(grant) {
      input.mcp = { ...mcp, data: { ...mcp.data, grant, scopes: grant.scopes, allow_capture: grant.allow_capture } };
      const fresh = build();
      content.replaceWith(fresh);
      content = fresh;
      kit.showToast(`Saved. AI clients: ${grantWords(grant)}`);
      const btn = fresh.querySelector('.conn-grant button[type="submit"]');
      if (btn) btn.focus();
    }

    function crossSaved(data) {
      input.crossapp = { ok: true, status: 200, data };
      const fresh = build();
      content.replaceWith(fresh);
      content = fresh;
      kit.showToast(`Saved. ${crossWords(input.crossapp)}`);
      const btn = fresh.querySelector('.cross-grant button[type="submit"]');
      if (btn) btn.focus();
    }

    function build() {
      const rows = summarize(input, { formatAt });
      const listOf = (group) => h(
        'ul',
        { class: 'list conn-list' },
        ...rows.filter((r) => r.group === group).map((r) =>
          h(
            'li',
            { class: 'plain-row conn-row' },
            h('span', { class: 'conn-head' }, h('span', { class: 'row-title', text: r.name }), chip(TONE_CLASS[r.tone], r.status, 'Status: ')),
            r.detail ? h('span', { class: 'row-meta', text: r.detail }) : null,
            r.need ? h('span', { class: 'row-meta conn-need', text: `Needs: ${r.need}` }) : null,
            r.url ? appLink(r.url, `Open ${r.name}`) : null,
          ),
        ),
      );
      const sub = (title, ...body) => h('div', { class: 'conn-group' }, h('h3', { class: 'conn-group-title', text: title }), ...body);
      // Only a server with the grant route reports a grant; an older one gets no control it cannot honour.
      const grant = input.mcp.ok && input.mcp.data && input.mcp.data.grant;
      return h(
        'div',
        null,
        sub('Kept in Harrison OS', h('p', { class: 'subtle', text: 'Tasks, waiting-on, notes, ideas, decisions, projects and reminders live here: open one and edit it.' })),
        sub('Copies and links: edit them in their own app', listOf('source')),
        sub('Optional, needs setup', listOf('setup'), grant ? grantForm(kit, grant, saved) : null,
          input.crossapp && input.crossapp.ok && input.crossapp.data ? crossForm(kit, input.crossapp.data, crossSaved) : null),
      );
    }
  });

  // The session (which carries the links) loads alongside the first screen, so it may not be here yet.
  async function appLinks() {
    if (state.session) return state.session.apps || {};
    const r = await api('/api/session');
    return (r.ok && r.data && r.data.apps) || {};
  }

  const appLink = (url, text) =>
    h('a', { class: 'btn btn-secondary app-link', href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${text} (opens in a new tab)` }, text, h('span', { 'aria-hidden': 'true', text: ' \u2197' }));

  // Today: one tap to the official apps, only when they are linked.
  kit.addTodayBlock(async () => {
    const apps = await appLinks();
    const links = APPS.filter(([key]) => apps[key]).map(([key, name]) => appLink(apps[key], name));
    if (!links.length) return null;
    return section('Your apps', h('div', { class: 'button-row app-links' }, ...links), 'apps');
  });
}
