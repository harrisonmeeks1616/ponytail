// Reminders (#/reminders): list, create, edit and cancel. Times are wall-clock times in the reminder's own
// zone; the server works out each firing (DST-safe). Delivery words say only what was observed: a push the
// service accepted is not an alert seen on the phone. Uses only the kit from app.js.

let kit;
let seq = 0;
const PAST_SHOWN = 10;
// 409 reasons from PATCH /api/reminders/:id. The form keeps what was typed in every case.
const CONFLICT_WORDS = {
  firing_now: 'This reminder is being sent right now. Your changes are still here: press Save again in a minute.',
  alert_held: 'An alert from this reminder is waiting for quiet hours to end. Edit it after that alert goes out, or cancel the reminder and add a new one. Your changes are still here.',
  stale_edit: 'This reminder was changed somewhere else since you opened it. Your changes are still here: reload the list to see the current version, then save again.',
  not_active: 'This reminder already fired or was cancelled. Your words are still here: add them as a new reminder.',
  concurrent_change: 'This reminder changed while saving. Your changes are still here: reload the list, then save again.',
};

export function register(k) {
  kit = k;
  k.addRoute('reminders', { title: 'Reminders', load });
  k.addTodayBlock(todayLink);
}

const scopeWord = (s) => (s === 'personal' ? 'Personal' : 'Work');
const repeatWord = (r) => (r === 'daily' ? 'Every day' : 'Once');

function scopes() {
  return kit.state.scope === 'all' ? ['work', 'personal'] : [kit.state.scope];
}

async function fetchAll() {
  const rs = await Promise.all(scopes().map((s) => kit.api(`/api/reminders?${kit.qs({ scope: s })}`)));
  const bad = rs.find((r) => !r.ok);
  if (bad) return { error: kit.failWords(bad, 'load reminders') };
  return { items: rs.flatMap((r) => (Array.isArray(r.data.items) ? r.data.items : [])) };
}

async function todayLink() {
  const r = await fetchAll();
  if (r.error) return null;
  const active = r.items.filter((x) => x.state === 'active').length;
  const { h } = kit;
  return h(
    'div',
    { class: 'link-grid' },
    h('a', { class: 'link-card', href: '#/reminders' }, h('span', { class: 'eyebrow', text: 'Reminders' }), h('span', { class: 'link-card-title', text: active ? `${active} set` : 'None set' })),
  );
}

// What is known about one delivery, from the server's states (deliveries.state: scheduled, held_by_policy,
// sent, no_route, failed, received_on_device, acknowledged).
export function deliveryWords(d) {
  if (!d) return null;
  if (d.acknowledged_at) return 'You opened the alert.';
  if (d.received_at) return 'Your phone reported the alert arrived.';
  if (d.state === 'held_by_policy') return 'Held for quiet hours; it is sent when they end.';
  if (d.state === 'sent') return 'Sent to the push service. That is not proof it showed on your phone.';
  if (d.state === 'no_route') return 'Not sent: no phone is set up for alerts.';
  if (d.state === 'failed') return 'Sending failed.';
  if (d.outcome_unknown) return 'Outcome unknown: the send started and never reported back.';
  return 'Sending.';
}

async function load(route, body) {
  const my = ++seq;
  body.setAttribute('aria-busy', 'true');
  if (!body.childElementCount) body.replaceChildren(kit.h('p', { class: 'subtle', text: 'Loading.' }));
  const r = await fetchAll();
  if (my !== seq) return;
  body.setAttribute('aria-busy', 'false');
  if (r.error) {
    body.replaceChildren(kit.noticeBlock(r.error, () => load(route, body)));
    return;
  }
  render(body, r.items, route);
}

function render(body, items, route) {
  const { h, section } = kit;
  const active = items.filter((x) => x.state === 'active').sort((a, b) => (a.next_fire_at || 0) - (b.next_fire_at || 0));
  const past = items.filter((x) => x.state !== 'active').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, PAST_SHOWN);
  const reload = () => load(route, body);
  // h() skips the missing Recent section; replaceChildren() itself would print null.
  body.replaceChildren(h('div', { class: 'stack' },
    h('p', { class: 'subtle', text: 'Alerts Harrison OS sends to your phone. Each time is local to the zone shown, and stays that local time across daylight-saving changes.' }),
    section('New reminder', reminderForm(null, reload), 'rem-new'),
    section('Set', active.length ? h('ul', { class: 'list' }, active.map((x) => activeRow(x, reload))) : h('p', { class: 'subtle', text: 'No reminders set.' }), 'rem-active'),
    past.length ? section('Recent', h('ul', { class: 'list' }, past.map(pastRow)), 'rem-past') : null,
  ));
}

