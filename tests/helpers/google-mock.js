'use strict';
// An in-memory fake of exactly the Google services docs/schwab/hub/Code.gs uses, plus a loader that runs Code.gs in a
// node vm context. It is strict on purpose: request shapes the real Sheets API would refuse (unknown fields, wrong
// types, ranges outside the grid, a missing valueInputOption) throw here, so a wrong call fails a test instead of
// passing silently. It cannot prove Google's behavior; it only keeps the code honest about the documented shapes.
//
//   const { createHub } = require('./helpers/google-mock');
//   const hub = createHub({ now: Date.parse('2026-10-19T12:00:00-04:00') });
//   const keys = hub.setup();                      // runs setupHub(), reads the three keys from the execution log
//   hub.call(keys.pm, 'whoami')                    // one doPost in a fresh vm context (like a fresh execution)
//
// Run under TZ=America/New_York: the hours math depends on the zone and createHub refuses to run in another one.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const CODE_PATH = process.env.HUB_CODE_PATH || path.join(__dirname, '..', '..', 'docs', 'schwab', 'hub', 'Code.gs'); // the override is for mutation runs

// ---------- request validation ----------
function apiError(method, detail) {
  const e = new Error('GoogleJsonResponseException: API call to ' + method + ' failed with error: ' + detail);
  e.name = 'GoogleJsonResponseException';
  return e;
}
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const S = {
  str: { t: 'string' }, int: { t: 'int' }, bool: { t: 'bool' }, num: { t: 'number' },
  enum: (...v) => ({ t: 'enum', v }),
  arr: s => ({ t: 'array', s }),
  obj: (f, req = []) => ({ t: 'object', f, req }),
  cell: { t: 'cell' },
};
function check(method, v, s, where) {
  const bad = what => { throw apiError(method, `Invalid value at '${where}': ${what}`); };
  switch (s.t) {
    case 'string': if (typeof v !== 'string') bad('expected a string'); return;
    case 'int': if (!Number.isInteger(v)) bad('expected an integer'); return;
    case 'number': if (typeof v !== 'number' || !Number.isFinite(v)) bad('expected a number'); return;
    case 'bool': if (typeof v !== 'boolean') bad('expected a boolean'); return;
    case 'enum': if (!s.v.includes(v)) bad(`expected one of ${s.v.join(', ')}`); return;
    case 'cell': if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) bad('a cell must be a string, number, boolean or null'); return;
    case 'array': if (!Array.isArray(v)) bad('expected an array'); v.forEach((x, i) => check(method, x, s.s, `${where}[${i}]`)); return;
    case 'object':
      if (!isObj(v)) bad('expected an object');
      for (const k of Object.keys(v)) {
        if (!(k in s.f)) throw apiError(method, `Invalid JSON payload received. Unknown name "${k}" at '${where}': Cannot find field.`);
        if (v[k] === undefined) continue;
        check(method, v[k], s.f[k], `${where}.${k}`);
      }
      for (const k of s.req) if (v[k] === undefined) throw apiError(method, `Invalid value at '${where}': missing required field ${k}`);
  }
}
// A field mask ("userEnteredFormat.textFormat.bold", "gridProperties.frozenRowCount") must name fields of the schema.
function checkMask(method, mask, s, where) {
  if (typeof mask !== 'string' || !mask) throw apiError(method, `Invalid value at '${where}': at least one field must be listed`);
  for (const path of mask.split(',')) {
    let cur = s;
    for (const part of path === '*' ? [] : path.split('.')) {
      if (cur.t !== 'object' || !(part in cur.f)) throw apiError(method, `Invalid value at '${where}': unknown field "${path}"`);
      cur = cur.f[part];
    }
  }
}
const inMask = (mask, path) => mask.split(',').some(m => m === '*' || path === m || path.startsWith(m + '.'));

const GRID_PROPS = S.obj({ rowCount: S.int, columnCount: S.int, frozenRowCount: S.int, frozenColumnCount: S.int, hideGridlines: S.bool });
const SHEET_PROPS = S.obj({ sheetId: S.int, title: S.str, index: S.int, sheetType: S.enum('GRID'), gridProperties: GRID_PROPS, hidden: S.bool });
const GRID_RANGE = S.obj({ sheetId: S.int, startRowIndex: S.int, endRowIndex: S.int, startColumnIndex: S.int, endColumnIndex: S.int }, ['sheetId']);
const DIM_RANGE = S.obj({ sheetId: S.int, dimension: S.enum('ROWS', 'COLUMNS'), startIndex: S.int, endIndex: S.int }, ['sheetId', 'dimension']);
const CELL_DATA = S.obj({
  userEnteredValue: S.obj({ stringValue: S.str, numberValue: S.num, boolValue: S.bool }),
  userEnteredFormat: S.obj({
    textFormat: S.obj({ bold: S.bool, italic: S.bool, fontSize: S.int }),
    wrapStrategy: S.enum('OVERFLOW_CELL', 'LEGACY_WRAP', 'CLIP', 'WRAP'),
    horizontalAlignment: S.enum('LEFT', 'CENTER', 'RIGHT'),
  }),
});
const DIM_PROPS = S.obj({ pixelSize: S.int, hiddenByUser: S.bool });
const REQUESTS = {
  addSheet: S.obj({ properties: SHEET_PROPS }),
  updateSheetProperties: S.obj({ properties: SHEET_PROPS, fields: S.str }, ['properties', 'fields']),
  repeatCell: S.obj({ range: GRID_RANGE, cell: CELL_DATA, fields: S.str }, ['range', 'cell', 'fields']),
  updateDimensionProperties: S.obj({ range: DIM_RANGE, properties: DIM_PROPS, fields: S.str }, ['range', 'properties', 'fields']),
  deleteDimension: S.obj({ range: DIM_RANGE }, ['range']),
  appendDimension: S.obj({ sheetId: S.int, dimension: S.enum('ROWS', 'COLUMNS'), length: S.int }, ['sheetId', 'dimension', 'length']),
  updateCells: S.obj({ start: S.obj({ sheetId: S.int, rowIndex: S.int, columnIndex: S.int }, ['sheetId']), rows: S.arr(S.obj({ values: S.arr(CELL_DATA) })), fields: S.str }, ['start', 'rows', 'fields']),
  appendCells: S.obj({ sheetId: S.int, rows: S.arr(S.obj({ values: S.arr(CELL_DATA) })), fields: S.str }, ['sheetId', 'rows', 'fields']),
};
const SPREADSHEET = S.obj({ properties: S.obj({ title: S.str, locale: S.str, timeZone: S.str }), sheets: S.arr(S.obj({ properties: SHEET_PROPS })) });
const BATCH_BODY = S.obj({ requests: S.arr({ t: 'request' }), includeSpreadsheetInResponse: S.bool, responseRanges: S.arr(S.str), responseIncludeGridData: S.bool }, ['requests']);
const VALUE_RANGE = S.obj({ range: S.str, majorDimension: S.enum('ROWS', 'COLUMNS'), values: S.arr(S.arr(S.cell)) });
const INPUT = S.enum('RAW', 'USER_ENTERED');
const RENDER = S.enum('FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA');
const DATE_RENDER = S.enum('SERIAL_NUMBER', 'FORMATTED_STRING');
const BATCH_VALUES_BODY = S.obj({ valueInputOption: INPUT, data: S.arr(VALUE_RANGE), includeValuesInResponse: S.bool, responseValueRenderOption: RENDER, responseDateTimeRenderOption: DATE_RENDER }, ['valueInputOption', 'data']);
const GET_OPTS = S.obj({ majorDimension: S.enum('ROWS', 'COLUMNS'), valueRenderOption: RENDER, dateTimeRenderOption: DATE_RENDER });
const SHEET_FIELDS = { spreadsheetId: 1, spreadsheetUrl: 1, properties: { title: 1, locale: 1, timeZone: 1 }, sheets: { properties: { sheetId: 1, title: 1, index: 1, sheetType: 1, gridProperties: { rowCount: 1, columnCount: 1, frozenRowCount: 1, frozenColumnCount: 1 }, hidden: 1 }, data: 1 } };

