// A cheap, owner-only change hint. The version changes in the SAME transaction as content.
// Do not use SQL triggers: D1 includes trigger writes in meta.changes, which would break
// existing optimistic-write guards. Append the version write after the complete batch and
// return every original statement's result unchanged, including its changes()/RETURNING data.
import { json, queryScope } from './http.js';

export const CONTENT_TABLES = Object.freeze([
  'captures', 'proposals', 'items', 'projects', 'checkpoints', 'reminders',
  'attachments', 'preferences', 'drafts', 'calendar_connections', 'calendar_events',
  'pm_sources', 'pm_records', 'weekly_reviews',
]);
const content = new Set(CONTENT_TABLES);
const statements = new WeakMap();
const tracked = new WeakSet();
const BUMP = 'UPDATE sync_state SET version = lower(hex(randomblob(16))) WHERE id = 1';

export function contentMutation(sql) {
  const clean = String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim();
  const hit = /^(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`\[]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(clean);
  return !!hit && content.has(hit[1].toLowerCase());
}

export function withSyncState(database) {
  if (tracked.has(database)) return database;
  function wrap(raw, writes) {
    const execute = async () => writes
      ? (await database.batch([raw, database.prepare(BUMP + ' AND changes() > 0')]))[0]
      : raw.all();
    const statement = {
      bind(...values) { return wrap(raw.bind(...values), writes); },
      run() { return writes ? execute() : raw.run(); },
      all() { return writes ? execute() : raw.all(); },
      async first(column) {
        if (!writes) return raw.first(column);
        const row = (await execute()).results?.[0];
        if (!row) return null;
        if (column === undefined) return row;
        if (!(column in row)) throw new Error('D1_COLUMN_NOTFOUND: Column not found');
        return row[column];
      },
      async raw(options) {
        if (!writes) return raw.raw(options);
        const rows = (await execute()).results || [];
        const values = rows.map((row) => Object.values(row));
        return options?.columnNames && rows.length ? [Object.keys(rows[0]), ...values] : values;
      },
    };
    statements.set(statement, { raw, writes });
    return statement;
  }
  const view = {
    prepare(sql) { return wrap(database.prepare(sql), contentMutation(sql)); },
    async batch(batch) {
      const entries = batch.map((statement) => statements.get(statement) || { raw: statement, writes: false });
      const raw = entries.map((entry) => entry.raw);
      const changed = entries.some((entry) => entry.writes);
      // ponytail: an attempted multi-statement content batch can advance the hint on a
      // no-op. That costs one harmless refresh; inspecting results after commit would
      // lose the atomic guarantee. Single-statement no-ops do not advance it.
      if (changed) raw.push(database.prepare(BUMP));
      const results = await database.batch(raw);
      return changed ? results.slice(0, -1) : results;
    },
    exec(sql) {
      // Runtime content writes use prepared statements/batches. Refuse an escape hatch
      // rather than silently accepting an untracked multi-statement content mutation.
      if (String(sql).split(';').some(contentMutation)) throw new Error('Use prepared content statements for sync tracking');
      return database.exec(sql);
    },
  };
  tracked.add(view);
  return view;
}

async function getVersion(ctx) {
  queryScope(ctx, { allowAll: true });
  const row = await ctx.env.DB.prepare('SELECT version FROM sync_state WHERE id = 1').first();
  return json(200, { version: row.version });
}

export const ROUTES = [['GET', /^\/api\/sync$/, getVersion]];
