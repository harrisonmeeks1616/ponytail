// Read-only calendar view: a "Calendar" block on Today (next fixed event, today's events, freshness) and a
// "Calendar (read-only)" card in Memory (add an ICS link, import a .ics file, load the sample, refresh,
// remove, health). Harrison OS only reads calendars; it never changes them and never sends calendar alerts.

const MAX_FILE_BYTES = 2 * 1024 * 1024;

const ERROR_WORDS = {
  timeout: 'The calendar did not answer within 8 seconds.',
  network: 'Could not reach the calendar.',
  too_large: 'The calendar is larger than 2 MB, so it was not loaded.',
  too_many_redirects: 'The link kept redirecting, so it was not loaded.',
  insecure_redirect: 'The link redirected to an address that is not a secure calendar link.',
  denied: 'The calendar refused the link. It may have been reset: copy a new link from your calendar app.',
  not_found: 'The link no longer works. Copy a new one from your calendar app.',
  not_ics: 'The link did not return a calendar. Check that it is the iCal (ICS) link.',
  http_error: 'The calendar service had a problem.',
};

function ago(iso, nowMs = Date.now()) {
  const ms = nowMs - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** One plain sentence about a connection's freshness and health. */
function healthWords(c, kit) {
  if (c.kind === 'ics_import') return `From a file imported ${kit.formatAt(c.last_ok_at)}. It does not update.`;
  if (c.state === 'never') return 'Not checked yet.';
  const lastGood = c.last_ok_at ? ` Showing events from ${ago(c.last_ok_at)}.` : ' No events loaded yet.';
  if (c.state === 'error') {
    const why = ERROR_WORDS[c.last_error_code] || 'The last update failed.';
    const status = c.last_error_code === 'http_error' && c.last_status ? ` (HTTP ${c.last_status})` : '';
    return `${why}${status}${lastGood}`;
  }
  if (c.stale) return `Last updated ${ago(c.last_ok_at)}. It may be out of date.`;
  return `Updated ${ago(c.last_ok_at)}.`;
}

function limitWords(c) {
  const out = [];
  if (c.unsupported_count > 0) {
    out.push(`${c.unsupported_count === 1 ? 'One repeating event uses' : `${c.unsupported_count} repeating events use`} a pattern Harrison OS cannot repeat yet; only the first date shows.`);
  }
  if (c.truncated) out.push('Only the first 2,000 events in the next six months are shown.');
  return out;
}

function localMidnight(daysFromToday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  return d;
}

function eventWhen(e, kit) {
  if (e.all_day) return 'All day';
  const start = kit.formatTimeOfDay(e.start_at);
  return e.end_at && e.end_at !== e.start_at ? `${start} to ${kit.formatTimeOfDay(e.end_at)}` : start;
}

function eventRow(e, kit, viewScope) {
  const { h } = kit;
  const otherScope = viewScope !== 'all' && e.scope !== viewScope;
  const title = e.busy_only ? 'Busy' : e.title || 'Untitled event';
  const meta = [];
  if (!e.busy_only && e.location) meta.push(e.location);
  if (e.shows_as === 'free') meta.push('Shows as free');
  return h(
    'li',
    { class: `fixed-row cal-row${e.busy_only ? ' cal-busy' : ''}` },
    h('span', { class: 'fixed-when', text: eventWhen(e, kit) }),
    h(
      'span',
      { class: 'cal-what' },
      h('span', { class: 'fixed-label', text: title }),
      meta.length ? h('span', { class: 'row-meta', text: meta.join(' · ') }) : null,
      otherScope || viewScope === 'all' || e.sample ? h('span', { class: 'chips' }, otherScope || viewScope === 'all' ? kit.scopeChip(e.scope) : null, kit.sampleChip(e)) : null,
    ),
  );
}

function overlapsDay(e, dayStart, dayEnd, kit) {
  if (e.all_day) {
    const on = kit.localOn(dayStart.getTime());
    return e.start_on <= on && on < e.end_on;
  }
  const s = Date.parse(e.start_at);
  const end = Date.parse(e.end_at || e.start_at);
  return s < dayEnd.getTime() && (end > dayStart.getTime() || (end === s && s >= dayStart.getTime()));
}

async function renderTodayBlock(kit, scope) {
  const { h, api, qs, section } = kit;
  const today = localMidnight(0);
  const tomorrow = localMidnight(1);
  const after = localMidnight(2);
  const r = await api(`/api/calendar/events?${qs({ scope, from: today.toISOString(), to: after.toISOString() })}`);
  if (!r.ok) return section('Calendar', kit.noticeBlock(kit.failWords(r, 'load the calendar'), () => kit.reloadCurrent()), 'today-calendar');
  const events = Array.isArray(r.data.events) ? r.data.events : [];
  const conns = Array.isArray(r.data.connections) ? r.data.connections : [];
  if (!conns.length && !events.length) {
    return section(
      'Calendar',
      h('p', { class: 'subtle' }, 'No calendar connected. ', h('a', { href: '#/memory', class: 'inline-link', text: 'Add a calendar in Memory' })),
      'today-calendar',
    );
  }

  const box = h('div', { class: 'stack cal-today' });
  const now = Date.now();
  const next = events.find((e) => !e.all_day && e.shows_as === 'busy' && Date.parse(e.start_at) > now);
  if (next) {
    const onTomorrow = Date.parse(next.start_at) >= tomorrow.getTime();
    box.append(
      h(
        'p',
        { class: 'cal-next' },
        h('span', { class: 'eyebrow', text: onTomorrow ? 'Next fixed event, tomorrow' : 'Next fixed event' }),
        h('span', { class: 'cal-next-line', text: `${kit.formatTimeOfDay(next.start_at)} · ${next.busy_only ? 'Busy' : next.title || 'Untitled event'}` }),
      ),
    );
  }

  const todays = events.filter((e) => overlapsDay(e, today, tomorrow, kit));
  todays.sort((a, b) => (b.all_day ? 1 : 0) - (a.all_day ? 1 : 0));
  if (todays.length) {
    const ul = h('ul', { class: 'list cal-list', 'aria-label': 'Today in your calendar' });
    for (const e of todays) ul.append(eventRow(e, kit, scope));
    box.append(ul);
  } else {
    box.append(h('p', { class: 'subtle', text: 'Nothing in your calendar today.' }));
  }

  for (const c of conns) {
    const warn = c.state === 'error' || c.stale;
    box.append(
      h(
        'p',
        { class: `small cal-health${warn ? ' cal-warn' : ' subtle'}` },
        `${c.label}: ${healthWords(c, kit)}`,
        c.sample ? ' ' : null,
        kit.sampleChip(c),
      ),
    );
  }
  return section('Calendar', box, 'today-calendar');
}

// ---------------------------------------------------------------- Memory card

function field(kit, id, labelText, input, help) {
  const { h } = kit;
  return [h('label', { for: id, text: labelText }), input, help ? h('p', { id: `${id}-help`, class: 'small subtle', text: help }) : null];
}

function scopeSelect(kit, id) {
  const { h } = kit;
  const current = kit.writeScope();
  return h(
    'select',
    { id },
    h('option', { value: 'work', text: 'Work', selected: current === 'work' }),
    h('option', { value: 'personal', text: 'Personal', selected: current === 'personal' }),
  );
}

function renderMemoryCard(kit, scope) {
  const { h, api, qs } = kit;
  const card = h('section', { class: 'card cal-card', 'aria-labelledby': 'cal-card-title' });
  const status = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
  const list = h('div', { class: 'stack' });
  const say = (text) => (status.textContent = text);

  async function loadList() {
    const r = await api(`/api/calendar/connections?${qs({ scope })}`);
    list.replaceChildren();
    if (!r.ok) {
      list.append(kit.noticeBlock(kit.failWords(r, 'load your calendars'), loadList));
      return;
    }
    const conns = r.data.connections || [];
    if (!conns.length) {
      list.append(h('p', { class: 'subtle', text: 'No calendars yet.' }));
      return;
    }
    const ul = h('ul', { class: 'list cal-conns' });
    for (const c of conns) {
      const refresh = c.refreshable
        ? h('button', {
            type: 'button',
            class: 'btn btn-secondary',
            text: 'Refresh',
            'aria-label': `Refresh ${c.label}`,
            onclick: (ev) =>
              kit.guarded(ev.currentTarget, async () => {
                say(`Refreshing ${c.label}.`);
                const rr = await api(`/api/calendar/connections/${kit.enc(c.id)}/refresh`, { method: 'POST', body: { scope: c.scope } });
                say(rr.ok ? `${c.label}: ${healthWords(rr.data.connection, kit)}` : kit.failWords(rr, 'refresh the calendar'));
                await loadList();
              }),
          })
        : null;
      const remove = h('button', {
        type: 'button',
        class: 'btn btn-ghost',
        text: 'Remove',
        'aria-label': `Remove ${c.label}`,
        onclick: (ev) =>
          kit.guarded(ev.currentTarget, async () => {
            if (!window.confirm(`Remove ${c.label} from Harrison OS? Your calendar itself is not changed.`)) return;
            const rr = await api(`/api/calendar/connections/${kit.enc(c.id)}?${qs({ scope: c.scope })}`, { method: 'DELETE' });
            say(rr.ok ? `Removed ${c.label}. Your calendar itself is unchanged.` : kit.failWords(rr, 'remove the calendar'));
            await loadList();
          }),
      });
      const warn = c.state === 'error' || c.stale;
      ul.append(
        h(
          'li',
          { class: 'plain-row cal-conn' },
          h('span', { class: 'row-title', text: c.label }),
          h('span', { class: 'chips' }, kit.scopeChip(c.scope), kit.sampleChip(c)),
          h('span', { class: 'row-meta', text: c.kind === 'ics_import' ? 'Imported file' : `Link to ${c.host}` }),
          h('span', { class: `small${warn ? ' cal-warn' : ' subtle'}`, text: healthWords(c, kit) }),
          ...limitWords(c).map((t) => h('span', { class: 'small subtle', text: t })),
          h('span', { class: 'button-row' }, refresh, remove),
        ),
      );
    }
    list.append(ul);
  }

  // Add an ICS link.
  const linkLabel = h('input', { type: 'text', id: 'cal-link-label', maxlength: '80', autocomplete: 'off', value: 'My calendar' });
  const linkUrl = h('input', {
    type: 'text', id: 'cal-link-url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '2000',
    'aria-describedby': 'cal-link-url-help', placeholder: 'https://… or webcal://…',
  });
  const linkScope = scopeSelect(kit, 'cal-link-scope');
  const addBtn = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Add calendar' });
  const linkForm = h(
    'form',
    {
      class: 'form',
      onsubmit: (ev) => {
        ev.preventDefault();
        kit.guarded(addBtn, async () => {
          const body = { scope: linkScope.value, label: linkLabel.value, url: linkUrl.value };
          const r = await api('/api/calendar/connections', { method: 'POST', body });
          if (!r.ok) {
            const msg = r.data && r.data.error && r.data.error.code === 'invalid_url' ? r.data.error.message : kit.failWords(r, 'add the calendar');
            say(msg);
            return;
          }
          linkUrl.value = '';
          const c = r.data.connection;
          say(`Added ${c.label}. Checking it now.`);
          const rr = await api(`/api/calendar/connections/${kit.enc(c.id)}/refresh`, { method: 'POST', body: { scope: c.scope } });
          say(rr.ok ? `${c.label}: ${healthWords(rr.data.connection, kit)}` : `Added ${c.label}, but the first check failed. It will try again within 30 minutes.`);
          await loadList();
        });
      },
    },
    ...field(kit, 'cal-link-label', 'Name', linkLabel),
    ...field(kit, 'cal-link-scope', 'Show it as', linkScope),
    ...field(
      kit,
      'cal-link-url',
      'Calendar link (iCal / ICS)',
      linkUrl,
      'Use the private iCal address from your calendar app. It is a secret link: it is kept only on the server, never shown again, and anyone who has it can read that calendar.',
    ),
    h('div', { class: 'button-row' }, addBtn),
  );

  // Import a .ics file.
  const fileLabel = h('input', { type: 'text', id: 'cal-file-label', maxlength: '80', autocomplete: 'off', value: 'Imported calendar' });
  const fileInput = h('input', { type: 'file', id: 'cal-file', accept: '.ics,text/calendar', class: 'cal-file', 'aria-describedby': 'cal-file-help' });
  const fileScope = scopeSelect(kit, 'cal-file-scope');
  const importBtn = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Import file' });
  const fileForm = h(
    'form',
    {
      class: 'form',
      onsubmit: (ev) => {
        ev.preventDefault();
        kit.guarded(importBtn, async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return say('Choose a .ics file first.');
          if (file.size > MAX_FILE_BYTES) return say('That file is larger than 2 MB.');
          const text = await file.text();
          const r = await api('/api/calendar/import', { method: 'POST', body: { scope: fileScope.value, label: fileLabel.value, ics_text: text } });
          if (!r.ok) return say(r.status === 422 ? 'That file is not a calendar (.ics) file.' : kit.failWords(r, 'import the file'));
          fileInput.value = '';
          say(`Imported ${kit.plural(r.data.connection.event_count, 'event', 'events')}.`);
          await loadList();
        });
      },
    },
    ...field(kit, 'cal-file-label', 'Name', fileLabel),
    ...field(kit, 'cal-file-scope', 'Show it as', fileScope),
    ...field(kit, 'cal-file', 'Calendar file (.ics)', fileInput, 'A file is a snapshot of the next six months. It does not update; import a newer file to replace it.'),
    h('div', { class: 'button-row' }, importBtn),
  );

  const sampleScope = scopeSelect(kit, 'cal-sample-scope');
  const sampleBtn = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: 'Load sample calendar',
    onclick: (ev) =>
      kit.guarded(ev.currentTarget, async () => {
        const r = await api('/api/calendar/sample', { method: 'POST', body: { scope: sampleScope.value } });
        say(r.ok ? 'Loaded a sample calendar. Its events are labelled Sample.' : kit.failWords(r, 'load the sample calendar'));
        await loadList();
      }),
  });

  card.append(
    h('h2', { id: 'cal-card-title', text: 'Calendar (read-only)' }),
    h('p', { class: 'subtle', text: 'Shows fixed events from your calendar on Today. Harrison OS only reads: it never changes your calendar and does not send calendar alerts.' }),
    list,
    status,
    h('details', { class: 'inline-form' }, h('summary', { class: 'btn btn-secondary', text: 'Add a calendar link' }), linkForm),
    h('details', { class: 'inline-form' }, h('summary', { class: 'btn btn-secondary', text: 'Import a .ics file' }), fileForm),
    h(
      'details',
      { class: 'inline-form' },
      h('summary', { class: 'btn btn-ghost', text: 'Try with sample events' }),
      h('div', { class: 'form' }, ...field(kit, 'cal-sample-scope', 'Show it as', sampleScope), h('div', { class: 'button-row' }, sampleBtn)),
    ),
  );
  loadList();
  return card;
}

export function register(kit) {
  kit.addTodayBlock((today, scope) => renderTodayBlock(kit, scope));
  kit.addMemoryBlock((_, scope) => renderMemoryCard(kit, scope));
}
