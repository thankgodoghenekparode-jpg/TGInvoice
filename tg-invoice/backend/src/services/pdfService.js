import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';
import { getPublicUrl } from './storageService.js';
import { formatMoney, formatDate, paymentMethodLabel } from '../utils/format.js';

/**
 * Server-side PDF generation (pdfkit) — real vector PDFs, not screenshots.
 * Quotation / Invoice / Receipt share one document frame:
 * header → BILL TO → items → totals → payment info → footer.
 * Each tenant's own logo, bank details and currency settings are used —
 * never any other tenant's branding.
 */

const PAGE_MARGIN = 45;
const ACCENT = '#2563EB';
const INK = '#0F172A';
const MUTED = '#64748B';
const LINE = '#E2E8F0';
const SOFT = '#F8FAFC';
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Per-document accent — a saved template may override the brand blue. */
const accentOf = (doc) => (HEX.test(doc.__accent || '') ? doc.__accent : ACCENT);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSans-Bold.ttf');
const HAS_CUSTOM_FONT = fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD);

/* ── helpers ──────────────────────────────────────────────────────── */

async function loadLogo(logo) {
  if (!logo) return null;
  try {
    if (/^https?:\/\//.test(logo)) {
      const res = await fetch(logo);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    const key = logo.replace(/^\/uploads\//, '');
    const full = path.resolve(process.cwd(), config.storage.localDir, key);
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}

function money(value, settings) {
  let s = formatMoney(value, settings);
  if (!HAS_CUSTOM_FONT) s = s.replace(/₦/g, 'NGN ');
  return s;
}

function txt(doc, str, opts = {}) {
  doc.font(opts.bold ? 'BodyBold' : 'Body')
    .fontSize(opts.size || 9)
    .fillColor(opts.color || INK)
    .text(str ?? '', opts.x ?? doc.x, opts.y ?? doc.y, {
      width: opts.width,
      align: opts.align || 'left',
      lineGap: opts.lineGap ?? 1,
      ...(opts.letterSpacing ? { characterSpacing: opts.letterSpacing } : {}),
    });
}

/** Collect an address/contact block into printable lines. */
function customerLines(customer) {
  if (!customer) return [];
  const lines = [];
  if (customer.companyName && customer.companyName !== customer.name) lines.push(customer.companyName);
  [customer.address, [customer.city, customer.state].filter(Boolean).join(', '), customer.country]
    .filter(Boolean)
    .forEach((l) => lines.push(l));
  if (customer.phone) lines.push(`Phone: ${customer.phone}`);
  if (customer.email) lines.push(`Email: ${customer.email}`);
  if (customer.taxId) lines.push(`Tax ID: ${customer.taxId}`);
  return lines;
}

/* ── document frame ───────────────────────────────────────────────── */

async function drawHeader(doc, { kind, settings, number, dateLabel, dateValue, extraMeta = [], template }) {
  const contentWidth = doc.page.width - PAGE_MARGIN * 2;
  const accent = accentOf(doc);
  const title =
    kind === 'QUOTATION' ? 'QUOTATION'
      : kind === 'RECEIPT' ? 'RECEIPT'
        : kind === 'CREDIT_NOTE' ? 'CREDIT NOTE'
          : 'INVOICE';

  // Top accent bar
  doc.rect(0, 0, doc.page.width, 6).fill(accent);

  const logoBuffer = template?.showLogo === false ? null : await loadLogo(settings.logo);
  let infoX = PAGE_MARGIN;
  let y = 34;

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, PAGE_MARGIN, y, { fit: [58, 58], align: 'left', valign: 'top' });
      infoX = PAGE_MARGIN + 72;
    } catch {
      infoX = PAGE_MARGIN;
    }
  }

  const infoWidth = contentWidth - (infoX - PAGE_MARGIN) - 190;
  txt(doc, settings.businessName || settings.name || 'Your Business', {
    x: infoX, y, size: 16, bold: true, width: infoWidth,
  });
  y += 22;
  if (settings.address) {
    txt(doc, settings.address, { x: infoX, y, size: 8.5, color: MUTED, width: infoWidth });
    y += doc.heightOfString(settings.address, { width: infoWidth }) + 2;
  }
  const contact = [settings.phone, settings.email, settings.website].filter(Boolean).join('  |  ');
  if (contact) {
    txt(doc, contact, { x: infoX, y, size: 8.5, color: MUTED, width: infoWidth });
    y += 12;
  }
  if (settings.taxId) {
    txt(doc, `Tax ID: ${settings.taxId}`, { x: infoX, y, size: 8.5, color: MUTED, width: infoWidth });
  }

  // Right: title + meta
  const rightX = doc.page.width - PAGE_MARGIN - 190;
  doc.font('BodyBold').fontSize(21).fillColor(accent)
    .text(title, rightX, 34, { width: 190, align: 'right' });
  let my = 64;
  doc.font('BodyBold').fontSize(10).fillColor(INK)
    .text(number, rightX, my, { width: 190, align: 'right' });
  my += 15;
  doc.font('Body').fontSize(8.5).fillColor(MUTED)
    .text(`${dateLabel}: ${formatDate(dateValue)}`, rightX, my, { width: 190, align: 'right' });
  my += 13;
  for (const [label, value] of extraMeta) {
    if (!value) continue;
    doc.text(`${label}: ${value}`, rightX, my, { width: 190, align: 'right' });
    my += 13;
  }

  const dividerY = Math.max(y, my) + 12;
  doc.moveTo(PAGE_MARGIN, dividerY).lineTo(doc.page.width - PAGE_MARGIN, dividerY)
    .lineWidth(1).stroke(LINE);
  return dividerY + 18;
}

