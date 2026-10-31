// Company projects (PM digest, Slice 3.1): a Today block, the #/pm screen and a Memory card for sources.
// Read-only. The company system is the official record; every project and item links back to it.
// Export text is untrusted: it is only ever set as textContent, and only https links are rendered.

const MAX_FILE_BYTES = 60 * 1024; // the API body cap is 64 KB of JSON

const ERROR_WORDS = {
  not_connected: 'Not connected: needs an authorized digest link',
  timeout: "The digest link didn't answer in time",
  network: 'Could not reach the digest link',
  redirected: 'The digest link tried to send us somewhere else, which is not allowed',
  too_large: 'The digest was too large',
  invalid_format: 'The digest was not in the expected format',
  http_401: 'The digest link refused the token',
  http_403: 'The digest link refused the token',
  http_404: 'The digest link was not found',
};

export function register(kit) {
  const {
    h, api, state, section, chip, scopeChip, sampleChip, noticeBlock, showToast, guarded, failWords, formatOn, formatAt, plural, qs,
    deviceTimeZone, addRoute, addTodayBlock, addMemoryBlock, reloadCurrent,
  } = kit;
  let loadSeq = 0;
  let updateTarget = null; // an import source the next file replaces

  const digest = (scope) => api(`/api/pm/digest?${qs({ scope, tz: deviceTimeZone() })}`);
  const errorWords = (code) => ERROR_WORDS[code] || (code ? 'The last check failed' : '');

  function freshness(s) {
    if (s.state === 'not_connected') return s.message || ERROR_WORDS.not_connected;
    if (!s.fetched_at) return s.message || 'Set up, not checked yet';
    const parts = [s.export_time_known ? `Exported ${formatAt(s.exported_at)}` : `Export time not stated, imported ${formatAt(s.fetched_at)}`];
    if (s.state === 'error') parts.push(`Last check failed: ${errorWords(s.last_error_code)}. Showing the copy from ${formatAt(s.fetched_at)}`);
    if (s.stale) parts.push('May be out of date');
    return parts.join('. ');
  }

  function changeWords(c) {
    if (!c) return null;
    if (c.first_import) return 'First import.';
    const n = c.counts || {};
    if (!n.new && !n.closed && !n.moved) return 'No changes since the previous import.';
    return `Since the previous import: ${n.new || 0} new, ${n.closed || 0} closed or gone, ${plural(n.moved || 0, 'due date', 'due dates')} moved.`;
  }

  function changeDetails(c) {
    if (!c || c.first_import) return null;
    const rows = [
      ...(c.new || []).map((x) => `New: ${x.title}`),
      ...(c.closed || []).map((x) => `${x.gone ? 'No longer in the export' : 'Closed'}: ${x.title}`),
      ...(c.moved || []).map((x) => `${x.kind === 'milestone' ? 'Milestone moved' : 'Due date moved'}: ${x.title} (${x.from ? formatOn(x.from) : 'none'} to ${x.to ? formatOn(x.to) : 'none'})`),
    ];
    if (!rows.length) return null;
    return h('details', { class: 'pm-changes' }, h('summary', { text: 'What changed' }), h('ul', { class: 'pm-change-list' }, rows.map((t) => h('li', { text: t }))));
  }

  function openLink(url, system, label) {
    if (!url) return chip('chip-due', 'No link');
    return h('a', { class: 'btn btn-secondary pm-open', href: url, target: '_blank', rel: 'noopener noreferrer' }, label || `Open in ${system || 'the company system'}`);
  }

  // ------------------------------------------------------------ Today

  addTodayBlock(async (_today, scope) => {
    if (scope === 'personal') return null;
    const r = await digest(scope);
    if (!r.ok) return h('p', { class: 'subtle', text: 'Company projects could not load right now.' });
    const { totals, sources } = r.data;
    if (!sources.some((s) => s.fetched_at)) return null;
    const parts = [];
    if (totals.overdue) parts.push(`${totals.overdue} overdue`);
    if (totals.due_soon) parts.push(`${totals.due_soon} due in the next 7 days`);
    const sample = sources.some((s) => s.fetched_at && s.sample === 1);
    return h(
      'a',
      { class: `link-card pm-today${totals.overdue ? ' is-highlight' : ''}`, href: '#/pm' },
      h('span', { class: 'eyebrow', text: totals.stale_sources ? 'Company projects · may be out of date' : 'Company projects' }),
      h('span', { class: 'link-card-title', text: parts.length ? parts.join(' · ') : 'Nothing overdue or due in the next 7 days' }),
      sample ? chip('chip-sample', 'Sample') : null,
    );
  });

  // ------------------------------------------------------------ #/pm

  function itemRow(it, system) {
    const when = !it.due_on ? 'No due date' : it.state === 'overdue' ? `Was due ${formatOn(it.due_on)}` : `Due ${formatOn(it.due_on)}`;
    const missing = [];
    if (it.missing.includes('owner')) missing.push(chip('chip-due', 'No owner'));
    if (it.missing.includes('link')) missing.push(chip('chip-due', 'No link'));
    return h(
      'li',
      { class: 'pm-item' },
      it.url
        ? h('a', { class: 'row-link', href: it.url, target: '_blank', rel: 'noopener noreferrer' },
          h('span', { class: 'row-title', text: it.title }),
          h('span', { class: 'visually-hidden', text: ` (opens in ${system || 'the company system'})` }))
        : h('span', { class: 'row-title', text: it.title }),
      h('span', { class: 'row-meta' }, [when, it.owner_label, it.status].filter(Boolean).join(' · ')),
      missing.length ? h('span', { class: 'chips' }, missing) : null,
    );
  }

  function itemGroup(title, items, system, cls) {
    if (!items.length) return null;
    return h('div', { class: `pm-group ${cls}` }, h('h3', { class: 'pm-group-title', text: `${title} · ${items.length}` }), h('ul', { class: 'list' }, items.map((it) => itemRow(it, system))));
  }

  function projectCard(p) {
    const hid = `pm-${p.id}`;
    const m = p.next_milestone;
    const gaps = [];
    if (p.missing.items_without_due) gaps.push(`${p.missing.items_without_due} without a due date`);
    if (p.missing.items_without_owner) gaps.push(`${p.missing.items_without_owner} without an owner`);
    if (p.missing.items_without_link) gaps.push(`${p.missing.items_without_link} without a link`);
    return h(
      'article',
      { class: 'card pm-project', 'aria-labelledby': hid },
      h('h2', { id: hid, class: 'card-title', text: p.name }),
      h('div', { class: 'chips' }, scopeChip(p.scope), sampleChip(p), p.status ? chip('chip-status', p.status, 'Status: ') : null, p.stale ? chip('chip-due', 'May be out of date') : null),
      m
        ? h('p', { class: `pm-milestone${m.overdue ? ' is-overdue' : ''}` }, h('span', { class: 'eyebrow', text: 'Next milestone' }), ' ', m.title, m.due_on ? ` · ${m.overdue ? 'was due' : 'due'} ${formatOn(m.due_on)}` : ' · no date')
        : h('p', { class: 'subtle', text: 'No next milestone in the export.' }),
      itemGroup('Overdue', p.overdue, p.system, 'pm-overdue'),
      itemGroup('Due in the next 7 days', p.due_soon, p.system, 'pm-soon'),
      itemGroup('No due date', p.undated, p.system, 'pm-undated'),
      p.open_count === 0 ? h('p', { class: 'subtle', text: 'No open items in the export.' }) : null,
      p.later_count ? h('p', { class: 'subtle', text: `${plural(p.later_count, 'more open item', 'more open items')} due later.` }) : null,
      gaps.length ? h('p', { class: 'subtle', text: `Missing context: ${gaps.join(', ')}.` }) : null,
      h('div', { class: 'pm-foot' }, openLink(p.url, p.system), h('span', { class: 'row-meta', text: `From ${p.source_label}` })),
    );
  }

  function sourceSummary(sources) {
    const ul = h('ul', { class: 'list pm-source-list' });
    for (const s of sources) {
      ul.append(
        h('li', { class: 'pm-source' },
          h('span', { class: 'row-title', text: s.label }),
          h('span', { class: 'chips' }, scopeChip(s.scope), sampleChip(s), s.state === 'not_connected' ? chip('chip-bad', 'Not connected') : s.state === 'error' ? chip('chip-bad', 'Check failed') : null),
          h('span', { class: 'row-meta', text: freshness(s) }),
          s.changes ? h('span', { class: 'row-meta', text: changeWords(s.changes) }) : null,
          changeDetails(s.changes)),
      );
    }
    return section('Sources', ul, 'pm-sources-summary');
  }

  async function loadPm(route, body) {
    const seq = ++loadSeq;
    body.setAttribute('aria-busy', 'true');
    if (!body.childElementCount) body.replaceChildren(h('p', { class: 'subtle', text: 'Loading.' }));
    const r = await digest(state.scope);
    if (seq !== loadSeq) return;
    body.setAttribute('aria-busy', 'false');
    if (!r.ok) {
      body.replaceChildren(noticeBlock(failWords(r, 'load company projects'), () => loadPm(route, body)));
      return;
    }
    const { sources, projects } = r.data;
    const manage = h('p', null, h('a', { class: 'inline-link', href: '#/memory', text: 'Import, refresh or remove sources in Memory' }));
    body.replaceChildren(
      h('p', { class: 'subtle', text: 'A read-only copy. The company system is the official record: open an item there to change it.' }),
      projects.length
        ? h('div', { class: 'stack' }, projects.map(projectCard))
        : h('p', { class: 'empty', text: state.scope === 'personal' ? 'No company projects in Personal.' : 'No company projects yet. Import an export file or load the sample in Memory.' }),
      sources.length ? sourceSummary(sources) : null,
      manage,
    );
  }

  addRoute('pm', { title: 'Company projects', load: loadPm });

  // ------------------------------------------------------------ Memory: sources

  async function importFile(button, form) {
    const file = form.file.files && form.file.files[0];
    const status = form.querySelector('.pm-form-status');
    if (!file) {
      status.textContent = 'Choose an export file first.';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      status.textContent = 'That file is larger than 60 KB. Export fewer projects, or ask for an authorized digest link.';
      return;
    }
    const format = /\.csv$/i.test(file.name) || file.type === 'text/csv' ? 'csv' : 'json';
    const target = updateTarget;
    const label = target ? null : form.label.value.trim();
    if (!target && !label) {
      status.textContent = 'Give this source a name.';
      return;
    }
    await guarded(button, async () => {
      status.textContent = 'Importing.';
      const content = await file.text();
      const body = target ? { scope: target.scope, source_id: target.id, format, content } : { scope: form.scope.value, label, format, content };
      const r = await api('/api/pm/import', { method: 'POST', body });
      if (!r.ok) {
        const err = (r.data && r.data.error) || {};
        status.textContent = err.code === 'invalid_import' ? `Could not import: ${err.message}.` : failWords(r, 'import the file');
        return;
      }
      const s = r.data.source || {};
      const msg = [`Imported ${plural(s.projects || 0, 'project', 'projects')} and ${plural(s.items || 0, 'open item', 'open items')}.`];
      if (!r.data.changes.first_import) msg.push(changeWords(r.data.changes));
      if (r.data.dropped_urls) msg.push(`${plural(r.data.dropped_urls, 'link was', 'links were')} not https and left out.`);
      updateTarget = null;
      showToast(msg.join(' '));
      reloadCurrent();
    });
  }

  function importForm(scope) {
    const status = h('p', { class: 'subtle pm-form-status', role: 'status', 'aria-live': 'polite' });
    const defaultScope = scope === 'personal' ? 'personal' : 'work';
    const form = h(
      'form',
      { class: 'form pm-form', onsubmit: (e) => e.preventDefault() },
      h('h3', { class: 'pm-group-title', text: updateTarget ? `Import an update to ${updateTarget.label}` : 'Import an export file' }),
      h('label', { for: 'pm-file', text: 'Export file (JSON or CSV)' }),
      h('input', { id: 'pm-file', name: 'file', type: 'file', accept: '.json,.csv,application/json,text/csv' }),
      updateTarget ? null : [
        h('label', { for: 'pm-label', text: 'Name for this source' }),
        h('input', { id: 'pm-label', name: 'label', type: 'text', maxlength: '80', value: 'Company export' }),
        h('label', { for: 'pm-scope', text: 'Keep it in' }),
        h('select', { id: 'pm-scope', name: 'scope' },
          h('option', { value: 'work', selected: defaultScope === 'work', text: 'Work' }),
          h('option', { value: 'personal', selected: defaultScope === 'personal', text: 'Personal' })),
      ],
      status,
    );
    const actions = h('div', { class: 'row-actions' });
    const importBtn = h('button', { type: 'button', class: 'btn btn-primary', text: updateTarget ? 'Import update' : 'Import' });
    importBtn.addEventListener('click', () => importFile(importBtn, form));
    actions.append(importBtn);
    if (updateTarget) {
      actions.append(h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onclick: () => { updateTarget = null; reloadCurrent(); } }));
    } else {
      const sampleBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Load sample projects' });
      sampleBtn.addEventListener('click', () =>
        guarded(sampleBtn, async () => {
          const r = await api('/api/pm/sample', { method: 'POST', body: { scope: form.scope.value } });
          if (!r.ok) return showToast(failWords(r, 'load the sample'));
          showToast('Sample projects loaded. They are labelled Sample and are not real.');
          reloadCurrent();
        }),
      );
      actions.append(sampleBtn);
    }
    form.append(actions);
    form.label?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') importFile(importBtn, form);
    });
    return form;
  }

  function sourceActions(s) {
    const box = h('div', { class: 'row-actions' });
    if (s.kind === 'http' && s.state !== 'not_connected') {
      const b = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Refresh now' });
      b.addEventListener('click', () =>
        guarded(b, async () => {
          const r = await api(`/api/pm/sources/${encodeURIComponent(s.id)}/refresh`, { method: 'POST', body: { scope: s.scope } });
          if (!r.ok) return showToast(failWords(r, 'refresh'));
          showToast(r.data.refreshed ? `Refreshed. ${changeWords(r.data.changes) || ''}` : `Refresh failed: ${errorWords(r.data.error_code)}. The previous copy is kept.`);
          reloadCurrent();
        }),
      );
      box.append(b);
    }
    if (s.kind === 'import' && s.sample !== 1) {
      box.append(h('button', {
        type: 'button', class: 'btn btn-secondary', text: 'Import update',
        onclick: () => {
          updateTarget = { id: s.id, scope: s.scope, label: s.label };
          reloadCurrent();
          setTimeout(() => document.getElementById('pm-file')?.focus(), 50);
        },
      }));
    }
    if (s.source_ref) {
      const del = h('button', { type: 'button', class: 'btn btn-danger', text: s.kind === 'http' ? 'Clear stored copy' : 'Remove' });
      del.addEventListener('click', () => {
        if (!window.confirm(`Remove ${s.label} and its copied projects from Harrison OS? The company system is not changed.`)) return;
        guarded(del, async () => {
          const r = await api(`/api/pm/sources/${encodeURIComponent(s.id)}?${qs({ scope: s.scope })}`, { method: 'DELETE' });
          if (!r.ok) return showToast(failWords(r, 'remove the source'));
          showToast(`${s.label} removed.`);
          reloadCurrent();
        });
      });
      box.append(del);
    }
    return box.childElementCount ? box : null;
  }

  addMemoryBlock(async (_none, scope) => {
    const card = h('section', { class: 'card pm-memory', 'aria-labelledby': 'pm-memory-h' }, h('h2', { id: 'pm-memory-h', text: 'Company project sources' }));
    card.append(h('p', { class: 'subtle', text: 'Read-only copies of company project status. The company system stays the official record.' }));
    const r = await api(`/api/pm/sources?${qs({ scope })}`);
    if (!r.ok) {
      card.append(noticeBlock(failWords(r, 'load project sources'), () => reloadCurrent()));
      return card;
    }
    const ul = h('ul', { class: 'list pm-source-list' });
    for (const s of r.data.sources) {
      ul.append(
        h('li', { class: 'pm-source' },
          h('span', { class: 'row-title', text: s.label }),
          h('span', { class: 'chips' }, scopeChip(s.scope), sampleChip(s), chip('chip-kind', s.kind === 'http' ? 'Digest link' : 'File import'),
            s.state === 'not_connected' ? chip('chip-bad', 'Not connected') : s.state === 'error' ? chip('chip-bad', 'Check failed') : null),
          h('span', { class: 'row-meta', text: freshness(s) }),
          s.fetched_at ? h('span', { class: 'row-meta', text: `${plural(s.projects, 'project', 'projects')}, ${plural(s.items, 'open item', 'open items')}` }) : null,
          s.changes ? h('span', { class: 'row-meta', text: changeWords(s.changes) }) : null,
          changeDetails(s.changes),
          s.kind === 'http' && s.fetched_at ? h('span', { class: 'row-meta', text: 'Checked about once an hour while the link is set up.' }) : null,
          sourceActions(s)),
      );
    }
    if (r.data.sources.length) card.append(ul);
    card.append(importForm(scope));
    if (r.data.sources.some((s) => s.fetched_at)) card.append(h('p', null, h('a', { class: 'inline-link', href: '#/pm', text: 'See the project digest' })));
    return card;
  });
}