// Copy a request argument, rejecting what JSON could not carry the way Apps Script serializes it.
function plain(v, where = 'argument') {
  if (v === null || ['string', 'boolean'].includes(typeof v)) return v;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`MOCK: ${where} is not a finite number`); return v; }
  if (Array.isArray(v)) return v.map((x, i) => { if (x === undefined) throw new Error(`MOCK: ${where}[${i}] is undefined`); return plain(x, `${where}[${i}]`); });
  if (typeof v === 'object' && v) {
    const out = {};
    for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = plain(v[k], `${where}.${k}`);
    return out;
  }
  throw new Error(`MOCK: ${where} has an unsupported type (${typeof v})`);
}
function arity(method, a, spec) { // spec: 'o' object, 's' string, 'o?' optional object
  const need = spec.filter(x => !x.endsWith('?')).length;
  if (a.length < need || a.length > spec.length) throw apiError(method, `wrong number of arguments (${a.length}) for ${spec.join(', ')}`);
  spec.forEach((t, i) => {
    if (a[i] === undefined && t.endsWith('?')) return;
    if (t[0] === 'o' && !isObj(a[i])) throw apiError(method, `argument ${i + 1} must be an object`);
    if (t[0] === 's' && typeof a[i] !== 'string') throw apiError(method, `argument ${i + 1} must be a string`);
  });
}

// ---------- A1 ranges and the sheet grid ----------
const colNum = s => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const colName = i => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
function parseA1(method, ss, spec) {
  const m = /^(?:('(?:[^']|'')+'|[^!']+)!)?(.*)$/.exec(spec);
  const name = m[1] ? (m[1][0] === "'" ? m[1].slice(1, -1).replace(/''/g, "'") : m[1]) : null;
  const sheet = name === null ? ss.sheets[0] : ss.sheets.find(s => s.title === name);
  if (!sheet) throw apiError(method, `Unable to parse range: ${spec}`);
  const part = p => { const x = /^([A-Z]+)?(\d+)?$/.exec(p); if (!x || (!x[1] && !x[2])) throw apiError(method, `Unable to parse range: ${spec}`); return { c: x[1] ? colNum(x[1]) : null, r: x[2] ? +x[2] - 1 : null }; };
  let r0 = 0, c0 = 0, r1 = null, c1 = null, single = false;
  if (m[2]) {
    const [a, b] = m[2].split(':');
    single = b === undefined; // "A5" names where to start; "A5:A5" is a one-cell range the values must fit
    const p = part(a), q = b === undefined ? p : part(b);
    r0 = p.r ?? 0; c0 = p.c ?? 0; r1 = q.r; c1 = q.c;
    if (b === undefined) { r1 = p.r; c1 = p.c; }
    if ((r1 !== null && r1 < r0) || (c1 !== null && c1 < c0)) throw apiError(method, `Unable to parse range: ${spec}`);
  }
  return { sheet, r0, c0, r1, c1, single };
}
const quoteName = t => (/^[A-Za-z0-9_]+$/.test(t) ? t : `'${t.replace(/'/g, "''")}'`);
const a1Of = (sheet, r0, c0, r1, c1) => `${quoteName(sheet.title)}!${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`;
function gridCheck(method, rg, spec) { // a range the grid cannot hold is an error, as in the real API
  const { sheet, r0, c0, r1, c1 } = rg;
  if (r0 >= sheet.rowCount || c0 >= sheet.columnCount || (r1 !== null && r1 >= sheet.rowCount) || (c1 !== null && c1 >= sheet.columnCount)) {
    throw apiError(method, `Range (${spec}) exceeds grid limits. Max rows: ${sheet.rowCount}, max columns: ${sheet.columnCount}`);
  }
}

