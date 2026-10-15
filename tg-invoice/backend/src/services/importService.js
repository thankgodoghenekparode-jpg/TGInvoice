import { prisma } from '../prisma.js';
import { errors } from '../utils/errors.js';
import { allocateDocumentNumber } from './sequenceService.js';

/**
 * CSV / Excel import for customers and products.
 *
 * The flow is deliberately preview-then-commit: `planImport` parses and
 * validates a spreadsheet without writing anything, so the UI can show exactly
 * what will happen (and which rows are broken); `commitImport` re-validates and
 * writes, skipping bad rows instead of failing the whole batch.
 *
 * Parsing is dependency-light: CSV is handled natively (quotes, CRLF, BOM,
 * delimiter sniffing) and .xlsx is read with exceljs.
 */

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB

/* ── Spreadsheet specs ────────────────────────────────────────────── */

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const IMPORT_TYPES = {
  customers: {
    label: 'Customers',
    model: 'customer',
    dedupeKeys: ['customerCode', 'email'],
    fields: [
      { key: 'name', label: 'Name', required: true, aliases: ['name', 'customer', 'customer name', 'full name', 'client', 'client name', 'contact name'] },
      { key: 'companyName', label: 'Company', aliases: ['company', 'company name', 'organisation', 'organization', 'business', 'business name'] },
      { key: 'email', label: 'Email', aliases: ['email', 'e mail', 'email address', 'e mail address'] },
      { key: 'phone', label: 'Phone', aliases: ['phone', 'phone number', 'mobile', 'mobile number', 'tel', 'telephone', 'contact', 'contact number'] },
      { key: 'address', label: 'Address', aliases: ['address', 'street', 'address line 1', 'address 1', 'street address'] },
      { key: 'city', label: 'City', aliases: ['city', 'town'] },
      { key: 'state', label: 'State', aliases: ['state', 'province', 'region'] },
      { key: 'country', label: 'Country', aliases: ['country'] },
      { key: 'taxId', label: 'Tax ID', aliases: ['tax id', 'taxid', 'vat', 'vat number', 'tin', 'tax number', 'vat no'] },
      { key: 'customerCode', label: 'Customer code', aliases: ['customer code', 'code', 'customer id'] },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments', 'comment'] },
    ],
    template: ['Name', 'Company', 'Email', 'Phone', 'Address', 'City', 'State', 'Country', 'Tax ID', 'Customer code', 'Notes'],
    sample: ['Ada Obi', 'Zarox Energy Ltd', 'ada@zarox.example', '+2348012345678', '12 Marina Road', 'Lagos', 'Lagos', 'Nigeria', 'TIN-123456', '', 'Prefers WhatsApp'],
  },
  products: {
    label: 'Products & services',
    model: 'product',
    dedupeKeys: ['name'],
    fields: [
      { key: 'name', label: 'Name', required: true, aliases: ['name', 'product', 'product name', 'service', 'service name', 'item', 'item name'] },
      { key: 'description', label: 'Description', aliases: ['description', 'details', 'notes'] },
      { key: 'category', label: 'Category', aliases: ['category', 'type', 'group'] },
      { key: 'unit', label: 'Unit', aliases: ['unit', 'uom', 'unit of measure'] },
      { key: 'unitPrice', label: 'Unit price', aliases: ['unit price', 'price', 'rate', 'amount', 'cost'] },
      { key: 'taxRate', label: 'Tax rate', aliases: ['tax rate', 'tax', 'vat', 'vat rate', 'tax percent', 'tax %'] },
      { key: 'active', label: 'Active', aliases: ['active', 'enabled', 'status'] },
    ],
    template: ['Name', 'Description', 'Category', 'Unit', 'Unit price', 'Tax rate', 'Active'],
    sample: ['Site survey', 'Initial on-site assessment', 'Survey', 'visit', '75000', '7.5', 'yes'],
  },
};

export function assertImportType(type) {
  if (!IMPORT_TYPES[type]) {
    throw errors.badRequest('Choose what you are importing.', [{ path: 'type', message: 'Unknown import type.' }]);
  }
}

/* ── CSV parsing (RFC 4180-ish, no dependency) ────────────────────── */