function meta(x) {
  const zone = x.time_zone && x.time_zone !== kit.deviceTimeZone() ? ` (${x.time_zone})` : '';
  return [repeatWord(x.recurrence), x.next_fire_label ? `Next: ${x.next_fire_label}${zone}` : null].filter(Boolean).join(' · ');
}

function activeRow(x, reload) {
  const { h, chip, scopeChip, sampleChip, guarded, api, enc, showToast, showNotice, failWords, excerpt } = kit;
  const li = h('li', { class: 'plain-row rem-row', dataset: { id: x.id } });
  const view = h(
    'div',
    null,
    h('span', { class: 'row-title', text: x.text }),
    h('span', { class: 'row-meta', text: meta(x) }),
    h('span', { class: 'chips' }, kit.state.scope === 'all' ? scopeChip(x.scope) : null, x.item_id ? chip('chip-kind', 'Linked to an item') : null, sampleChip(x)),
  );
  const editSlot = h('div');
  const edit = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: 'Edit',
    'aria-label': `Edit reminder: ${excerpt(x.text, 60)}`,
    'aria-expanded': 'false',
    onclick: () => {
      const open = !editSlot.childElementCount;
      editSlot.replaceChildren(...(open ? [reminderForm(x, reload, () => edit.click())] : []));
      edit.setAttribute('aria-expanded', String(open));
      if (open) editSlot.querySelector('input').focus();
    },
  });
  const cancel = h('button', {
    type: 'button',
    class: 'btn btn-danger',
    text: 'Cancel reminder',
    'aria-label': `Cancel reminder: ${excerpt(x.text, 60)}`,
    onclick: (e) => {
      if (!window.confirm(`Cancel “${excerpt(x.text, 80)}”? It will not fire again.`)) return;
      guarded(e.currentTarget, async () => {
        const r = await api(`/api/reminders/${enc(x.id)}/cancel`, { method: 'POST', body: { scope: x.scope } });
        if (!r.ok) {
          showNotice(failWords(r, 'cancel it'));
          return;
        }
        showToast('Reminder cancelled.', null);
        reload();
      });
    },
  });
  li.append(view, h('div', { class: 'button-row' }, edit, cancel), editSlot);
  return li;
}

function pastRow(x) {
  const { h, scopeChip } = kit;
  const d = Array.isArray(x.deliveries) && x.deliveries.length ? x.deliveries[0] : null;
  const what = x.state === 'cancelled' ? 'Cancelled.' : deliveryWords(d) || 'Done.';
  return h(
    'li',
    { class: 'plain-row' },
    h('span', { class: 'row-title', text: x.text }),
    h('span', { class: 'row-meta', text: [`${x.local_date} ${x.local_time}`, what].join(' · ') }),
    kit.state.scope === 'all' ? h('span', { class: 'chips' }, scopeChip(x.scope)) : null,
  );
}

