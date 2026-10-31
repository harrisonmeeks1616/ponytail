// Weekly review screen (#/weekly) and its Today link. Server: src/review.js (/api/review/weekly*).
// Nothing here changes a record unless the owner taps a button; hard dates are never moved.
export function register(kit) {
  const { h, api, state, section, chip, scopeChip, sampleChip, statusChip, noticeBlock, showToast, showNotice, guarded, failWords } = kit;
  const { formatOn, formatAt, excerpt, enc, qs, plural, deviceTimeZone, reloadCurrent, sourceWords } = kit;

  kit.addRoute('weekly', { title: 'Weekly review', load });

  kit.addTodayBlock(async (today, scope) => {
    const r = await api(`/api/review/weekly/status?${qs({ scope })}`);
    if (!r.ok || !r.data || !r.data.due) return null;
    return section(
      'Weekly review',
      h(
        'a',
        { class: 'link-card', href: '#/weekly' },
        h('span', { class: 'eyebrow', text: 'A few minutes' }),
        h('span', { class: 'link-card-title', text: 'Look over your week' }),
      ),
      'today-weekly',
    );
  });

  // Where "Open" goes for a row. null when there is no screen for it.
  function openHref(row) {
    const [type, id] = String(row.ref).split(/:(.*)/s);
    if (type === 'project') return `#/project/${enc(id)}`;
    if (type === 'pm' || type === 'event') return row.url || null;
    if (type !== 'item') return null;
    if (row.kind === 'waiting') return '#/waiting';
    if (row.project_id) return `#/project/${enc(row.project_id)}`;
    if (row.kind === 'task') return '#/tasks';
    return '#/memory';
  }

  function dateWords(row) {
    if (row.at) return formatAt(row.at);
    if (row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) return formatOn(row.date);
    return row.date ? formatAt(row.date) : '';
  }

  let refocus = null;
  function keepPlace(button) {
    const head = button.closest('section') && button.closest('section').querySelector('h2');
    refocus = head ? head.id : null;
  }

  async function post(path, body, what) {
    const r = await api(path, { method: 'POST', body: { time_zone: deviceTimeZone(), ...body } });
    if (!r.ok) showNotice(failWords(r, what));
    return r;
  }

  function actions(row, { pick = false, defer = null } = {}) {
    const box = h('div', { class: 'row-actions' });
    if (pick && !row.selected) {
      box.append(
        h('button', {
          type: 'button',
          class: 'btn btn-secondary',
          text: 'Pick for this week',
          'aria-label': `Pick for this week: ${excerpt(row.title || 'item', 60)}`,
          onclick: (e) =>
            guarded(e.currentTarget, async () => {
              keepPlace(e.currentTarget);
              const r = await post('/api/review/weekly/select', { scope: row.scope, refs: [row.ref], today: row.kind === 'task' }, 'pick this');
              if (!r.ok) return;
              showToast(r.data.picked_for_today ? 'Picked for this week and added to Today.' : 'Picked for this week.', r.data.changeId);
              reloadCurrent();
            }),
        }),
      );
    }
    if (defer) {
      box.append(
        h('button', {
          type: 'button',
          class: 'btn btn-ghost',
          text: 'Not this week',
          'aria-label': `Not this week: ${excerpt(row.title || 'item', 60)}`,
          onclick: (e) =>
            guarded(e.currentTarget, async () => {
              keepPlace(e.currentTarget);
              const r = await post('/api/review/weekly/defer', { scope: row.scope, ref: row.ref, [defer.field]: defer.until }, 'move this to next week');
              if (!r.ok) return;
              showToast(`Moved to ${formatOn(defer.until)}. Due dates stay as they are.`, r.data.changeId);
              reloadCurrent();
            }),
        }),
      );
    }
    const href = openHref(row);
    if (href) {
      const external = /^https:/i.test(href);
      box.append(
        h('a', {
          class: 'btn btn-ghost',
          href,
          text: 'Open',
          'aria-label': `Open: ${excerpt(row.title || 'item', 60)}`,
          ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        }),
      );
    }
    return box.childNodes.length ? box : null;
  }

  function rowNode(row, meta, opts) {
    return h(
      'li',
      null,
      h(
        'div',
        { class: 'plain-row' },
        h('span', { class: 'row-title', text: row.title ? excerpt(row.title, 160) : row.kind === 'event' ? 'Busy' : 'Untitled' }),
        meta.filter(Boolean).length ? h('span', { class: 'row-meta', text: meta.filter(Boolean).join(' · ') }) : null,
        h(
          'span',
          { class: 'chips' },
          scopeChip(row.scope),
          sampleChip(row),
          row.claim_status ? statusChip(row.claim_status) : null,
          row.selected ? chip('chip-good', 'Picked this week') : null,
        ),
        actions(row, opts || {}),
      ),
    );
  }

  function list(rows, render, empty) {
    if (!rows.length) return h('p', { class: 'empty', text: empty });
    return h('ul', { class: 'list' }, rows.map(render));
  }

  const KIND_WORDS = { task: 'Task', decision: 'Decision', reference: 'Reference', reminder: 'Reminder', event: 'Calendar', pm: 'Company project', project: 'Project', waiting: 'Waiting on', idea: 'Idea' };

  function render(body, d) {
    const next = d.next_monday;
    const s = d.sections;
    const out = [];
    out.push(h('p', { class: 'subtle', text: 'The last 7 days and the next 2 weeks. Nothing changes unless you choose it here.' }));
    if (d.status && !d.status.due && d.status.last_completed_at) {
      out.push(h('p', { class: 'notice notice-quiet', text: `Marked done ${formatAt(d.status.last_completed_at)}.` }));
    }

    const missing = [];
    if (d.sources.calendar === 'not_available') missing.push('Calendar is not set up, so events are not included.');
    if (d.sources.calendar === 'error') missing.push('Calendar could not be read just now, so events are missing.');
    if (d.sources.pm === 'not_available') missing.push('Company project status is not set up, so it is not included.');
    if (d.sources.pm === 'error') missing.push('Company project status could not be read just now.');

    out.push(
      section(
        'Coming up: fixed dates',
        h(
          'div',
          null,
          h('p', { class: 'subtle small', text: 'These dates stay as they are. Moving a task to next week only changes when it shows up.' }),
          list(
            s.hard,
            (r) =>
              rowNode(
                r,
                [
                  KIND_WORDS[r.kind],
                  r.past ? `Was due ${dateWords(r)}` : r.kind === 'event' || r.kind === 'reminder' ? dateWords(r) : `Due ${dateWords(r)}`,
                  r.deferred_until || r.start_on ? `Shows from ${formatOn(r.deferred_until || r.start_on)}` : null,
                  r.fetched_at ? `Updated ${formatAt(r.fetched_at)}` : null,
                ],
                {
                  pick: r.ref.startsWith('item:'),
                  defer: r.kind === 'task' && !r.deferred_until && r.date >= next ? { field: 'start_on', until: next } : null,
                },
              ),
            'No fixed dates in the next 2 weeks.',
          ),
          missing.length ? h('p', { class: 'subtle small', text: missing.join(' ') }) : null,
        ),
        'weekly-hard',
      ),
    );

    out.push(
      section(
        `Follow-ups by ${formatOn(d.follow_up_by)}`,
        list(
          s.follow_ups,
          (r) =>
            rowNode(
              r,
              [
                r.who ? `Waiting on ${r.who}` : 'Waiting on someone',
                `Follow up ${r.past ? 'was planned for' : 'on'} ${formatOn(r.date)}`,
                r.promised_on ? `They said ${formatOn(r.promised_on)}` : null,
                r.reply_recorded_at ? `Reply recorded ${formatAt(r.reply_recorded_at)}` : 'No reply recorded',
              ],
              { pick: true, defer: { field: 'follow_up_on', until: next } },
            ),
          'No follow-ups due before the end of next week.',
        ),
        'weekly-follow-ups',
      ),
    );

    out.push(
      section(
        'Done in the last 7 days',
        list(s.completed, (r) => rowNode(r, [KIND_WORDS[r.kind], `Done ${formatAt(r.date)}`]), 'Nothing marked done this week.'),
        'weekly-completed',
      ),
    );

    const ch = s.changes;
    const changeRows = [
      ...ch.decisions.map((r) => rowNode(r, ['Decision recorded', formatAt(r.date), r.supersedes ? 'Replaces an earlier decision' : null, r.superseded_by ? 'Since replaced' : null])),
      ...ch.replies.map((r) => rowNode(r, [r.who ? `Reply from ${r.who} recorded` : 'Reply recorded', formatAt(r.date)])),
    ];
    out.push(
      section(
        'What changed',
        h(
          'div',
          null,
          changeRows.length ? h('ul', { class: 'list' }, changeRows) : null,
          h('p', {
            class: 'subtle',
            text:
              (ch.captures.sorted ? `${plural(ch.captures.sorted, 'capture', 'captures')} from this week sorted.` : 'No captures sorted this week.') +
              (ch.captures.pending ? ` ${plural(ch.captures.pending, 'capture is', 'captures are')} still to review.` : ''),
          }),
          ch.captures.pending ? h('a', { class: 'inline-link', href: '#/review', text: 'Review captures' }) : null,
        ),
        'weekly-changes',
      ),
    );

    out.push(
      section(
        'Decisions still open',
        list(
          s.decisions,
          (r) => rowNode(r, [r.reconsider_when ? `Reconsider when: ${excerpt(r.reconsider_when, 80)}` : null, `Recorded ${formatAt(r.date)}`], { pick: true, defer: { field: 'start_on', until: next } }),
          'No open decisions.',
        ),
        'weekly-decisions',
      ),
    );

    out.push(
      section(
        'Where to pick up',
        list(
          s.resume,
          (r) =>
            rowNode(
              r,
              [
                r.checkpoint.next_step ? `Next: ${excerpt(r.checkpoint.next_step, 100)}` : null,
                r.checkpoint.open_question ? `Open question: ${excerpt(r.checkpoint.open_question, 100)}` : null,
                `Place saved ${formatAt(r.date)}`,
                sourceWords(r.checkpoint.source_ref),
              ],
              { pick: true },
            ),
          'No saved places yet.',
        ),
        'weekly-resume',
      ),
    );

    if (s.quiet.length) {
      out.push(
        section(
          'Quiet projects',
          list(s.quiet, (r) => rowNode(r, [`No activity recorded since ${formatAt(r.date)}`], { pick: true, defer: { field: 'start_on', until: next } }), ''),
          'weekly-quiet',
        ),
      );
    }

    out.push(
      section(
        'Ideas (not commitments)',
        h(
          'div',
          null,
          list(s.ideas, (r) => rowNode(r, [`Noted ${formatAt(r.date)}`]), 'No ideas saved.'),
          d.idea_count > s.ideas.length ? h('p', { class: 'subtle small', text: `Showing the newest ${s.ideas.length} of ${d.idea_count}.` }) : null,
        ),
        'weekly-ideas',
      ),
    );

    const doneBtn = h('button', {
      type: 'button',
      class: 'btn btn-primary btn-block',
      id: 'weekly-done',
      text: 'Mark review done',
      onclick: (e) =>
        guarded(e.currentTarget, async () => {
          const scopes = state.scope === 'all' ? ['work', 'personal'] : [state.scope];
          for (const scope of scopes) {
            const r = await post('/api/review/weekly/complete', { scope }, 'mark the review done');
            if (!r.ok) return;
          }
          showToast('Weekly review marked done.', null);
          reloadCurrent();
        }),
    });
    out.push(doneBtn);
    body.replaceChildren(...out);
    // After an action the list is rebuilt: put keyboard focus back on the heading of the section used.
    const back = refocus && document.getElementById(refocus);
    refocus = null;
    if (back) {
      back.setAttribute('tabindex', '-1');
      back.focus({ preventScroll: true });
    }
  }

  let seq = 0;
  async function load(route, body) {
    const mine = ++seq;
    // A refresh after an action keeps the current list (and scroll) until the new one arrives.
    if (!body.querySelector('#weekly-done') || body.dataset.scope !== state.scope) {
      body.replaceChildren(h('p', { class: 'subtle', text: 'Loading your week…' }));
    }
    body.dataset.scope = state.scope;
    const r = await api(`/api/review/weekly?${qs({ scope: state.scope, tz: deviceTimeZone() })}`);
    if (mine !== seq) return;
    if (!r.ok || !r.data || !r.data.sections) {
      body.replaceChildren(noticeBlock(failWords(r, 'load the weekly review'), () => reloadCurrent()));
      return;
    }
    render(body, r.data);
  }
}
