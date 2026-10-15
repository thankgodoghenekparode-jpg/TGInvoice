import { prisma } from '../prisma.js';
import { errors, AppError } from '../utils/errors.js';
import { sendMail } from './emailService.js';
import { generateDocumentPdf, generateReceiptPdf } from './pdfService.js';
import { calculateLine } from '../utils/money.js';
import { formatMoney, formatDate, paymentMethodLabel, whatsappMessage } from '../utils/format.js';
import { signShareToken, publicDocumentUrl } from '../utils/shareToken.js';

/** Current tenant settings with sane defaults (never another tenant's). */
export async function getSettings(tenantId) {
  const settings = await prisma.companySettings.findUnique({ where: { tenantId } });
  return (
    settings || {
      tenantId,
      businessName: null,
      logo: null,
      currency: 'NGN',
      currencySymbol: '₦',
      currencyPosition: 'prefix',
      currencyDecimals: 2,
      defaultTaxRate: 0,
    }
  );
}

/**
 * Load a tenant-owned document with its relations in ONE scoped query.
 * findFirst({ id, tenantId }) — another tenant's ID returns 404 and the
 * response never reveals that the resource exists elsewhere.
 */
export async function loadScoped(model, id, tenantId, extra = {}) {
  const doc = await prisma[model].findFirst({ where: { id, tenantId }, ...extra });
  if (!doc) throw errors.notFound('Document not found.');
  return doc;
}

const CUSTOMER_SELECT = {
  id: true, name: true, companyName: true, email: true, phone: true,
  address: true, city: true, state: true, country: true, taxId: true, customerCode: true,
};

/** Attachments for documents: PDF + tenant branding in the message body. */
export async function buildDocumentPdf({ kind, document, customer, settings, items, payment, invoice }) {
  if (kind === 'RECEIPT') {
    return generateReceiptPdf({ document, payment, customer, invoice, settings });
  }
  if (kind === 'CREDIT_NOTE') {
    // CreditNoteItem stores no per-line discount/tax amounts — derive them for
    // display so the PDF columns are populated like every other document.
    const enriched = (items || []).map((it) => ({ ...it, ...calculateLine(it) }));
    return generateDocumentPdf({ kind, document, customer, settings, items: enriched });
  }
  return generateDocumentPdf({ kind, document, customer, settings, items });
}

/**
 * Email a document with its PDF attached.
 * SMTP not configured → 503 with the friendly message (never a crash).
 */
export async function emailDocument({ to, subject, message, kind, pdfBuffer, fileName, settings, previewUrl }) {
  if (!to) throw errors.badRequest('Enter the recipient email address.');

  const result = await sendMail({
    to,
    subject,
    text: previewUrl ? `${message}\n\nView online: ${previewUrl}` : message,
    html: emailHtml({ kind, message, settings, previewUrl }),
    attachments: pdfBuffer ? [{ filename: fileName, content: pdfBuffer }] : [],
  });

  if (!result.sent) {
    if (result.reason === 'not_configured') {
      throw new AppError('Email service is not configured.', 503, 'EMAIL_NOT_CONFIGURED');
    }
    throw new AppError('The email could not be sent. Please try again or share the document another way.', 502, 'EMAIL_SEND_FAILED');
  }
  return result;
}

function emailHtml({ kind, message, settings, previewUrl }) {
  const label =
    kind === 'QUOTATION' ? 'Quotation'
      : kind === 'RECEIPT' ? 'Receipt'
        : kind === 'CREDIT_NOTE' ? 'Credit note'
          : kind === 'REFUND' ? 'Refund'
            : 'Invoice';
  const button = previewUrl
    ? `<p style="margin:22px 0 6px"><a href="${previewUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">View document online</a></p>`
    : '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
    <p style="font-size:13px;color:#64748b;margin:0 0 4px"><b style="color:#2563eb">tgeasy</b> · TG Invoice</p>
    <h2 style="margin:10px 0 14px;font-size:17px">${label} from ${settings.businessName || 'your business'}</h2>
    <p style="white-space:pre-wrap;line-height:1.6">${String(message || '').replace(/</g, '&lt;')}</p>
    ${button}
    <p style="color:#64748b;font-size:12px;margin-top:24px">Generated with TG Invoice — tgeasy</p>
  </div>`;
}

/** Signed, expiring public link for one document (or null if unavailable). */
export function previewUrlFor({ kind, document }) {
  if (!document?.id || !document?.tenantId) return null;
  return publicDocumentUrl(signShareToken({ kind, id: document.id, tenantId: document.tenantId }));
}

/** Click-to-chat share payload used by the frontend WhatsApp button. */
export async function sharePayload({ kind, document, customer, settings }) {
  const number =
    kind === 'QUOTATION' ? document.quotationNumber
      : kind === 'RECEIPT' ? document.receiptNumber
        : kind === 'CREDIT_NOTE' ? document.creditNoteNumber
          : kind === 'REFUND' ? document.refundNumber
            : document.invoiceNumber;
  const amount = formatMoney(document.total ?? document.amount, settings);
  const previewUrl = previewUrlFor({ kind, document });
  const text = whatsappMessage({
    kind,
    customerName: customer?.name || 'there',
    businessName: settings.businessName || settings.name || 'our business',
    documentNumber: number,
    amount,
    settings,
    previewUrl,
  });
  const phone = (customer?.phone || '').replace(/[^\d]/g, '');
  const waPhone = phone.startsWith('0') ? `234${phone.slice(1)}` : phone.startsWith('234') ? phone : phone;
  return { text, url: `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`, phone: waPhone, previewUrl };
}

export { CUSTOMER_SELECT, formatMoney, formatDate, paymentMethodLabel };
