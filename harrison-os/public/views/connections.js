// Memory card "Connections": one plain-words line per outside connection, with its status and what it needs.
// Statuses come only from what the server reports. "Set up" never means "working" unless there is evidence.

// tone: 'good' | 'warn' | 'bad' | 'none'. Each row: { name, status, tone, detail, need }.
const UNAVAILABLE = (name) => ({ name, status: 'Not available yet', tone: 'none', detail: 'This part of Harrison OS is not on this server yet.', need: null });

function sourcesRow(name, results, key, { none, problem }) {
  if (!results.some((r) => r && r.ok)) return UNAVAILABLE(name);
  const list = rowsOf(results, key);
  if (!list.length) return { name, status: 'Not set up', tone: 'none', detail: null, need: none };
  const real = list.filter((c) => !c.sample);
  if (list.some((c) => c.state === 'error')) return { name, status: 'Problem', tone: 'bad', detail: problem, need: 'Open its card below to refresh it or check the link.' };
  if (!real.length) return { name, status: 'Sample only', tone: 'warn', detail: 'Showing labelled sample data, not a real source.', need: none };
  const ok = real.filter((c) => c.state === 'ok').length;
  if (!ok) return { name, status: 'Added, not loaded yet', tone: 'warn', detail: null, need: 'Refresh it once to load it.' };
  return { name, status: 'Connected, read-only', tone: 'good', detail: `${ok} of ${real.length} loaded.`, need: null };
}

function rowsOf(results, key) {
  const out = [];
  for (const r of results) {
    if (r && r.ok && r.data && Array.isArray(r.data[key])) out.push(...r.data[key]);
  }
  return out;
}

/** Pure: API answers -> rows. ai, mcp: one api() result; calendar, pm: an array of api() results (one per scope). */
export function summarize({ ai, calendar = [], pm = [], mcp }, { formatAt = (v) => v } = {}) {
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
    none: 'Import a project export from the company system, or add an authorized digest link.',
    problem: 'A project source could not be updated.',
  }));

  if (!mcp || !mcp.ok || !mcp.data) rows.push(UNAVAILABLE('AI clients (MCP)'));
  else if (!mcp.data.configured) {
    rows.push({ name: 'AI clients (MCP)', status: 'Not set up', tone: 'none', detail: null, need: 'A separate Cloudflare Access service token for AI clients. Steps are in docs/MCP.md.' });
  } else {
    const can = (mcp.data.scopes || []).map(word);
    const detail =
      `${can.length ? `Can read ${can.join(' and ')} records` : 'Can read nothing'}. ` +
      `${mcp.data.allow_capture ? 'Can add captures to your inbox for review.' : 'Cannot change anything.'} ` +
      (mcp.data.last_call_at ? `Last used ${formatAt(mcp.data.last_call_at)}.` : 'No AI client has connected yet.');
    rows.push({
      name: 'AI clients (MCP)',
      status: mcp.data.last_call_at ? 'Set up, used' : 'Set up, not used yet',
      tone: mcp.data.last_call_at ? 'good' : 'warn',
      detail,
      need: null,
    });
  }

  rows.push({
    name: 'iPhone Shortcut',
    status: 'Not checked here',
    tone: 'none',
    detail: 'Sends a capture to your inbox when the phone is online. It does not keep captures while offline.',
    need: 'Setup steps are in docs/SHORTCUT.md.',
  });
  return rows;
}

function word(scope) {
  return scope === 'work' ? 'Work' : scope === 'personal' ? 'Personal' : 'no';
}

const TONE_CLASS = { good: 'chip-good', warn: 'chip-sample', bad: 'chip-bad', none: 'chip-status' };

export function register(kit) {
  const { h, api, chip, section, formatAt, state } = kit;
  kit.addMemoryBlock(async () => {
    // Only the scopes on screen are asked about, so a Work view never counts Personal connections.
    const scopes = state.scope === 'all' ? ['work', 'personal'] : [state.scope];
    const [ai, mcp, ...rest] = await Promise.all([
      api('/api/ai/status'),
      api('/api/connections/mcp'),
      ...scopes.map((s) => api(`/api/calendar/connections?scope=${s}`)),
      ...scopes.map((s) => api(`/api/pm/sources?scope=${s}`)),
    ]);
    const rows = summarize({ ai, mcp, calendar: rest.slice(0, scopes.length), pm: rest.slice(scopes.length) }, { formatAt });
    const list = h(
      'ul',
      { class: 'list conn-list' },
      ...rows.map((r) =>
        h(
          'li',
          { class: 'plain-row conn-row' },
          h('span', { class: 'conn-head' }, h('span', { class: 'row-title', text: r.name }), chip(TONE_CLASS[r.tone], r.status, 'Status: ')),
          r.detail ? h('span', { class: 'row-meta', text: r.detail }) : null,
          r.need ? h('span', { class: 'row-meta conn-need', text: `Needs: ${r.need}` }) : null,
        ),
      ),
    );
    return section('Connections', list, 'connections');
  });
}