function sniffDelimiter(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0] || '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** @returns {{ rows: string[][], sourceRows: number[] }} */
export function parseCsv(text, delimiter) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const delim = delimiter || sniffDelimiter(src);
  const rows = [];
  const sourceRows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;

  const endRow = () => {
    rows.push(row);
    sourceRows.push(rowStart);
    row = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      endRow();
      line += 1;
      rowStart = line;
      continue;
    }
    field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    endRow();
  }
  return { rows, sourceRows };
}

/* ── XLSX parsing (exceljs) ───────────────────────────────────────── */

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r?.text ?? '').join('').trim();
    if (v.text != null) return String(v.text).trim();
    if (v.result != null) return cellToString(v.result);
    if (v.error) return '';
    return '';
  }
  return String(v).trim();
}

async function parseXlsx(buffer) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], sourceRows: [] };

  const rows = [];
  const sourceRows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = row.values || [];
    const cells = [];
    for (let c = 1; c < values.length; c += 1) cells.push(cellToString(values[c]));
    rows.push(cells);
    sourceRows.push(rowNumber);
  });
  return { rows, sourceRows };
}

/**
 * Read a spreadsheet from a buffer, picking the strategy from the file name
 * (falling back to magic bytes). Returns rows plus their original line/row
 * numbers so errors can point at the user's own spreadsheet.
 */
export async function readSheet(buffer, fileName = '') {
  const ext = String(fileName).split('.').pop()?.toLowerCase() || '';
  if (ext === 'xlsx' || ext === 'xlsm') return parseXlsx(buffer);
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return parseCsv(buffer.toString('utf8'));
  if (ext === 'xls') {
    throw errors.badRequest('This is an old Excel (.xls) file. Open it and save it as .xlsx or CSV, then try again.', [
      { path: 'file', message: 'Unsupported .xls format.' },
    ]);
  }
  if (buffer.subarray(0, 2).toString() === 'PK') return parseXlsx(buffer);
  return parseCsv(buffer.toString('utf8'));
}

/* ── Header mapping + value coercion ──────────────────────────────── */

export function mapHeaders(spec, headerRow) {
  const aliasToKey = new Map();
  for (const f of spec.fields) {
    aliasToKey.set(norm(f.label), f.key);
    for (const a of f.aliases) aliasToKey.set(norm(a), f.key);
  }

  const mapping = {};
  const ignoredHeaders = [];
  const seen = new Set();
  (headerRow || []).forEach((raw, index) => {
    const key = aliasToKey.get(norm(raw));
    if (key && !(key in mapping)) mapping[key] = index;
    else if (String(headerRow[index] ?? '').trim()) ignoredHeaders.push(String(headerRow[index]).trim());
  });

  const missingRequired = spec.fields.filter((f) => f.required && !(f.key in mapping)).map((f) => f.label);
  return { mapping, ignoredHeaders, missingRequired };
}

