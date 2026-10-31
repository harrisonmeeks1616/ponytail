// D1-compatible adapter over the official SQLite WebAssembly build, for the in-browser preview only.
// Same surface as tests/helpers/d1.mjs (which the unit tests use): prepare(sql).bind(...).first()/all()/
// run()/raw(), batch([...]) as one transaction, exec(sql). Production uses Cloudflare D1, never this file.

const WRITE_RE = /^\s*(?:with\b[\s\S]*?\)\s*)?(insert|update|delete|replace)\b/i;

function normaliseValue(v, index) {
  if (v === undefined) throw new TypeError(`D1_TYPE_ERROR: Type 'undefined' not supported for value at index ${index}`);
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  throw new TypeError(`D1_TYPE_ERROR: Type '${typeof v}' not supported for value at index ${index}`);
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
    const results = [];
    const stmt = raw.prepare(this._sql);
    try {
      if (this._params.length) stmt.bind(this._params);
      while (stmt.step()) results.push(stmt.get({}));
    } finally {
      stmt.finalize();
    }
    const isWrite = WRITE_RE.test(this._sql);
    const changes = isWrite ? raw.changes() : 0;
    const lastRowId = isWrite ? Number(raw.selectValue('SELECT last_insert_rowid()')) : null;
    if (isWrite) this._adapter.dirty = true;
    return { success: true, results, meta: { changes, last_row_id: lastRowId, changed_db: isWrite && changes > 0, duration: 0 } };
  }

  async first(column) {
    const row = this._execute().results[0];
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

export class D1Wasm {
  constructor(rawDb) {
    this._raw = rawDb;
    this.dirty = false;
  }

  prepare(sql) {
    if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('prepare() needs SQL text');
    return new Statement(this, sql);
  }

  async batch(statements) {
    if (!Array.isArray(statements)) throw new TypeError('batch() needs an array of statements');
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
    this.dirty = true;
    return { count: 1, duration: 0 };
  }
}
