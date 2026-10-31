// Export and restore of the Slice 2/3 feature tables (drafts, calendar, PM, weekly reviews), A20.
// db.exportData/restoreData own the core tables; the export and restore routes merge this module's tables
// into the same document. Same rules: scope-filtered, insert-only (never overwrites), tombstone-aware
// (a draft or weekly selection that cites a deleted capture/item is not brought back), rows outside the
// requested scope or linked across scopes are rejected. The calendar feed URL is a server-only secret and
// is never exported; a restored link-based calendar is marked "link not restored" until the link is re-added.
//
// ponytail: deleting a draft, calendar connection or PM source leaves no tombstone (only captures and items
// do), so restoring an older export re-adds one deleted afterwards. Upgrade path: id-only tombstones in kv.

const COLS = {
  drafts: ['id', 'scope', 'kind', 'title', 'recipient_label', 'project_name', 'facts', 'source_refs', 'source_text', 'body', 'generated_by', 'flags', 'state', 'created_at', 'updated_at', 'sample'],
  calendar_connections: ['id', 'scope', 'label', 'kind', 'host', 'state', 'last_fetch_at', 'last_ok_at', 'last_error_code', 'last_status', 'event_count', 'unsupported_count', 'truncated', 'sample', 'created_at'],
  calendar_events: ['id', 'connection_id', 'scope', 'title', 'location', 'start_at', 'end_at', 'start_on', 'end_on', 'all_day', 'time_zone', 'busy_only', 'shows_as', 'start_ms', 'end_ms', 'sample', 'fetched_at'],
  pm_sources: ['id', 'scope', 'label', 'kind', 'system', 'base_url', 'state', 'last_import_at', 'last_attempt_at', 'exported_at', 'last_error_code', 'last_changes', 'sample', 'created_at'],
  pm_records: ['id', 'source_id', 'scope', 'provider_id', 'kind', 'parent_provider_id', 'title', 'status', 'due_on', 'owner_label', 'url', 'updated_at', 'milestone_title', 'milestone_due_on', 'imported_at', 'sample'],
  weekly_reviews: ['id', 'scope', 'week_of', 'opened_at', 'completed_at', 'selections', 'deferrals', 'sample'],
};
export const FEATURE_TABLES = Object.keys(COLS); // parents first: restore order

const scopesFor = (scope) => (scope === 'all' ? ['work', 'personal'] : [scope]);
const marks = (n) => Array(n).fill('?').join(', ');
const parse = (s, fallback) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

export async function exportFeatures(d1, scope) {
  const scopes = scopesFor(scope);
  const out = {};
  for (const t of FEATURE_TABLES) {
    const res = await d1.prepare(`SELECT ${COLS[t].join(', ')} FROM ${t} WHERE scope IN (${marks(scopes.length)}) ORDER BY rowid`).bind(...scopes).all();
    out[t] = res.results || [];
  }
  return out;
}

export async function restoreFeatures(d1, data, scope) {
  const scopes = scopesFor(scope);
  const tables = data && typeof data === 'object' && data.tables && typeof data.tables === 'object' ? data.tables : {};
  const out = { inserted: {}, skipped_existing: 0, skipped_deleted: 0, rejected: 0 };
  const tomb = new Set(((await d1.prepare("SELECT key FROM kv WHERE key LIKE 'deleted_%'").all()).results || []).map((r) => r.key));
  const deletedRef = (ref) =>
    typeof ref === 'string' && ((ref.startsWith('capture:') && tomb.has('deleted_capture:' + ref.slice(8))) || (ref.startsWith('item:') && tomb.has('deleted_item:' + ref.slice(5))));
  // id -> scope of connections and PM sources already present or restored by this call.
  const parents = { calendar_connections: new Map(), pm_sources: new Map() };
  for (const t of Object.keys(parents)) for (const r of (await d1.prepare(`SELECT id, scope FROM ${t}`).all()).results || []) parents[t].set(r.id, r.scope);

  const rules = {
    drafts: (r) => (parse(r.source_refs, []).some(deletedRef) ? ['deleted'] : ['ok', r]),
    calendar_connections: (r) =>
      // The feed link is never exported, so a link-based calendar comes back honestly unfetchable.
      ['ok', r.kind === 'ics_url' ? { ...r, state: 'error', last_error_code: 'link_not_restored', last_status: null } : r],
    calendar_events: (r) => (parents.calendar_connections.get(r.connection_id) === r.scope ? ['ok', r] : ['rejected']),
    pm_sources: (r) => ['ok', r],
    pm_records: (r) => (parents.pm_sources.get(r.source_id) === r.scope ? ['ok', r] : ['rejected']),
    weekly_reviews: (r) => {
      const sel = parse(r.selections, []).filter((x) => !deletedRef(x));
      const def = parse(r.deferrals, []).filter((x) => !deletedRef(x && x.ref));
      return ['ok', { ...r, selections: JSON.stringify(sel), deferrals: JSON.stringify(def) }];
    },
  };

  for (const t of FEATURE_TABLES) {
    const rows = tables[t];
    if (rows == null) continue;
    if (!Array.isArray(rows)) {
      out.rejected++;
      continue;
    }
    const have = new Set(((await d1.prepare(`SELECT id FROM ${t}`).all()).results || []).map((x) => String(x.id)));
    const cols = COLS[t];
    const statements = [];
    const kept = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !scopes.includes(r.scope)) {
        out.rejected++;
        continue;
      }
      if (have.has(r.id)) {
        out.skipped_existing++;
        continue;
      }
      const [verdict, row] = rules[t](r);
      if (verdict !== 'ok') {
        out[verdict === 'deleted' ? 'skipped_deleted' : 'rejected']++;
        continue;
      }
      const values = cols.map((c) => (row[c] === undefined ? null : row[c]));
      if (values.some((v) => v !== null && typeof v === 'object')) {
        out.rejected++;
        continue;
      }
      statements.push(d1.prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(', ')}) VALUES (${marks(cols.length)})`).bind(...values));
      kept.push(row);
    }
    // A row the schema refuses fails the whole batch: retry one by one so one bad row costs only itself.
    let results;
    try {
      results = statements.length ? await d1.batch(statements) : [];
    } catch {
      results = [];
      for (const st of statements) results.push(await st.run().catch(() => null));
    }
    let n = 0;
    results.forEach((res, i) => {
      if (res === null) out.rejected++;
      else if (res.meta && Number(res.meta.changes) === 1) {
        n++;
        if (parents[t]) parents[t].set(kept[i].id, kept[i].scope);
      } else out.skipped_existing++;
    });
    if (n) out.inserted[t] = n;
  }
  return out;
}