function newSheet(id, title, index, g = {}) {
  return { sheetId: id, title, index, rowCount: g.rowCount ?? 1000, columnCount: g.columnCount ?? 26, frozenRowCount: g.frozenRowCount ?? 0, frozenColumnCount: g.frozenColumnCount ?? 0, rows: [], widths: {}, formats: [] };
}
const lastRow = sheet => { for (let r = sheet.rows.length - 1; r >= 0; r--) if (sheet.rows[r] && sheet.rows[r].some(c => c !== undefined)) return r; return -1; };
const sheetProps = s => ({ sheetId: s.sheetId, title: s.title, index: s.index, sheetType: 'GRID', gridProperties: { rowCount: s.rowCount, columnCount: s.columnCount, ...(s.frozenRowCount ? { frozenRowCount: s.frozenRowCount } : {}), ...(s.frozenColumnCount ? { frozenColumnCount: s.frozenColumnCount } : {}) } });

function parseEntered(v) { // USER_ENTERED: what a person typing into the cell would get
  if (typeof v !== 'string') return v;
  if (v.startsWith('=')) return { formula: v };
  if (/^[-+]?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^(TRUE|FALSE)$/i.test(v)) return v.toUpperCase() === 'TRUE';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(v) || /^\d{1,2}:\d{2}(:\d{2})?$/.test(v)) return { parsedAs: 'date', text: v };
  return v;
}
function writeCells(method, sheet, r0, c0, values, input, spec) {
  const rowsN = values.length, colsN = Math.max(0, ...values.map(r => r.length));
  if (r0 + rowsN > sheet.rowCount || c0 + colsN > sheet.columnCount) {
    throw apiError(method, `Range (${spec}) exceeds grid limits. Max rows: ${sheet.rowCount}, max columns: ${sheet.columnCount}`);
  }
  for (const row of values) for (const v of row) {
    if (typeof v === 'string' && v.length > 50000) throw apiError(method, 'Your input contains more than the maximum of 50000 characters in a single cell.');
  }
  values.forEach((row, i) => row.forEach((v, j) => {
    if (v === null) return; // null leaves the cell alone
    const r = r0 + i, c = c0 + j;
    sheet.rows[r] = sheet.rows[r] || [];
    if (v === '') delete sheet.rows[r][c]; else sheet.rows[r][c] = input === 'RAW' ? v : parseEntered(v);
  }));
  return { updatedRows: rowsN, updatedColumns: colsN, updatedCells: values.reduce((n, r) => n + r.length, 0) };
}
function renderCell(v, how) {
  if (v === undefined) return '';
  const formula = isObj(v) && 'formula' in v, dated = isObj(v) && v.parsedAs === 'date';
  if (how === 'FORMULA') return formula ? v.formula : dated ? v.text : v;
  if (formula) return '#NAME?';
  if (dated) return how === 'UNFORMATTED_VALUE' ? 46000 : v.text;
  if (how === 'UNFORMATTED_VALUE') return v;
  return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v); // FORMATTED_VALUE: everything comes back as text
}
function readCells(sheet, rg, how) {
  const last = lastRow(sheet), r1 = Math.min(rg.r1 ?? sheet.rowCount - 1, last), c1 = rg.c1 ?? sheet.columnCount - 1, out = [];
  for (let r = rg.r0; r <= r1; r++) {
    const row = [];
    for (let c = rg.c0; c <= c1; c++) row.push(renderCell((sheet.rows[r] || [])[c], how));
    while (row.length && row[row.length - 1] === '') row.pop(); // trailing empty cells are dropped, like the real API
    out.push(row);
  }
  while (out.length && !out[out.length - 1].length) out.pop();
  return { values: out };
}
function applyMask(obj, tree) {
  if (Array.isArray(obj)) return obj.map(x => applyMask(x, tree));
  if (tree === 1 || !isObj(obj)) return obj;
  const out = {};
  for (const k of Object.keys(tree)) if (k in obj) out[k] = applyMask(obj[k], tree[k]);
  return out;
}
function parseFields(method, s) {
  let i = 0;
  const name = () => { const m = /^[A-Za-z_]+/.exec(s.slice(i)); if (!m) throw apiError(method, `Invalid field selection at ${i}`); i += m[0].length; return m[0]; };
  const merge = (a, b) => { for (const k of Object.keys(b)) a[k] = a[k] && a[k] !== 1 && b[k] !== 1 ? merge(a[k], b[k]) : b[k]; return a; };
  const item = () => { const n = name(); if (s[i] === '.') { i++; return { [n]: item() }; } if (s[i] === '(') { i++; const l = list(); if (s[i++] !== ')') throw apiError(method, 'Invalid field selection'); return { [n]: l }; } return { [n]: 1 }; };
  const list = () => { let t = merge({}, item()); while (s[i] === ',') { i++; t = merge(t, item()); } return t; };
  const t = list();
  if (i !== s.length) throw apiError(method, 'Invalid field selection');
  const walk = (tree, allowed, p) => Object.keys(tree).forEach(k => {
    if (!(k in allowed)) throw apiError(method, `Invalid field selection ${p}${k}`);
    if (tree[k] !== 1 && allowed[k] !== 1) walk(tree[k], allowed[k], p + k + '.');
  });
  walk(t, SHEET_FIELDS, '');
  return t;
}

