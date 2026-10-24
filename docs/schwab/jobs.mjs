// A page owns one immutable job. Navigation creates another realm; late work retains this scope.
export const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export const JOBS_KEY = 'fieldHub.jobs.v1', MIGRATION_KEY = 'fieldHub.legacyMigration.v1';
export const PM_ORIGIN = 'https://harrison-electrical-pm.clever-tern-3085.chatgpt.site';
const LEGACY_PM_JOB_ID = 'prj_x18rhfh3ni9shu3bmq'; // owner-confirmed CharlesS mapping: link only, never a storage or credential migration
const parse = (s, key, fallback) => { try { return JSON.parse(s.getItem(key)) ?? fallback; } catch { return fallback; } };
const fail = code => { throw Object.assign(new Error(code), { code }); };
const prefix = id => `fieldHub.job.${encodeURIComponent(id)}.`;
export function storageKey(id, key) {
  if (id === null && key.startsWith('schwab.')) return 'fieldHub.invalid.' + key.slice(7);
  if (!id || !key.startsWith('schwab.')) return key;
  return prefix(id) + key.slice(7);
}
const rawLegacy = s => Object.fromEntries(Array.from({ length: s.length }, (_, i) => s.key(i)).filter(k => k?.startsWith('schwab.') && k !== 'schwab.unlock').sort().map(k => [k, s.getItem(k)]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const browserStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };
export function createJobScope({ href = 'https://local.invalid/tasks.html', storage = browserStorage(), navigate = url => globalThis.location.assign(url) } = {}) {
  const page = new URL(href), rawId = page.searchParams.get('jobId');
  const id = rawId === null ? '' : JOB_ID.test(rawId) ? rawId : null;
  const key = k => storageKey(id, k);
  function list() {
    const rows = parse(storage, JOBS_KEY, []);
    const jobs = new Map((Array.isArray(rows) ? rows : []).filter(j => j && JOB_ID.test(j.id) && typeof j.label === 'string').map(j => [j.id, { id: j.id, label: j.label }]));
    // Recover direct-link jobs from their own settings; listing never writes or inspects legacy stores.
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i), jobId = /^fieldHub\.job\.([^.]+)\.settings$/.exec(k || '')?.[1];
        if (!jobId || !JOB_ID.test(jobId) || jobs.has(jobId)) continue;
        const settings = parse(storage, k, null);
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) continue;
        jobs.set(jobId, { id: jobId, label: typeof settings.project === 'string' && settings.project.trim() ? settings.project.trim().slice(0, 120) : jobId });
      }
    } catch { /* denied storage still permits the app to render */ }
    return [...jobs.values()];
  }
  function status() {
    if (id === null) return 'invalid_job';
    const m = parse(storage, MIGRATION_KEY, null);
    if (id && m?.jobId === id) {
      if (m.phase !== 'committed') return 'migration_incomplete';
      if (!same(rawLegacy(storage), m.source)) return 'legacy_changed';
    }
    return '';
  }
  function assertWritable() { const code = status(); if (code) fail(code); }
  function register(jobId, label) {
    if (!JOB_ID.test(jobId) || !String(label).trim()) fail('invalid_job');
    const jobs = list(), old = jobs.find(j => j.id === jobId);
    if (old) old.label = String(label).trim().slice(0, 120); else jobs.push({ id: jobId, label: String(label).trim().slice(0, 120) });
    storage.setItem(JOBS_KEY, JSON.stringify(jobs));
  }
  function remember() {
    if (!id) return;
    try {
      if (status()) return;
      const rows = parse(storage, JOBS_KEY, []);
      if (Array.isArray(rows) && rows.some(j => j?.id === id && typeof j.label === 'string')) return;
      const jobs = list();
      if (!jobs.some(j => j.id === id)) jobs.push({ id, label: id });
      storage.setItem(JOBS_KEY, JSON.stringify(jobs));
    } catch { /* the record already saved; a full registry can recover from scoped settings */ }
  }
  function url(jobId, hash = '#day/') {
    if (jobId && !JOB_ID.test(jobId)) fail('invalid_job');
    const u = new URL('tasks.html', page); u.search = ''; u.hash = hash;
    if (jobId) u.searchParams.set('jobId', jobId);
    return u.href;
  }
  function migrate(jobId, label, confirmed = false) {
    if (!confirmed || !JOB_ID.test(jobId)) fail('confirm_original');
    const old = parse(storage, MIGRATION_KEY, null);
    if (old && old.jobId !== jobId) fail('original_already_bound');
    const source = rawLegacy(storage), keys = Object.keys(source);
    if (!keys.length) fail('no_legacy_data');
    const targetKeys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(k => k?.startsWith(prefix(jobId)));
    // Recopy is explicit and permitted only when nobody edited the first copy. Both-side edits need reviewed reconciliation.
    if (old) {
      if (Object.keys(old.source).some(k => !(k in source))) fail('both_changed'); // removed legacy stores need reviewed reconciliation, never leave a stale destination silently
      if (targetKeys.some(k => !Object.keys(old.source).some(raw => storageKey(jobId, raw) === k)) || Object.entries(old.source).some(([k, v]) => { const got = storage.getItem(storageKey(jobId, k)); return got !== v && !(old.phase === 'copying' && got === null); })) fail('both_changed');
    } else if (targetKeys.length) fail('destination_not_empty');
    const marker = { jobId, phase: 'copying', source, connected: false };
    storage.setItem(MIGRATION_KEY, JSON.stringify(marker));
    try {
      for (const [k, value] of Object.entries(source)) storage.setItem(storageKey(jobId, k), value);
      if (!same(source, rawLegacy(storage)) || Object.entries(source).some(([k, value]) => storage.getItem(storageKey(jobId, k)) !== value)) fail('verify_failed');
      register(jobId, label);
      storage.setItem(MIGRATION_KEY, JSON.stringify({ ...marker, phase: 'committed' }));
    } catch (error) { throw error; } // leave the prepared marker: the partial destination cannot sync or accept writes
    return { jobId, copied: keys.length };
  }
  function openShifts() {
    const migrated = parse(storage, MIGRATION_KEY, null);
    const includeLegacy = !migrated || migrated.phase !== 'committed' || !same(rawLegacy(storage), migrated.source);
    return [...(includeLegacy ? [{ id: '', label: '' }] : []), ...list()].flatMap(j => {
      const shifts = parse(storage, storageKey(j.id, 'schwab.hours'), []);
      return (Array.isArray(shifts) ? shifts : []).filter(s => s && !s.gone && s.in && !s.out).map(s => ({ jobId: j.id, label: j.label, shiftId: s.id, date: s.date, url: url(j.id, '#clock/' + s.date) }));
    });
  }
  const needsConnection = () => { const m = parse(storage, MIGRATION_KEY, null); return !!id && m?.jobId === id && !m.connected; };
  const connected = () => { const m = parse(storage, MIGRATION_KEY, null); if (id && m?.jobId === id) storage.setItem(MIGRATION_KEY, JSON.stringify({ ...m, connected: true })); };
  return Object.freeze({ id, key, status, assertWritable, list, register, remember, migrate, openShifts, url, needsConnection, connected, switchTo: (jobId, hash) => navigate(url(jobId, hash)),
    label: () => list().find(j => j.id === id)?.label || id || '', pmUrl: () => id === null ? '' : `${PM_ORIGIN}/projects/${encodeURIComponent(id || LEGACY_PM_JOB_ID)}/pm-records` });
}
export const jobScope = createJobScope({ href: globalThis.location?.href });
export const jobKey = key => jobScope.key(key);