function drawBillTo(doc, customer, y) {
  const width = 300;
  txt(doc, 'BILL TO', { x: PAGE_MARGIN, y, size: 7.5, bold: true, color: MUTED, letterSpacing: 0.8 });
  y += 14;
  txt(doc, customer?.name || '—', { x: PAGE_MARGIN, y, size: 11.5, bold: true, width });
  y += 17;
  const lines = customerLines(customer);
  for (const line of lines) {
    txt(doc, line, { x: PAGE_MARGIN, y, size: 8.5, color: MUTED, width });
    y += Math.max(12, doc.heightOfString(line, { width, fontSize: 8.5 }) + 2);
  }
  return y + 8;
}

function drawSideBox(doc, lines, y) {
  // Small highlighted box on the right of BILL TO (amount due / received etc.)
  const w = 170;
  const x = doc.page.width - PAGE_MARGIN - w;
  let ly = y;
  const h = 16 + lines.length * 17;
  doc.roundedRect(x, ly, w, h, 4).fill(SOFT);
  ly += 10;
  for (const { label, value, big, color } of lines) {
    txt(doc, label, { x: x + 12, y: ly, size: 7.5, bold: true, color: MUTED, letterSpacing: 0.5, width: w - 24 });
    ly += 11;
    txt(doc, value, { x: x + 12, y: ly, size: big ? 14 : 9.5, bold: true, color: color || INK, width: w - 24 });
    ly += big ? 18 : 14;
  }
  return Math.max(y + h + 10, ly + 6);
}

/* ── items table ──────────────────────────────────────────────────── */

const COLS = [
  { key: 'description', label: 'DESCRIPTION', width: 175, align: 'left' },
  { key: 'quantity', label: 'QTY', width: 40, align: 'right' },
  { key: 'unitPrice', label: 'UNIT PRICE', width: 80, align: 'right' },
  { key: 'discountAmount', label: 'DISCOUNT', width: 70, align: 'right' },
  { key: 'taxAmount', label: 'TAX', width: 55, align: 'right' },
  { key: 'amount', label: 'AMOUNT', width: 85, align: 'right' },
];

function drawTableHeader(doc, y) {
  const contentWidth = doc.page.width - PAGE_MARGIN * 2;
  doc.rect(PAGE_MARGIN, y, contentWidth, 22).fill(SOFT);
  let x = PAGE_MARGIN;
  for (const col of COLS) {
    txt(doc, col.label, {
      x: col.align === 'right' ? x : x + 8,
      y: y + 7,
      size: 7,
      bold: true,
      color: MUTED,
      letterSpacing: 0.6,
      width: col.width - (col.align === 'right' ? 8 : 16),
      align: col.align,
    });
    x += col.width;
  }
  return y + 22;
}