// ---------- the Sheets advanced service ----------
function makeSheets(hub) {
  const found = (method, id) => {
    const ss = hub.spreadsheets.get(id);
    if (!ss) throw apiError(method, 'Requested entity was not found.');
    return ss;
  };
  const note = (method, write) => { hub.calls.push(method); if (write) hub.assertLocked(method); hub.maybeFail(method); };
  const respSpreadsheet = ss => ({ spreadsheetId: ss.id, properties: { title: ss.title, locale: 'en_US', timeZone: ss.timeZone }, sheets: ss.sheets.map(s => ({ properties: sheetProps(s) })), spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ss.id}/edit` });
  const cellsTotal = ss => ss.sheets.reduce((n, s) => n + s.rowCount * s.columnCount, 0);
  const capCells = (method, ss) => { if (cellsTotal(ss) > 10000000) throw apiError(method, 'This action would increase the number of cells in the workbook above the limit of 10000000 cells.'); };
  const uniqueTitle = (method, ss, title, except) => { if (ss.sheets.some(s => s.title === title && s !== except)) throw apiError(method, `A sheet with the name "${title}" already exists. Please enter another name.`); };
  const nextSheetId = ss => { ss.seq = (ss.seq || 0) + 1; return 100000 + ss.seq * 7919; };

  function create(...a) {
    arity('sheets.spreadsheets.create', a, ['o']);
    const m = 'sheets.spreadsheets.create';
    note(m, true);
    const body = plain(a[0]);
    check(m, body, SPREADSHEET, 'spreadsheet');
    const id = 'SS' + crypto.randomBytes(8).toString('hex');
    const ss = { id, title: (body.properties && body.properties.title) || 'Untitled spreadsheet', timeZone: (body.properties && body.properties.timeZone) || 'Etc/GMT', sheets: [], seq: 0 };
    const defs = (body.sheets && body.sheets.length ? body.sheets : [{ properties: { title: 'Sheet1' } }]);
    defs.forEach((d, i) => {
      const p = d.properties || {};
      const title = p.title || `Sheet${i + 1}`;
      uniqueTitle(m, ss, title);
      ss.sheets.push(newSheet(p.sheetId ?? nextSheetId(ss), title, i, p.gridProperties));
    });
    capCells(m, ss);
    hub.spreadsheets.set(id, ss);
    hub.maybeFail(m + ':after');
    return respSpreadsheet(ss);
  }
  function get(...a) {
    arity('sheets.spreadsheets.get', a, ['s', 'o?']);
    const m = 'sheets.spreadsheets.get';
    note(m, false);
    const opts = a[1] === undefined ? {} : plain(a[1]);
    check(m, opts, S.obj({ fields: S.str, ranges: S.arr(S.str), includeGridData: S.bool }), 'params');
    const out = respSpreadsheet(found(m, a[0]));
    return opts.fields ? applyMask(out, parseFields(m, opts.fields)) : out;
  }
  function batchUpdate(...a) {
    const m = 'sheets.spreadsheets.batchUpdate';
    arity(m, a, ['o', 's']);
    note(m, true);
    const body = plain(a[0]);
    check(m, body, BATCH_BODY, 'body');
    const ss = found(m, a[1]);
    body.requests.forEach((r, i) => {
      const keys = Object.keys(r);
      if (keys.length !== 1) throw apiError(m, `Invalid value at 'requests[${i}]': exactly one request type must be set`);
      if (!(keys[0] in REQUESTS)) throw apiError(m, `Invalid JSON payload received. Unknown name "${keys[0]}" at 'requests[${i}]': Cannot find field.`);
      check(m, r[keys[0]], REQUESTS[keys[0]], `requests[${i}].${keys[0]}`);
    });
    const work = { ...ss, sheets: ss.sheets.map(s => ({ ...s, rows: s.rows.map(r => (r ? r.slice() : r)), widths: { ...s.widths }, formats: s.formats.slice() })) }; // atomic: all requests apply or none
    const byId = id => { const s = work.sheets.find(x => x.sheetId === id); if (!s) throw apiError(m, `No grid with id: ${id}`); return s; };
    const replies = body.requests.map((r, i) => {
      const [type] = Object.keys(r), q = r[type], where = `requests[${i}]`;
      if (type === 'addSheet') {
        const p = q.properties || {};
        uniqueTitle(m, work, p.title || `Sheet${work.sheets.length + 1}`);
        const s = newSheet(p.sheetId ?? nextSheetId(work), p.title || `Sheet${work.sheets.length + 1}`, work.sheets.length, p.gridProperties);
        work.sheets.push(s);
        return { addSheet: { properties: sheetProps(s) } };
      }
      if (type === 'updateSheetProperties') {
        checkMask(m, q.fields, SHEET_PROPS, `${where}.fields`);
        const s = byId(q.properties.sheetId), p = q.properties;
        if (p.title !== undefined && inMask(q.fields, 'title')) { uniqueTitle(m, work, p.title, s); s.title = p.title; }
        for (const k of ['rowCount', 'columnCount', 'frozenRowCount', 'frozenColumnCount']) if (p.gridProperties && p.gridProperties[k] !== undefined && inMask(q.fields, 'gridProperties.' + k)) s[k] = p.gridProperties[k];
        return {};
      }
      if (type === 'repeatCell') {
        checkMask(m, q.fields, CELL_DATA, `${where}.fields`);
        const s = byId(q.range.sheetId);
        s.formats.push({ range: q.range, cell: q.cell, fields: q.fields, applied: { bold: inMask(q.fields, 'userEnteredFormat.textFormat.bold') && !!(q.cell.userEnteredFormat && q.cell.userEnteredFormat.textFormat && q.cell.userEnteredFormat.textFormat.bold), wrap: inMask(q.fields, 'userEnteredFormat.wrapStrategy') ? q.cell.userEnteredFormat && q.cell.userEnteredFormat.wrapStrategy : undefined } });
        return {};
      }
      if (type === 'updateCells' || type === 'appendCells') {
        checkMask(m, q.fields, CELL_DATA, `${where}.fields`);
        const s = byId(type === 'appendCells' ? q.sheetId : q.start.sheetId);
        const r0 = type === 'appendCells' ? lastRow(s) + 1 : q.start.rowIndex || 0, c0 = type === 'appendCells' ? 0 : q.start.columnIndex || 0;
        const values = q.rows.map(r => r.values.map(c => {
          const v = c.userEnteredValue || {}, entries = Object.entries(v);
          if (entries.length !== 1) throw apiError(m, 'Exactly one entered value required');
          return entries[0][1];
        }));
        if (type === 'appendCells') s.rowCount = Math.max(s.rowCount, r0 + values.length);
        writeCells(m, s, r0, c0, values, 'RAW', type);
        return {};
      }
      if (type === 'updateDimensionProperties') {
        checkMask(m, q.fields, DIM_PROPS, `${where}.fields`);
        const s = byId(q.range.sheetId);
        if (q.range.dimension === 'COLUMNS' && inMask(q.fields, 'pixelSize')) for (let c = q.range.startIndex ?? 0; c < (q.range.endIndex ?? s.columnCount); c++) s.widths[c] = q.properties.pixelSize;
        return {};
      }
      if (type === 'deleteDimension') {
        const s = byId(q.range.sheetId), d = q.range;
        const size = d.dimension === 'ROWS' ? s.rowCount : s.columnCount, a0 = d.startIndex ?? 0, a1 = d.endIndex ?? size;
        if (a0 < 0 || a1 > size || a0 >= a1) throw apiError(m, `Invalid dimension range at ${where}`);
        if (d.dimension === 'ROWS') {
          if (a1 - a0 >= s.rowCount - s.frozenRowCount) throw apiError(m, "You can't delete all the non-frozen rows on the sheet.");
          s.rows.splice(a0, a1 - a0);
          s.rowCount -= a1 - a0;
        } else {
          s.rows.forEach(r => r && r.splice(a0, a1 - a0));
          s.columnCount -= a1 - a0;
        }
        return {};
      }
      const s = byId(q.sheetId); // appendDimension
      if (q.length < 1) throw apiError(m, `Invalid length at ${where}`);
      if (q.dimension === 'ROWS') s.rowCount += q.length; else s.columnCount += q.length;
      capCells(m, work);
      return {};
    });
    const was = new Map(ss.sheets.map(x => [x.sheetId, x])); // keep each sheet object, so a test holding one still sees the live grid
    Object.assign(ss, { sheets: work.sheets.map(w => (was.has(w.sheetId) ? Object.assign(was.get(w.sheetId), w) : w)), seq: work.seq });
    hub.maybeFail(m + ':after');
    return { spreadsheetId: ss.id, replies };
  }

  function valuesGet(...a) {
    const m = 'sheets.spreadsheets.values.get';
    arity(m, a, ['s', 's', 'o?']);
    note(m, false);
    const opts = a[2] === undefined ? {} : plain(a[2]);
    check(m, opts, GET_OPTS, 'params');
    const ss = found(m, a[0]), rg = parseA1(m, ss, a[1]);
    gridCheck(m, rg, a[1]);
    const r = readCells(rg.sheet, rg, opts.valueRenderOption || 'FORMATTED_VALUE');
    const out = { range: a1Of(rg.sheet, rg.r0, rg.c0, rg.r1 ?? rg.sheet.rowCount - 1, rg.c1 ?? rg.sheet.columnCount - 1), majorDimension: 'ROWS' };
    if (r.values.length) out.values = r.values;
    return out;
  }
  function valuesBatchGet(...a) {
    const m = 'sheets.spreadsheets.values.batchGet';
    arity(m, a, ['s', 'o?']);
    note(m, false);
    const opts = a[1] === undefined ? {} : plain(a[1]);
    check(m, opts, S.obj({ ranges: S.arr(S.str), majorDimension: S.enum('ROWS', 'COLUMNS'), valueRenderOption: RENDER, dateTimeRenderOption: DATE_RENDER }), 'params');
    const ss = found(m, a[0]);
    return { spreadsheetId: ss.id, valueRanges: (opts.ranges || []).map(spec => {
      const rg = parseA1(m, ss, spec);
      gridCheck(m, rg, spec);
      const r = readCells(rg.sheet, rg, opts.valueRenderOption || 'FORMATTED_VALUE');
      const out = { range: a1Of(rg.sheet, rg.r0, rg.c0, rg.r1 ?? rg.sheet.rowCount - 1, rg.c1 ?? rg.sheet.columnCount - 1), majorDimension: 'ROWS' };
      if (r.values.length) out.values = r.values;
      return out;
    }) };
  }
  function valuesUpdate(...a) {
    const m = 'sheets.spreadsheets.values.update';
    arity(m, a, ['o', 's', 's', 'o?']);
    note(m, true);
    const body = plain(a[0]), opts = a[3] === undefined ? {} : plain(a[3]);
    check(m, body, VALUE_RANGE, 'body');
    check(m, opts, S.obj({ valueInputOption: INPUT, includeValuesInResponse: S.bool, responseValueRenderOption: RENDER, responseDateTimeRenderOption: DATE_RENDER }, ['valueInputOption']), 'params');
    if (body.range !== undefined && body.range !== a[2]) throw apiError(m, 'Invalid value: the range in the body does not match the range in the request');
    if (!body.values) throw apiError(m, "Invalid value at 'values': missing");
    const ss = found(m, a[1]), rg = parseA1(m, ss, a[2]);
    gridCheck(m, rg, a[2]);
    const h = body.values.length, w = Math.max(0, ...body.values.map(r => r.length));
    if (!rg.single && ((rg.r1 !== null && h > rg.r1 - rg.r0 + 1) || (rg.c1 !== null && w > rg.c1 - rg.c0 + 1))) throw apiError(m, `Requested writing within range [${a[2]}], but tried writing to a larger range`);
    const done = writeCells(m, rg.sheet, rg.r0, rg.c0, body.values, opts.valueInputOption, a[2]);
    return { spreadsheetId: ss.id, updatedRange: a1Of(rg.sheet, rg.r0, rg.c0, rg.r0 + h - 1, rg.c0 + w - 1), ...done };
  }
  function valuesBatchUpdate(...a) {
    const m = 'sheets.spreadsheets.values.batchUpdate';
    arity(m, a, ['o', 's']);
    note(m, true);
    const body = plain(a[0]);
    check(m, body, BATCH_VALUES_BODY, 'body');
    const ss = found(m, a[1]);
    body.data.forEach((d, i) => {
      if (d.range === undefined || !d.values) throw apiError(m, `Invalid value at 'data[${i}]': range and values are required`);
      const rg = parseA1(m, ss, d.range);
      gridCheck(m, rg, d.range);
      const h = d.values.length, w = Math.max(0, ...d.values.map(r => r.length));
      if (!rg.single && ((rg.r1 !== null && h > rg.r1 - rg.r0 + 1) || (rg.c1 !== null && w > rg.c1 - rg.c0 + 1))) throw apiError(m, `Requested writing within range [${d.range}], but tried writing to a larger range`);
    });
    let cells = 0;
    body.data.forEach(d => { const rg = parseA1(m, ss, d.range); cells += writeCells(m, rg.sheet, rg.r0, rg.c0, d.values, body.valueInputOption, d.range).updatedCells; });
    return { spreadsheetId: ss.id, totalUpdatedCells: cells, responses: body.data.map(d => ({ spreadsheetId: ss.id, updatedRange: d.range })) };
  }
  function valuesAppend(...a) {
    const m = 'sheets.spreadsheets.values.append';
    arity(m, a, ['o', 's', 's', 'o?']);
    note(m, true);
    const body = plain(a[0]), opts = a[3] === undefined ? {} : plain(a[3]);
    check(m, body, VALUE_RANGE, 'body');
    check(m, opts, S.obj({ valueInputOption: INPUT, insertDataOption: S.enum('OVERWRITE', 'INSERT_ROWS'), includeValuesInResponse: S.bool, responseValueRenderOption: RENDER, responseDateTimeRenderOption: DATE_RENDER }, ['valueInputOption']), 'params');
    if (!body.values || !body.values.length) throw apiError(m, "Invalid value at 'values': missing");
    const ss = found(m, a[1]), rg = parseA1(m, ss, a[2]), s = rg.sheet;
    gridCheck(m, rg, a[2]);
    const at = lastRow(s) + 1, h = body.values.length, w = Math.max(0, ...body.values.map(r => r.length));
    if (opts.insertDataOption === 'INSERT_ROWS') { s.rows.splice(at, 0, ...Array.from({ length: h }, () => undefined)); s.rowCount += h; }
    else if (at + h > s.rowCount) s.rowCount = at + h;
    capCells(m, ss);
    const done = writeCells(m, s, at, rg.c0, body.values, opts.valueInputOption, a[2]);
    const upd = { spreadsheetId: ss.id, updatedRange: a1Of(s, at, rg.c0, at + h - 1, rg.c0 + w - 1), ...done };
    return { spreadsheetId: ss.id, tableRange: a1Of(s, 0, 0, Math.max(at - 1, 0), Math.max(0, ...s.rows.map(r => (r ? r.length : 0))) - 1), updates: upd };
  }
  function valuesClear(...a) {
    const m = 'sheets.spreadsheets.values.clear';
    arity(m, a, ['o', 's', 's']);
    note(m, true);
    check(m, plain(a[0]), S.obj({}), 'body');
    const ss = found(m, a[1]), rg = parseA1(m, ss, a[2]);
    gridCheck(m, rg, a[2]);
    const s = rg.sheet, r1 = Math.min(rg.r1 ?? s.rowCount - 1, s.rows.length - 1);
    for (let r = rg.r0; r <= r1; r++) if (s.rows[r]) for (let c = rg.c0; c <= (rg.c1 ?? s.columnCount - 1); c++) delete s.rows[r][c];
    return { spreadsheetId: ss.id, clearedRange: a1Of(s, rg.r0, rg.c0, rg.r1 ?? s.rowCount - 1, rg.c1 ?? s.columnCount - 1) };
  }
  return { Spreadsheets: { create, get, batchUpdate, Values: { get: valuesGet, batchGet: valuesBatchGet, update: valuesUpdate, batchUpdate: valuesBatchUpdate, append: valuesAppend, clear: valuesClear } } };
}

// ---------- LanguageApp: a small dictionary, en <-> es ----------
const EN_ES = {
  pull: 'jale', wire: 'cable', to: 'a', on: 'en', level: 'nivel', today: 'hoy', finish: 'termine', the: 'el', install: 'instale',
  conduit: 'conducto', room: 'cuarto', please: 'por favor', and: 'y', done: 'hecho', complete: 'completo', blocked: 'bloqueado',
  ladder: 'escalera', need: 'necesito', more: 'mas', material: 'material', for: 'para', in: 'en', of: 'de', with: 'con', at: 'en',
  is: 'es', are: 'son', check: 'revise', work: 'trabajo', finished: 'terminado', lift: 'elevador', call: 'llame', bring: 'traiga',
  tape: 'cinta', hello: 'hola', crew: 'cuadrilla', panel: 'tablero', ceiling: 'techo', box: 'caja', it: 'lo', that: 'eso',
  ok: 'bien', thanks: 'gracias', morning: 'manana', tomorrow: 'pasado', hold: 'espere', a: 'un',
};
const ES_EN = {};
for (const [en, es] of Object.entries(EN_ES)) if (!(es in ES_EN)) ES_EN[es] = en;
const WORD = /[A-Za-zÀ-ɏ]+/g;
function translateWords(text, dict) {
  return text.replace(WORD, w => {
    const t = Object.prototype.hasOwnProperty.call(dict, w.toLowerCase()) ? dict[w.toLowerCase()] : undefined;
    return t === undefined ? w : (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? t[0].toUpperCase() + t.slice(1) : t);
  });
}
// What an unprotected identifier can suffer: "E-301" loses its hyphen, "150 ft" becomes Spanish.
const damage = s => s.replace(/\b([A-Z]{1,4})-(\d+)/g, '$1 $2').replace(/\b(\d+) ?ft\b/g, '$1 pies');
const unescapeHtml = s => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, g) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[g]);
// Google returns HTML-escaped text, apostrophes included.
const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function fakeTranslate(hub, text, from, to, opts) {
  if (typeof text !== 'string' || !['en', 'es'].includes(from) || !['en', 'es'].includes(to)) throw new Error('Exception: Invalid argument: translate');
  if (opts !== undefined) {
    if (!isObj(opts) || Object.keys(opts).some(k => k !== 'contentType') || !['html', 'text'].includes(opts.contentType)) throw new Error('Exception: Invalid argument: options');
  }
  hub.translateLog.push({ text, from, to, opts: opts ? { ...opts } : undefined });
  if (hub.translateQuota !== Infinity && hub.translateLog.length > hub.translateQuota) throw new Error('Exception: Service invoked too many times for one day: LanguageApp.');
  if (hub.translateFail) throw new Error(hub.translateFail);
  const dict = from === 'en' ? EN_ES : ES_EN;
  if (!opts || opts.contentType !== 'html') return damage(translateWords(text, dict)); // plain text: tags are just characters, identifiers are fair game
  let depth = 0;
  return text.split(/(<[^>]+>)/).map(piece => {
    if (/^<[^>]+>$/.test(piece)) {
      if (/^<span\b[^>]*translate="no"/.test(piece)) depth++;
      else if (/^<span\b/.test(piece) && depth) depth++;
      else if (/^<\/span>/.test(piece) && depth) depth--;
      return piece;
    }
    return depth ? piece : escapeHtml(damage(translateWords(unescapeHtml(piece), dict)));
  }).join('');
}

// ---------- the hub: services + loader ----------
const DATE_SHIM = `(function (D, now) {
  class FakeDate extends D {
    constructor(...a) { if (a.length === 0) super(now()); else super(...a); }
    static now() { return now(); }
  }
  globalThis.Date = FakeDate;
})(Date, __now);`;

function createHub(opts = {}) {
  if (new Date(2026, 6, 1).getTimezoneOffset() !== 240 || new Date(2026, 0, 1).getTimezoneOffset() !== 300) {
    throw new Error('google-mock: run under TZ=America/New_York (the hub hours math depends on the job time zone)');
  }
  const source = opts.source || fs.readFileSync(CODE_PATH, 'utf8');
  const hub = {
    calls: [], logs: [], spreadsheets: new Map(), props: {}, cache: new Map(), translateLog: [],
    translateQuota: Infinity, translateFail: '', cacheBroken: false, locked: false, contended: false, allowUnlockedWrites: false, failures: [],
    clockOffset: 0, fixedNow: opts.now === undefined ? null : opts.now,
  };
  hub.now = () => (hub.fixedNow === null ? Date.now() + hub.clockOffset : hub.fixedNow);
  hub.setNow = ms => { hub.fixedNow = ms; };
  hub.advance = ms => { if (hub.fixedNow === null) hub.clockOffset += ms; else hub.fixedNow += ms; };
  hub.writes = 0; // writes seen, all of them under the lock or the fake would have thrown
  hub.assertLocked = what => { if (!hub.locked && !hub.allowUnlockedWrites) throw new Error(`MOCK: ${what} outside a LockService script lock`); hub.writes++; };
  hub.maybeFail = method => { const i = hub.failures.findIndex(f => f.method === method); if (i >= 0) { const f = hub.failures[i]; if (--f.times <= 0) hub.failures.splice(i, 1); throw new Error('Exception: ' + (f.message || 'Service error: Spreadsheets')); } };
  hub.failNext = (method, times = 1, message) => hub.failures.push({ method, times, message });

  const cacheGet = k => { const e = hub.cache.get(k); if (!e) return null; if (e.until <= hub.now()) { hub.cache.delete(k); return null; } return e.v; };
  const cachePut = (k, v, ttl = 600) => {
    if (typeof k !== 'string' || k.length > 250) throw new Error('Exception: Argument too large: key');
    if (typeof v !== 'string' || v.length > 100 * 1024) throw new Error('Exception: Argument too large: value');
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 21600) throw new Error('Exception: Invalid argument: expirationInSeconds');
    hub.cache.set(k, { v, until: hub.now() + ttl * 1000 });
  };
  const alive = fn => (...a) => { if (hub.cacheBroken) throw new Error('Exception: Service error: Cache'); return fn(...a); };
  const cache = {
    get: alive(k => cacheGet(k)),
    getAll: alive(keys => {
      if (!Array.isArray(keys) || keys.length > 100) throw new Error('Exception: Argument too large: keys (at most 100 per call)');
      const o = {}; for (const k of keys) { const v = cacheGet(k); if (v !== null) o[k] = v; } return o;
    }),
    put: alive(cachePut),
    putAll: alive((o, ttl) => {
      if (Object.keys(o).length > 100) throw new Error('Exception: Argument too large: values (at most 100 per call)');
      for (const k of Object.keys(o)) cachePut(k, o[k], ttl);
    }),
    remove: alive(k => { hub.cache.delete(k); }),
  };
  const setProp = (k, v) => {
    hub.assertLocked('PropertiesService write');
    if (typeof k !== 'string' || !k || k.length > 50) throw new Error('Exception: Invalid property key');
    if (typeof v !== 'string') throw new Error('MOCK: property values must be strings (real Apps Script would coerce; do it explicitly)');
    if (Buffer.byteLength(v) > 9 * 1024) throw new Error('Exception: Argument too large: value');
    hub.props[k] = v;
    if (Object.keys(hub.props).reduce((n, x) => n + x.length + Buffer.byteLength(hub.props[x]), 0) > 500 * 1024) throw new Error('Exception: Properties total size exceeded');
  };
  const props = {
    getProperty: k => (Object.prototype.hasOwnProperty.call(hub.props, k) ? hub.props[k] : null),
    getProperties: () => ({ ...hub.props }),
    setProperty: setProp,
    setProperties: o => { if (!isObj(o)) throw new Error('Exception: Invalid argument'); for (const k of Object.keys(o)) setProp(k, o[k]); },
    deleteProperty: k => { hub.assertLocked('PropertiesService write'); delete hub.props[k]; },
  };
  const lock = {
    tryLock: ms => { if (typeof ms !== 'number') throw new Error('Exception: Invalid argument'); if (hub.locked) throw new Error('MOCK: lock already held by this execution (not re-entrant)'); if (hub.contended) return false; hub.locked = true; return true; },
    waitLock: ms => { if (!lock.tryLock(ms)) throw new Error('Exception: Could not obtain lock after ' + ms + ' ms.'); },
    releaseLock: () => { hub.locked = false; },
    hasLock: () => hub.locked,
  };
  const sha = (alg, v) => {
    if (alg !== 'SHA_256') throw new Error('MOCK: only SHA_256 is faked');
    const b = crypto.createHash('sha256').update(typeof v === 'string' ? v : Buffer.from(v.map(x => x & 255))).digest();
    return Array.from(b, x => (x > 127 ? x - 256 : x)); // Apps Script returns signed bytes
  };
  const services = {
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => lock },
    CacheService: { getScriptCache: () => cache },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
      computeDigest: sha,
      getUuid: () => crypto.randomUUID(),
      base64Encode: v => Buffer.from(typeof v === 'string' ? Buffer.from(v) : Buffer.from(v.map(x => x & 255))).toString('base64'),
    },
    ContentService: {
      MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
      createTextOutput: text => ({ text: String(text), mime: 'TEXT', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.text; }, getMimeType() { return this.mime; } }),
    },
    Logger: { log: x => { hub.logs.push(String(x)); } },
    LanguageApp: { translate: (text, from, to, o) => fakeTranslate(hub, text, from, to, o) },
    Sheets: makeSheets(hub),
    __now: () => hub.now(),
  };

  // Each doPost runs in a fresh context, like a fresh Apps Script execution: no state may leak between requests.
  const script = new vm.Script(source, { filename: 'Code.gs' }), shim = new vm.Script(DATE_SHIM, { filename: 'date-shim.js' });
  const fresh = () => {
    const ctx = vm.createContext({ ...services });
    shim.runInContext(ctx);
    script.runInContext(ctx);
    return ctx;
  };
  // reuseContext (the long random histories) trades that isolation for speed; everything else keeps it.
  hub.load = () => (opts.reuseContext ? (hub.reused ||= fresh()) : fresh());
  hub.eval = (expr, ctx = (hub.shared ||= fresh())) => vm.runInContext(expr, ctx);
  hub.raw = body => {
    const ctx = hub.load();
    try { return ctx.doPost({ postData: { contents: body, type: 'text/plain' } }).getContent(); }
    finally { if (hub.locked) { hub.locked = false; throw new Error('MOCK: doPost returned with the script lock still held'); } }
  };
  hub.send = body => JSON.parse(hub.raw(typeof body === 'string' ? body : JSON.stringify(body)));
  hub.call = (key, action, extra = {}) => hub.send({ v: 1, key, action, ...extra });
  hub.get = () => JSON.parse(hub.load().doGet({}).getContent());
  hub.run = (fn, ...args) => { const ctx = hub.load(); try { return ctx[fn](...args); } finally { if (hub.locked) { hub.locked = false; throw new Error(`MOCK: ${fn} returned with the script lock still held`); } } };
  hub.setup = () => {
    hub.logs.length = 0;
    hub.run('setupHub');
    const grab = re => { const m = hub.logs.map(l => re.exec(l)).find(Boolean); return m ? m[1] : ''; };
    hub.keys = { pm: grab(/^PM key.*: ([A-Za-z0-9]{32})$/), crew: grab(/^Crew key: ([A-Za-z0-9]{32})$/), super: grab(/^Superintendent key: ([A-Za-z0-9]{32})$/), sheetUrl: grab(/Google Sheet: (\S+)$/) };
    return hub.keys;
  };

  // ----- inspection helpers for tests and the dev server -----
  hub.sheetId = () => hub.props.SHEET_ID;
  hub.workbook = (id = hub.sheetId()) => hub.spreadsheets.get(id);
  hub.archives = () => [...hub.spreadsheets.values()].filter(s => s.id !== hub.sheetId());
  const tab = (title, id) => { const s = hub.workbook(id).sheets.find(x => x.title === title); if (!s) throw new Error('no tab ' + title); return s; };
  hub.tabs = id => hub.workbook(id).sheets.map(s => s.title);
  hub.header = (title, id) => (tab(title, id).rows[0] || []).slice();
  // Data rows (row 2 down) as arrays of typed cell values, trailing blanks trimmed.
  hub.table = (title, id) => {
    const s = tab(title, id), out = [];
    for (let r = 1; r < s.rows.length; r++) {
      const row = Array.from(s.rows[r] || [], c => (c === undefined ? '' : c)); // Array.from, not map: cleared cells are holes
      while (row.length && row[row.length - 1] === '') row.pop();
      if (row.length) out.push(row);
    }
    return out;
  };
  hub.col = (title, name, id) => { const i = hub.header(title, id).indexOf(name); if (i < 0) throw new Error('no column ' + name); return hub.table(title, id).map(r => (r[i] === undefined ? '' : r[i])); };
  hub.entities = (title, id) => { const i = hub.header(title, id).indexOf('data'); return hub.table(title, id).map(r => JSON.parse(r[i])); };
  hub.formulaCells = () => {
    const out = [];
    for (const ss of hub.spreadsheets.values()) for (const s of ss.sheets) s.rows.forEach((row, r) => (row || []).forEach((c, i) => { if (isObj(c) && 'formula' in c) out.push(`${ss.id}:${s.title}!${colName(i)}${r + 1}`); }));
    return out;
  };
  hub.cell = (title, a1, id) => { const s = tab(title, id), m = /^([A-Z]+)(\d+)$/.exec(a1); return (s.rows[+m[2] - 1] || [])[colNum(m[1])]; };
  hub.format = (title, id) => { const s = tab(title, id); return { frozenRows: s.frozenRowCount, widths: { ...s.widths }, bold: s.formats.some(f => f.applied.bold && f.range.startRowIndex === 0 && f.range.endRowIndex === 1), wrap: s.formats.filter(f => f.applied.wrap).map(f => ({ col: f.range.startColumnIndex, wrap: f.applied.wrap })) }; };
  hub.cells = () => [...hub.spreadsheets.values()].reduce((n, ss) => n + ss.sheets.reduce((m, s) => m + s.rowCount * s.columnCount, 0), 0);
  hub.dump = () => {
    const out = [];
    const ss = hub.workbook();
    if (!ss) return 'hub not set up';
    for (const s of ss.sheets) {
      out.push(`=== ${s.title} (${s.rowCount} x ${s.columnCount})`);
      const head = hub.header(s.title);
      const di = head.indexOf('data');
      out.push(head.filter((h, i) => i !== di).join(' | '));
      for (const row of hub.table(s.title)) out.push(row.filter((c, i) => i !== di).map(c => (isObj(c) ? '[formula]' : String(c))).join(' | '));
    }
    return out.join('\n');
  };
  return hub;
}

module.exports = { createHub };
