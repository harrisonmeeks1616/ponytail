// D1-compatible wrapper around node:sqlite DatabaseSync, for unit tests in Node 22.
// Offers exactly the calls production code uses on Cloudflare D1:
//   db.prepare(sql).bind(...values).first(column?) / .all() / .run()
//   db.batch([statements])   (atomic: one transaction, all or nothing)
//   db.exec(sql)             (multi-statement, used here only to apply migrations)
// Binding rules follow D1: undefined throws, booleans become 1/0, plain objects are rejected.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const WRITE_RE = /^\s*(?:with\b[\s\S]*?\)\s*)?(insert|update|delete|replace)\b/i;

function normaliseValue(v, index) {
  if (v === undefined) {
    throw new TypeError(`D1_TYPE_ERROR: Type 'undefined' not supported for value at index ${index}`);
  }
  if (v === null) return null;
  // node:sqlite binds every JS number as REAL; D1 stores whole numbers and booleans as INTEGER.
  if (typeof v === 'boolean') return v ? 1n : 0n;
  if (typeof v === 'number') return Number.isSafeInteger(v) ? BigInt(v) : v;
  if (typeof v === 'string' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  throw new TypeError(`D1_TYPE_ERROR: Type '${typeof v}' not supported for value at index ${index}`);
}

function plainRow(row) {
  if (row == null) return null;
  const out = {};
  for (const k of Object.keys(row)) out[k] = row[k];
  return out;
}

class Statement {
  constructor(adapter, sql, params = []) {
    this._adapter = adapter;
    this._sql = sql;
    this._params = params;
  }

  bind(...values) {
    return new Statement(this._adapter, this._sql, values.map(normaliseValue));
  }

  _execute() {
    const raw = this._adapter._raw;
    const stmt = raw.prepare(this._sql);
    const isWrite = WRITE_RE.test(this._sql);
    const returnsRows = stmt.columns().length > 0;
    let results = [];
    let changes = 0;
    let lastRowId = null;
    if (returnsRows) {
      results = stmt.all(...this._params).map(plainRow);
      if (isWrite) {
        changes = Number(raw.prepare('SELECT changes() AS c').get().c);
        lastRowId = Number(raw.prepare('SELECT last_insert_rowid() AS r').get().r);
      }
    } else {
      const r = stmt.run(...this._params);
      changes = Number(r.changes);
      lastRowId = Number(r.lastInsertRowid);
    }
    this._adapter.statementsRun++;
    return {
      success: true,
      results,
      meta: { changes, last_row_id: lastRowId, changed_db: isWrite && changes > 0, duration: 0 },
    };
  }

  async first(column) {
    const res = this._execute();
    const row = res.results[0];
    if (!row) return null;
    if (column !== undefined) {
      if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
      return row[column];
    }
    return row;
  }

  async all() {
    return this._execute();
  }

  async run() {
    return this._execute();
  }

  async raw() {
    return this._execute().results.map((r) => Object.values(r));
  }
}

export class D1Adapter {
  constructor(path = ':memory:') {
    this._raw = new DatabaseSync(path);
    this.statementsRun = 0;
  }

  prepare(sql) {
    if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('prepare() needs SQL text');
    return new Statement(this, sql);
  }

  async batch(statements) {
    if (!Array.isArray(statements)) throw new TypeError('batch() needs an array of statements');
    for (const s of statements) {
      if (!(s instanceof Statement)) throw new TypeError('batch() items must be prepared statements');
    }
    this._raw.exec('BEGIN');
    try {
      const out = statements.map((s) => s._execute());
      this._raw.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this._raw.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      throw err;
    }
  }

  async exec(sql) {
    this._raw.exec(sql);
    return { count: 1, duration: 0 };
  }

  close() {
    this._raw.close();
  }
}

/** Fresh in-memory database with every migration in migrations/ applied in name order. */
export function createTestDb() {
  const db = new D1Adapter(':memory:');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) db._raw.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  return db;
}