function drawItemsTable(doc, startY, items, settings) {
  let y = drawTableHeader(doc, startY);
  const bottomLimit = doc.page.height - 170;

  items.forEach((item, index) => {
    const descY = y + 7;
    doc.font('Body').fontSize(8.5);
    const descHeight = doc.heightOfString(String(item.description || ''), { width: COLS[0].width - 16 });
    const rowH = Math.max(26, descHeight + 14);

    if (y + rowH > bottomLimit) {
      doc.addPage();
      y = 34;
      y = drawTableHeader(doc, y);
    }

    if (index % 2 === 1) {
      doc.rect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, rowH).fill('#FCFCFD');
    }

    let x = PAGE_MARGIN;
    for (const col of COLS) {
      let value = '';
      if (col.key === 'quantity') value = String(Number(item.quantity) || 0);
      else if (col.key === 'description') value = String(item.description || '');
      else value = money(item[col.key], settings);

      const isAmount = col.key === 'amount';
      txt(doc, value, {
        x: col.align === 'right' ? x : x + 8,
        y: col.align === 'right' ? y + 7 : descY,
        size: 8.5,
        bold: isAmount,
        color: isAmount ? INK : col.align === 'right' ? INK : '#334155',
        width: col.width - 16,
        align: col.align,
      });
      x += col.width;
    }

    y += rowH;
    doc.moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y).lineWidth(0.5).stroke(LINE);
  });

  return y + 16;
}

/* ── totals + payment info ────────────────────────────────────────── */

function drawTotals(doc, y, { settings, subtotal, discountAmount, taxAmount, total, amountPaid, balanceDue, kind }) {
  const w = 225;
  const x = doc.page.width - PAGE_MARGIN - w;
  let ly = y;
  const row = (label, value, opts = {}) => {
    txt(doc, label, { x: x + 4, y: ly, size: opts.size || 9, bold: !!opts.bold, color: opts.color || (opts.bold ? INK : MUTED), width: w - 90 });
    txt(doc, value, { x: x + w - 130, y: ly, size: opts.size || 9, bold: !!opts.bold, color: opts.valueColor || (opts.bold ? INK : INK), width: 126, align: 'right' });
    ly += opts.height || 17;
  };

  row('Subtotal', money(subtotal, settings));
  if (Number(discountAmount) > 0) row('Discount', `-${money(discountAmount, settings)}`);
  if (Number(taxAmount) > 0) row('Tax', money(taxAmount, settings));

  // Grand total
  doc.rect(x, ly - 2, w, 26).fill('#EFF6FF');
  txt(doc, kind === 'RECEIPT' ? 'AMOUNT' : 'TOTAL', { x: x + 8, y: ly + 6, size: 9, bold: true, color: accentOf(doc), width: 90 });
  txt(doc, money(total, settings), { x: x + w - 138, y: ly + 3, size: 13, bold: true, color: accentOf(doc), width: 130, align: 'right' });
  ly += 32;

  if (kind === 'INVOICE') {
    if (Number(amountPaid) > 0) row('Amount Paid', money(amountPaid, settings));
    row('Balance Due', money(balanceDue, settings), { bold: true, size: 10, valueColor: Number(balanceDue) > 0 ? '#DC2626' : '#16A34A', height: 20 });
  }

  return ly + 6;
}