function toNumber(raw) {
  const s = String(raw ?? '').replace(/[^0-9.\-]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBoolean(raw) {
  const v = norm(raw);
  if (['yes', 'true', '1', 'active', 'enabled', 'on', 'y'].includes(v)) return true;
  if (['no', 'false', '0', 'inactive', 'disabled', 'off', 'n'].includes(v)) return false;
  return null;
}

/** Trim, and treat blank as null so optional columns stay empty. */
const clean = (raw) => {
  const s = String(raw ?? '').trim();
  return s === '' ? null : s;
};

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Turn one raw row into a validated payload for the given import type. */
function buildRow(type, cells, mapping) {
  const at = (key) => (mapping[key] == null ? null : cells[mapping[key]]);
  const errors = [];
  const data = {};

  if (type === 'customers') {
    const name = clean(at('name'));
    if (!name) errors.push('Name is required.');
    data.name = name;
    for (const key of ['companyName', 'phone', 'address', 'city', 'state', 'country', 'taxId', 'notes']) {
      data[key] = clean(at(key));
    }
    const email = clean(at('email'));
    if (email && !isEmail(email)) errors.push(`“${email}” is not a valid email address.`);
    data.email = email;
    data.customerCode = clean(at('customerCode'));
  } else {
    const name = clean(at('name'));
    if (!name) errors.push('Name is required.');
    data.name = name;
    data.description = clean(at('description'));
    data.category = clean(at('category')) || 'Other';
    data.unit = clean(at('unit')) || 'unit';

    const priceRaw = at('unitPrice');
    if (clean(priceRaw) !== null) {
      const price = toNumber(priceRaw);
      if (price === null) errors.push(`“${clean(priceRaw)}” is not a valid price.`);
      else if (price < 0) errors.push('Price cannot be negative.');
      else data.unitPrice = price;
    } else {
      data.unitPrice = 0;
    }

    const taxRaw = at('taxRate');
    if (clean(taxRaw) !== null) {
      const tax = toNumber(taxRaw);
      if (tax === null) errors.push(`“${clean(taxRaw)}” is not a valid tax rate.`);
      else if (tax < 0 || tax > 100) errors.push('Tax rate must be between 0 and 100.');
      else data.taxRate = tax;
    } else {
      data.taxRate = 0;
    }

    const activeRaw = at('active');
    data.active = clean(activeRaw) === null ? true : parseActive(activeRaw, errors);
  }

  return { data, errors };
}

function parseActive(raw, errors) {
  const parsed = parseBoolean(raw);
  if (parsed === null) {
    errors.push(`“${String(raw).trim()}” is not a valid active value (use yes or no).`);
    return true;
  }
  return parsed;
}

/* ── Plan (preview) ───────────────────────────────────────────────── */

/**
 * Parse + validate a spreadsheet without writing. Returns the header mapping,
 * per-row actions (create/update/error) and a summary the UI can render.
 */
export async function planImport(tenantId, type, buffer, fileName) {
  assertImportType(type);
  const spec = IMPORT_TYPES[type];
  const fieldsMeta = spec.fields.map((f) => ({ key: f.key, label: f.label, required: !!f.required }));
  if (!buffer || buffer.length === 0) {
    throw errors.badRequest('Choose a file to import.', [{ path: 'file', message: 'The file is empty.' }]);
  }

  const { rows, sourceRows } = await readSheet(buffer, fileName);
  if (rows.length === 0) {
    throw errors.badRequest('This file has no rows to import.', [{ path: 'file', message: 'Nothing to import.' }]);
  }

  const [header, ...body] = rows;
  const { mapping, ignoredHeaders } = mapHeaders(spec, header);

  const missingRequired = spec.fields.filter((f) => f.required && mapping[f.key] == null).map((f) => f.label);
  if (missingRequired.length > 0) {
    return {
      type,
      fileName: fileName || null,
      headers: header.map((h) => String(h ?? '').trim()),
      fields: fieldsMeta,
      mapping,
      ignoredHeaders,
      missingRequired,
      rows: [],
      summary: { total: 0, totalRows: body.length, create: 0, update: 0, errors: body.length },
    };
  }

  // Existing records (tenant-scoped) used to decide create vs update.
  const existing = await loadExisting(tenantId, type, spec, body, mapping);

  const seen = new Map(); // dedupe key → sourceRow
  const planned = [];

  body.forEach((cells, i) => {
    const sourceRow = sourceRows[i + 1] ?? i + 2;
    const { data, errors } = buildRow(type, cells, mapping);
    let action = errors.length > 0 ? 'error' : 'create';
    let matchId = null;

    if (errors.length === 0) {
      for (const key of spec.dedupeKeys) {
        const value = data[key];
        if (!value) continue;
        const dedupe = `${key}:${String(value).toLowerCase()}`;
        if (seen.has(dedupe)) {
          errors.push(`Same ${spec.fields.find((f) => f.key === key)?.label.toLowerCase()} as row ${seen.get(dedupe)} in this file.`);
          break;
        }
        seen.set(dedupe, sourceRow);
      }
      if (errors.length === 0) {
        for (const key of spec.dedupeKeys) {
          const value = data[key];
          if (!value) continue;
          const hit = existing.get(`${key}:${String(value).toLowerCase()}`);
          if (hit) {
            matchId = hit.id;
            break;
          }
        }
        action = matchId ? 'update' : 'create';
      }
    }

    if (errors.length > 0) action = 'error';
    planned.push({ sourceRow, values: data, errors, action, existingId: matchId });
  });

  const summary = {
    total: planned.length,
    totalRows: body.length,
    create: planned.filter((r) => r.action === 'create').length,
    update: planned.filter((r) => r.action === 'update').length,
    errors: planned.filter((r) => r.action === 'error').length,
  };

  return {
    type,
    fileName: fileName || null,
    headers: header.map((h) => String(h ?? '').trim()),
    fields: fieldsMeta,
    mapping,
    ignoredHeaders,
    missingRequired: [],
    rows: planned,
    summary,
  };
}

/** Look up existing tenant rows by each dedupe key, in one query. */
async function loadExisting(tenantId, type, spec, body, mapping) {
  const map = new Map();
  const or = [];
  for (const key of spec.dedupeKeys) {
    const idx = mapping[key];
    if (idx == null) continue;
    const values = [...new Set(body.map((cells) => clean(cells[idx])).filter(Boolean))];
    if (values.length === 0) continue;
    or.push({ [key]: { in: values } });
  }
  if (or.length === 0) return map;

  const rows = await prisma[spec.model].findMany({
    where: { tenantId, OR: or },
    select: { id: true, ...Object.fromEntries(spec.dedupeKeys.map((k) => [k, true])) },
  });

  for (const row of rows) {
    for (const key of spec.dedupeKeys) {
      const value = row[key];
      if (value) map.set(`${key}:${String(value).toLowerCase()}`, row);
    }
  }
  return map;
}

/* ── Commit ───────────────────────────────────────────────────────── */

/**
 * Validate then write. Valid rows are created/updated; invalid rows are
 * skipped and reported — one bad row never blocks the whole file.
 */
export async function commitImport(tenantId, type, buffer, fileName) {
  const plan = await planImport(tenantId, type, buffer, fileName);
  const spec = IMPORT_TYPES[type];

  if (plan.missingRequired.length > 0) {
    throw errors.badRequest(
      `This file is missing required column${plan.missingRequired.length > 1 ? 's' : ''}: ${plan.missingRequired.join(', ')}.`,
      [{ path: 'file', message: 'Required columns are missing.' }]
    );
  }
  if (plan.summary.total === 0) {
    throw errors.badRequest('There are no rows to import.');
  }
  if (plan.summary.total > MAX_IMPORT_ROWS) {
    throw errors.badRequest(`Please import at most ${MAX_IMPORT_ROWS} rows at a time.`);
  }

  let created = 0;
  let updated = 0;
  const errors = [];

  for (const row of plan.rows) {
    if (row.action === 'error') {
      errors.push({ row: row.sourceRow, message: row.errors.join(' ') });
      continue;
    }
    try {
      if (type === 'customers') {
        const payload = {
          name: row.values.name,
          companyName: row.values.companyName,
          email: row.values.email,
          phone: row.values.phone,
          address: row.values.address,
          city: row.values.city,
          state: row.values.state,
          country: row.values.country,
          taxId: row.values.taxId,
          notes: row.values.notes,
        };
        if (row.action === 'update' && row.existingId) {
          await prisma.customer.update({ where: { id: row.existingId }, data: payload });
          updated += 1;
        } else {
          const code = row.values.customerCode || (await allocateDocumentNumber(prisma, tenantId, 'CUSTOMER', null));
          await prisma.customer.create({ data: { tenantId, customerCode: code, ...payload } });
          created += 1;
        }
      } else {
        const payload = {
          name: row.values.name,
          description: row.values.description,
          category: row.values.category,
          unit: row.values.unit,
          unitPrice: row.values.unitPrice,
          taxRate: row.values.taxRate,
          active: row.values.active,
        };
        if (row.action === 'update' && row.existingId) {
          await prisma.product.update({ where: { id: row.existingId }, data: payload });
          updated += 1;
        } else {
          await prisma.product.create({ data: { tenantId, ...payload } });
          created += 1;
        }
      }
    } catch (err) {
      console.error('[import-row-failed]', type, row.sourceRow, err?.message);
      errors.push({ row: row.sourceRow, message: 'Could not save this row. Check for a duplicate code or value.' });
    }
  }

  return { type, created, updated, skipped: errors.length, errors, summary: plan.summary };
}

/* ── Template ─────────────────────────────────────────────────────── */

/** A CSV template (headers + one example row) users can fill in and upload. */
export function buildTemplateCsv(type) {
  assertImportType(type);
  const spec = IMPORT_TYPES[type];
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${spec.template.map(escape).join(',')}\r\n${spec.sample.map(escape).join(',')}\r\n`;
}

export default { planImport, commitImport, readSheet, buildTemplateCsv, IMPORT_TYPES };