// existing: null for a new reminder. Only changed fields are sent on an edit, and the words typed stay in
// the form if saving fails (a conflict or a time that has passed), so nothing is lost.
function reminderForm(existing, reload, onDone) {
  const { h, guarded, api, enc, showToast, failWords, localOn, deviceTimeZone, writeScope } = kit;
  const n = ++seq;
  const id = (k) => `rf-${n}-${k}`;
  const zoneHere = deviceTimeZone();
  let newId = null; // a new reminder's id: set at the first Add and kept for this form's whole life
  const text = h('input', { id: id('text'), type: 'text', maxlength: 4000, value: existing ? existing.text : '', autocomplete: 'off' });
  const date = h('input', { id: id('date'), type: 'date', value: existing ? existing.local_date : localOn(), min: existing ? undefined : localOn() });
  const time = h('input', { id: id('time'), type: 'time', value: existing ? existing.local_time : '09:00' });
  const repeat = h('select', { id: id('repeat') }, h('option', { value: 'none', text: 'Once' }), h('option', { value: 'daily', text: 'Every day' }));
  repeat.value = existing ? existing.recurrence : 'none';
  const kids = [
    h('label', { for: id('text'), text: 'Remind me to' }), text,
    h('label', { for: id('date'), text: 'Date' }), date,
    h('label', { for: id('time'), text: 'Time' }), time,
    h('label', { for: id('repeat'), text: 'Repeat' }), repeat,
  ];
  let scopeSel = null;
  if (!existing && kit.state.scope === 'all') {
    scopeSel = h('select', { id: id('scope') }, h('option', { value: 'work', text: 'Work' }), h('option', { value: 'personal', text: 'Personal' }));
    scopeSel.value = writeScope();
    kids.push(h('label', { for: id('scope'), text: 'Keep it in' }), scopeSel);
  }
  let useHere = null;
  if (existing && existing.time_zone !== zoneHere) {
    useHere = h('input', { id: id('zone'), type: 'checkbox' });
    kids.push(h('p', { class: 'subtle small', text: `Its times are in ${existing.time_zone}.` }), h('label', { class: 'check-label' }, useHere, ` Use this phone's zone instead (${zoneHere})`));
  }
  const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const save = h('button', { type: 'submit', class: 'btn btn-primary', text: existing ? 'Save changes' : 'Add reminder' });
  const actions = h('div', { class: 'button-row' }, save);
  if (existing) actions.append(h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onclick: () => onDone && onDone() }));
  const form = h('form', { class: 'form', novalidate: true }, ...kids, err, actions);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fail = (msg) => {
      err.textContent = msg;
      err.hidden = false;
    };
    const v = { text: text.value.trim(), local_date: date.value, local_time: time.value, recurrence: repeat.value };
    if (!v.text) return fail('Say what to remind you about.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.local_date) || !/^\d{2}:\d{2}$/.test(v.local_time)) return fail('A reminder needs a date and a time.');
    err.hidden = true;
    guarded(save, async () => {
      let r;
      if (existing) {
        const patch = {};
        for (const k of Object.keys(v)) if (v[k] !== existing[k]) patch[k] = v[k];
        if (useHere && useHere.checked) patch.time_zone = zoneHere;
        if (!Object.keys(patch).length) {
          if (onDone) onDone();
          return;
        }
        // The reminder as this form loaded it: the server refuses the edit if it changed since (another tab or device).
        // Only what a person edits: the cron moving a daily reminder's next firing is not someone else's change.
        const expected = { text: existing.text, time_zone: existing.time_zone, local_date: existing.local_date, local_time: existing.local_time, recurrence: existing.recurrence };
        r = await api(`/api/reminders/${enc(existing.id)}`, { method: 'PATCH', body: { ...patch, scope: existing.scope, expected } });
      } else {
        // One id per new reminder, kept until the server confirms: if a save committed but its answer was lost,
        // pressing Add again is a retry of the same reminder, never a second alert. Changed words under the same
        // id answer 409 id_conflict (handled below), so an unknown earlier save is never duplicated either.
        if (!newId) newId = `rem-${crypto.randomUUID()}`;
        r = await api('/api/reminders', { method: 'POST', body: { id: newId, ...v, time_zone: zoneHere, scope: scopeSel ? scopeSel.value : writeScope() } });
      }
      if (!r.ok) {
        if (r.status === 409) {
          const code = r.data && r.data.error && r.data.error.code;
          if (!existing && code === 'id_conflict') {
            return fail('Your earlier Add was saved after all, with the words it had then, so this was not saved as a second reminder. What you typed is still here: copy it if you need it, then reload this screen and edit that reminder.');
          }
          return fail(CONFLICT_WORDS[code] || CONFLICT_WORDS.concurrent_change);
        }
        return fail(failWords(r, existing ? 'save the changes' : 'add the reminder'));
      }
      // newId is NOT cleared: until the reloaded list replaces this form, pressing Add again here reuses the same
      // id (an idempotent duplicate on the server, not a second alert). The replacement form starts with none.
      const label = r.data && r.data.first_fire && r.data.first_fire.localLabel;
      showToast(`${existing ? 'Reminder saved' : 'Reminder added'}.${label ? ` Next: ${label}.` : ''}`, null);
      reload();
    });
  });
  return form;
}