function drawPaymentInfo(doc, y, settings, template) {
  const showBank = template?.showBankDetails !== false;
  const bank = [settings.bankName, settings.accountName, settings.accountNumber].filter(Boolean);
  const hasBank = showBank && bank.length > 0;
  if (!hasBank && !settings.paymentInstructions) return y;

  const w = 285;
  const h = (hasBank ? 66 : 0) + (settings.paymentInstructions ? 34 : 0) + 16;
  doc.roundedRect(PAGE_MARGIN, y, w, h, 4).fill(SOFT);
  let ly = y + 10;
  txt(doc, 'PAYMENT INFORMATION', { x: PAGE_MARGIN + 12, y: ly, size: 7.5, bold: true, color: MUTED, letterSpacing: 0.8 });
  ly += 15;
  if (hasBank) {
    if (settings.bankName) { txt(doc, `Bank: ${settings.bankName}`, { x: PAGE_MARGIN + 12, y: ly, size: 8.5 }); ly += 13; }
    if (settings.accountName) { txt(doc, `Account Name: ${settings.accountName}`, { x: PAGE_MARGIN + 12, y: ly, size: 8.5 }); ly += 13; }
    if (settings.accountNumber) { txt(doc, `Account Number: ${settings.accountNumber}`, { x: PAGE_MARGIN + 12, y: ly, size: 8.5 }); ly += 13; }
  }
  if (settings.paymentInstructions) {
    ly += 3;
    txt(doc, settings.paymentInstructions, { x: PAGE_MARGIN + 12, y: ly, size: 8, color: MUTED, width: w - 24 });
  }
  return Math.max(y + h + 14, ly + 34);
}

function drawNotesAndTerms(doc, y, { notes, terms, width }) {
  const block = (label, value) => {
    if (!value) return;
    txt(doc, label, { x: PAGE_MARGIN, y, size: 7.5, bold: true, color: MUTED, letterSpacing: 0.8, width });
    y += 13;
    txt(doc, value, { x: PAGE_MARGIN, y, size: 8.5, color: '#334155', width });
    y += doc.heightOfString(value, { width, fontSize: 8.5 }) + 8;
  };
  block('NOTES', notes);
  block('TERMS & CONDITIONS', terms);
  return y;
}

/** A template's header note, printed under the document header. */
function drawHeaderNote(doc, y, note) {
  if (!note) return y;
  const w = doc.page.width - PAGE_MARGIN * 2;
  txt(doc, note, { x: PAGE_MARGIN, y, size: 8.5, color: MUTED, width: w });
  return y + doc.heightOfString(note, { width: w, fontSize: 8.5 }) + 10;
}

/** Tenant-defined custom fields flagged for printing (label: value rows). */
function drawCustomFields(doc, y, fields) {
  if (!fields || fields.length === 0) return y;
  const w = 500;
  txt(doc, 'ADDITIONAL INFORMATION', { x: PAGE_MARGIN, y, size: 7.5, bold: true, color: MUTED, letterSpacing: 0.8, width: w });
  y += 14;
  for (const f of fields) {
    txt(doc, String(f.label), { x: PAGE_MARGIN, y, size: 8.5, bold: true, color: MUTED, width: 150 });
    txt(doc, String(f.value), { x: PAGE_MARGIN + 160, y, size: 8.5, width: w - 160 });
    y += 14;
  }
  return y + 8;
}

function stampFooters(doc) {
  const settings = doc.__settings || {};
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - 42;
    doc.moveTo(PAGE_MARGIN, y - 8).lineTo(doc.page.width - PAGE_MARGIN, y - 8).lineWidth(0.5).stroke(LINE);
    doc.font('Body').fontSize(7.5).fillColor(MUTED);
    doc.text(
      doc.__footerNote || `Thank you for doing business with ${settings.businessName || settings.name || ''}.`,
      PAGE_MARGIN, y, { width: doc.page.width - PAGE_MARGIN * 2, align: 'center', lineBreak: false }
    );
    doc.text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN, y + 11, {
      width: doc.page.width - PAGE_MARGIN * 2, align: 'center', lineBreak: false,
    });
    doc.fillColor(INK);
  }
}

function createDoc() {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Producer: 'TG Invoice — tgeasy' } });
  if (HAS_CUSTOM_FONT) {
    doc.registerFont('Body', FONT_REGULAR);
    doc.registerFont('BodyBold', FONT_BOLD);
  } else {
    doc.registerFont('Body', 'Helvetica');
    doc.registerFont('BodyBold', 'Helvetica-Bold');
  }
  return doc;
}

