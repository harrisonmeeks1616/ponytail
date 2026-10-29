// Restore into a new generation, never over a namespace an older tab may still write.
// Each generation and its per-key overlay remain available after returning to its parent.
const HEAD = 'fieldHub.restoreHead.', GENERATION = 'fieldHub.restoreGeneration.', OVERLAY = 'fieldHub.restoreOverlay.';
const ID = /^[a-f0-9]{32}$/;
const validId = id => typeof id === 'string' && ID.test(id);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const error = code => Object.assign(new Error(code), { code });
const same = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

export function createRestoreStorage(rawInput, prefix) {
  if (prefix !== 'schwab.' && !/^fieldHub\.job\.[A-Za-z0-9_-]{1,100}\.$/.test(prefix)) throw new TypeError('restore_prefix');
  const scope = encodeURIComponent(prefix), headKey = HEAD + scope, generations = GENERATION + scope + '.', overlays = OVERLAY + scope + '.';
  const scoped = k => typeof k === 'string' && k.startsWith(prefix) && k.length > prefix.length && k.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(k);
  const metadata = k => k.startsWith(HEAD) || k.startsWith(GENERATION) || k.startsWith(OVERLAY);
  const rawKeys = () => { const n = raw.length; if (!Number.isSafeInteger(n) || n < 0) throw error('restore_invalid'); return [...new Set(Array.from({ length: n }, (_, i) => raw.key(i)).filter(k => typeof k === 'string'))]; };
  const head = () => { const h = raw.getItem(headKey); if (h !== null && !validId(h)) throw error('restore_invalid'); return h; };
  let raw = null, captured;
  // Browser storage is stable, but fixtures/profile switches can provide another Storage object. Pin lazily per object,
  // never when only its head changes: that is another tab restoring, and this realm must stop writing its stale view.
  function resolve() {
    let next;
    try { next = typeof rawInput === 'function' ? rawInput() : rawInput; } catch { throw error('restore_invalid'); }
    if (!next || !['getItem', 'setItem', 'removeItem', 'key'].every(k => typeof next[k] === 'function')) throw error('restore_invalid');
    if (next !== raw) { raw = next; try { captured = head(); } catch { captured = undefined; } }
    return raw;
  }

  function readGeneration(id) {
    if (!validId(id)) throw error('restore_invalid');
    let g;
    try { g = JSON.parse(raw.getItem(generations + id)); } catch { throw error('restore_invalid'); }
    if (!object(g) || Object.keys(g).sort().join(',') !== 'before,data,parent,v' || g.v !== 1 || (g.parent !== null && !validId(g.parent)) || !object(g.before) || !object(g.data)) throw error('restore_invalid');
    if (Object.entries(g.before).some(([k, v]) => !scoped(k) || typeof v !== 'string') || Object.entries(g.data).some(([k, v]) => !scoped(k) || (v !== null && typeof v !== 'string'))) throw error('restore_invalid');
    return g;
  }

  function snapshot(id) {
    const out = new Map();
    if (id === null) {
      for (const k of rawKeys()) if (k.startsWith(prefix)) { if (!scoped(k)) throw error('restore_invalid'); const v = raw.getItem(k); if (v !== null) out.set(k, v); }
      return out;
    }
    const g = readGeneration(id);
    for (const [k, v] of Object.entries(g.before)) out.set(k, v);
    for (const [k, v] of Object.entries(g.data)) v === null ? out.delete(k) : out.set(k, v);
    const start = overlays + id + '.';
    for (const physical of rawKeys()) if (physical.startsWith(start)) {
      let k, v;
      try { k = decodeURIComponent(physical.slice(start.length)); v = JSON.parse(raw.getItem(physical)); } catch { throw error('restore_invalid'); }
      if (!scoped(k) || encodeURIComponent(k) !== physical.slice(start.length) || (v !== null && typeof v !== 'string')) throw error('restore_invalid');
      v === null ? out.delete(k) : out.set(k, v);
    }
    return out;
  }

  function status() {
    try {
      resolve();
      const active = head();
      if (captured === undefined) return 'restore_invalid';
      if (active !== captured) return 'restore_changed';
      const visited = new Set(), chain = [];
      for (let id = captured; id !== null;) {
        if (visited.has(id)) return 'restore_invalid';
        visited.add(id);
        const g = readGeneration(id);
        chain.push([id, g]);
        id = g.parent;
      }
      for (const [id, g] of chain) {
        // Validate overlays too, even when only the parent comparison is needed below.
        snapshot(id);
        if (!same(snapshot(g.parent), new Map(Object.entries(g.before)))) return 'restore_conflict';
      }
      return '';
    } catch { return 'restore_invalid'; }
  }
  const writable = () => { const s = status(); if (s) throw error(s); };
  const logicalKeys = () => { resolve(); return [...new Set([...rawKeys().filter(k => !k.startsWith(prefix) && !metadata(k)), ...snapshot(captured).keys()])].sort(); };

  function change(k, value) {
    resolve();
    k = String(k);
    if (!k.startsWith(prefix)) { value === null ? raw.removeItem(k) : raw.setItem(k, value); return; }
    if (!scoped(k)) throw error('restore_invalid');
    writable();
    if (captured === null) value === null ? raw.removeItem(k) : raw.setItem(k, value);
    else raw.setItem(overlays + captured + '.' + encodeURIComponent(k), JSON.stringify(value));
    // A legacy writer can run after the check. Its original key and this overlay are both retained; pause the restored view.
    writable();
  }

  function stage(plan) {
    let id = null;
    try {
      writable();
      if (!(plan instanceof Map) || [...plan].some(([k, v]) => !scoped(k) || (v !== null && typeof v !== 'string'))) throw error('restore_invalid');
      const before = snapshot(captured), parent = captured;
      id = globalThis.crypto.randomUUID().replaceAll('-', '');
      if (!validId(id)) throw error('restore_invalid');
      const payload = JSON.stringify({ v: 1, parent, before: Object.fromEntries(before), data: Object.fromEntries(plan) });
      if (raw.getItem(generations + id) !== null) throw error('restore_invalid');
      raw.setItem(generations + id, payload);
      if (raw.getItem(generations + id) !== payload) throw error('restore_invalid');
      readGeneration(id);
      writable();
      if (!same(snapshot(parent), before)) throw error('restore_conflict');
      raw.setItem(headKey, id); // the only commit: every restored value already exists in the verified immutable payload
      captured = id;
      return status() === '';
    } catch {
      // A storage shim may throw after performing its write. Recover that outcome without touching anyone else's head/data.
      if (id) try {
        if (head() === id) { captured = id; return status() === ''; }
      } catch { /* retain an uncertain payload; deleting a generation is never recovery */ }
      // Failed/unpublished payloads remain private archives. Another realm may already reference one; no automatic cleanup.
      return false;
    }
  }

  function returnToParent() {
    try {
      resolve();
      const problem = status();
      if (problem && problem !== 'restore_conflict') return false;
      if (captured === undefined || captured === null || head() !== captured) return false;
      const parent = readGeneration(captured).parent;
      if (parent !== null) readGeneration(parent);
      parent === null ? raw.removeItem(headKey) : raw.setItem(headKey, parent);
      captured = parent;
      return true;
    } catch { return false; }
  }

  return {
    get raw() { return resolve(); },
    status, stage, returnToParent,
    affectsKey(k) { return typeof k === 'string' && (k === headKey || k.startsWith(prefix) || k.startsWith(overlays)); },
    recoverySnapshot() {
      resolve();
      return new Map(rawKeys().filter(k => k.startsWith(prefix) || k === headKey || k.startsWith(generations) || k.startsWith(overlays)).map(k => [k, raw.getItem(k)]));
    },
    listGenerations() {
      resolve(); let active;
      try { active = head(); } catch { /* still list raw archives when the head itself is damaged */ }
      return rawKeys().filter(k => k.startsWith(generations)).map(k => {
        const id = k.slice(generations.length), flags = { id, active: id === active, captured: id === captured };
        try { return { ...flags, parent: readGeneration(id).parent }; } catch { return { ...flags, error: 'restore_invalid' }; }
      });
    },
    generationSnapshot(id) { resolve(); return new Map(snapshot(id)); },
    getItem(k) { resolve(); k = String(k); return k.startsWith(prefix) ? snapshot(captured).get(k) ?? null : raw.getItem(k); },
    setItem(k, v) { change(k, String(v)); },
    removeItem(k) { change(k, null); },
    key(i) { i = Number(i); return Number.isInteger(i) && i >= 0 ? logicalKeys()[i] ?? null : null; },
    get length() { return logicalKeys().length; },
  };
}