function finish(doc) {
  stampFooters(doc);
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/* ── public API ───────────────────────────────────────────────────── */

/**
 * Generate quotation / invoice / credit note PDF.
 * @param {{ kind: 'QUOTATION'|'INVOICE'|'CREDIT_NOTE', document: object,
 *           customer: object, settings: object, items: Array, template?: object,
 *           customFields?: Array }} input
 * @returns {Promise<Buffer>}
 */
export async function generateDocumentPdf({ kind, document: docData, customer, settings, items, template = null, customFields = [] }) {
  const doc = createDoc();
  doc.__settings = settings;
  doc.__accent = template?.accentColor || null;
  doc.__footerNote = template?.footerNote || null;

  const isInvoice = kind === 'INVOICE';
  const isCredit = kind === 'CREDIT_NOTE';
  const number = isCredit
    ? docData.creditNoteNumber
    : isInvoice
      ? docData.invoiceNumber
      : docData.quotationNumber;

  let y = await drawHeader(doc, {
    kind,
    settings,
    template,
    number,
    dateLabel: isCredit ? 'Credit Note Date' : isInvoice ? 'Invoice Date' : 'Quotation Date',
    dateValue: isCredit ? docData.creditNoteDate : isInvoice ? docData.invoiceDate : docData.quotationDate,
    extraMeta: isCredit
      ? [['Invoice', docData.invoice?.invoiceNumber]]
      : isInvoice
        ? [['Due Date', formatDate(docData.dueDate)], ['Reference', docData.reference || '—']]
        : [['Valid Until', formatDate(docData.validUntil)], ['Reference', docData.reference || '—']],
  });

  y = drawHeaderNote(doc, y, template?.headerNote);

  y = drawBillTo(doc, customer, y);

  const creditLeft = round2(Number(docData.total) - Number(docData.amountApplied || 0));
  const sideLines = isCredit
    ? [
        { label: 'CREDIT TOTAL', value: money(docData.total, settings), big: true, color: accentOf(doc) },
        { label: 'APPLIED', value: money(docData.amountApplied || 0, settings) },
        { label: 'CREDIT REMAINING', value: money(creditLeft, settings) },
      ]
    : isInvoice
      ? [
          { label: 'AMOUNT DUE', value: money(docData.balanceDue, settings), big: true, color: Number(docData.balanceDue) > 0 ? '#DC2626' : '#16A34A' },
          { label: 'DUE DATE', value: formatDate(docData.dueDate) || '—' },
        ]
      : [
          { label: 'TOTAL', value: money(docData.total, settings), big: true, color: accentOf(doc) },
          { label: 'VALID UNTIL', value: formatDate(docData.validUntil) || '—' },
        ];
  y = Math.max(y, drawSideBox(doc, sideLines, y - 4));

  y = drawItemsTable(doc, y + 6, items, settings);
  y = drawTotals(doc, y, {
    settings,
    subtotal: docData.subtotal,
    discountAmount: docData.discountAmount,
    taxAmount: docData.taxAmount,
    total: docData.total,
    amountPaid: docData.amountPaid ?? 0,
    balanceDue: docData.balanceDue ?? docData.total,
    kind,
  });

  const infoY = Math.min(y, doc.page.height - 200);
  const afterInfo = drawPaymentInfo(doc, infoY, settings, template);
  let afterNotes = drawNotesAndTerms(doc, afterInfo, {
    notes: [docData.reason ? `Reason: ${docData.reason}` : null, docData.notes].filter(Boolean).join('\n\n'),
    terms: docData.terms,
    width: 500,
  });
  afterNotes = drawCustomFields(doc, afterNotes, customFields);

  return finish(doc);
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Generate receipt PDF (payment record — no line items).
 * @param {{ document: object, payment: object, customer: object,
 *           invoice: object, settings: object }} input
 */
export async function generateReceiptPdf({ document: r, payment, customer, invoice, settings, template = null, customFields = [] }) {
  const doc = createDoc();
  doc.__settings = settings;
  doc.__accent = template?.accentColor || null;
  doc.__footerNote = template?.footerNote || null;

  let y = await drawHeader(doc, {
    kind: 'RECEIPT',
    settings,
    template,
    number: r.receiptNumber,
    dateLabel: 'Receipt Date',
    dateValue: r.receiptDate,
    extraMeta: [['Reference', r.reference || payment?.reference || '—']],
  });

  y = drawHeaderNote(doc, y, template?.headerNote);

  y = drawBillTo(doc, customer, y);

  y = Math.max(
    y,
    drawSideBox(doc, [
      { label: 'AMOUNT RECEIVED', value: money(r.amount, settings), big: true, color: '#16A34A' },
      { label: 'PAYMENT METHOD', value: paymentMethodLabel(r.paymentMethod) },
    ], y - 4)
  );

  // Payment details table (single section instead of line items)
  const detailRows = [
    ['Invoice', invoice?.invoiceNumber || '—'],
    ['Payment Date', formatDate(payment?.paymentDate || r.receiptDate)],
    ['Payment Method', paymentMethodLabel(r.paymentMethod)],
    ['Reference', r.reference || payment?.reference || '—'],
    ['Description', r.description || `Payment for invoice ${invoice?.invoiceNumber || ''}`.trim()],
  ];
  const w = 500;
  doc.rect(PAGE_MARGIN, y, w, 24).fill(SOFT);
  txt(doc, 'PAYMENT DETAILS', { x: PAGE_MARGIN + 10, y: y + 8, size: 7.5, bold: true, color: MUTED, letterSpacing: 0.8 });
  y += 30;
  for (const [label, value] of detailRows) {
    txt(doc, label, { x: PAGE_MARGIN + 10, y, size: 8.5, bold: true, color: MUTED, width: 130 });
    txt(doc, String(value), { x: PAGE_MARGIN + 150, y, size: 8.5, width: w - 160 });
    y += 16;
    doc.moveTo(PAGE_MARGIN, y - 3).lineTo(PAGE_MARGIN + w, y - 3).lineWidth(0.4).stroke(LINE);
  }

  y += 14;
  doc.roundedRect(PAGE_MARGIN, y, w, 52, 4).fill('#F0FDF4');
  txt(doc, 'AMOUNT RECEIVED', { x: PAGE_MARGIN + 14, y: y + 11, size: 7.5, bold: true, color: '#16A34A', letterSpacing: 0.8 });
  txt(doc, money(r.amount, settings), { x: PAGE_MARGIN + 14, y: y + 24, size: 20, bold: true, color: '#15803D' });
  txt(doc, `In words: ${amountInWords(r.amount, settings)}`, {
    x: PAGE_MARGIN + 210, y: y + 30, size: 8, color: MUTED, width: w - 230, align: 'right',
  });
  y += 66;

  const afterInfo = drawPaymentInfo(doc, y, settings, template);
  let afterNotes = drawNotesAndTerms(doc, afterInfo, { notes: r.notes || settings.defaultReceiptNotes, width: 500 });
  afterNotes = drawCustomFields(doc, afterNotes, customFields);

  return finish(doc);
}

/** Convert an amount to words — receipts look professional with "in words". */
export function amountInWords(value, settings = {}) {
  const n = Number(value) || 0;
  const whole = Math.floor(n);
  const cents = Math.round((n - whole) * 100);
  const words = intToWords(whole);
  const currency = settings.currency || 'NGN';
  const suffix = cents > 0 ? ` and ${cents}/100` : '';
  return `${capitalize(words)} ${currency}${suffix} only`;
}

function intToWords(num) {
  if (num === 0) return 'zero';
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const chunk = (x) => {
    let s = '';
    if (x >= 100) { s += `${ones[Math.floor(x / 100)]} hundred`; x %= 100; if (x) s += ' and '; }
    if (x >= 20) { s += tens[Math.floor(x / 10)]; if (x % 10) s += `-${ones[x % 10]}`; }
    else s += ones[x];
    return s;
  };
  const scales = [[1_000_000_000, 'billion'], [1_000_000, 'million'], [1_000, 'thousand'], [100, 'hundred']];
  let rest = num;
  let out = '';
  for (const [value, name] of scales) {
    if (rest >= value) {
      const part = Math.floor(rest / value);
      out += `${chunk(part)} ${name}`;
      rest %= value;
      if (rest > 0) out += ' ';
    }
  }
  if (rest > 0) out += chunk(rest);
  return out.trim();
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default { generateDocumentPdf, generateReceiptPdf, amountInWords };
