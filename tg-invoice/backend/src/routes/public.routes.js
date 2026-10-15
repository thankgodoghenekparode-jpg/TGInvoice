import { Router } from 'express';
import { prisma } from '../prisma.js';
import { errors, AppError, asyncHandler } from '../utils/errors.js';
import { verifyShareToken } from '../utils/shareToken.js';
import { getSettings, buildDocumentPdf } from '../services/documentService.js';
import { validateCode } from '../services/referralService.js';

const router = Router();

/**
 * GET /api/public/documents/:token
 *
 * Renders a shared document as an inline PDF. There is no auth and no tenant
 * header here on purpose: the signed, expiring token is the only credential.
 * The token is scoped to one document + tenant, so nothing else is reachable.
 */
router.get(
  '/documents/:token',
  asyncHandler(async (req, res) => {
    const payload = verifyShareToken(req.params.token);
    if (!payload) throw new AppError('This link is invalid or has expired.', 410, 'SHARE_LINK_INVALID');

    const { kind, id, tenantId } = payload;
    const settings = await getSettings(tenantId);
    let buffer;
    let fileName;

    if (kind === 'RECEIPT') {
      const receipt = await prisma.receipt.findFirst({
        where: { id, tenantId }, // scoped by the token's own tenant
        include: { customer: true, invoice: true, payment: true },
      });
      if (!receipt) throw errors.notFound('Document not found.');
      if (receipt.status === 'VOID') throw errors.badRequest('This receipt has been voided.');
      buffer = await buildDocumentPdf({
        kind: 'RECEIPT',
        document: receipt,
        customer: receipt.customer,
        settings,
        payment: receipt.payment,
        invoice: receipt.invoice,
      });
      fileName = receipt.receiptNumber;
    } else if (kind === 'CREDIT_NOTE') {
      const creditNote = await prisma.creditNote.findFirst({
        where: { id, tenantId },
        include: { customer: true, items: true, invoice: { select: { id: true, invoiceNumber: true } } },
      });
      if (!creditNote) throw errors.notFound('Document not found.');
      if (creditNote.status === 'VOID') throw errors.badRequest('This credit note has been voided.');
      buffer = await buildDocumentPdf({
        kind: 'CREDIT_NOTE',
        document: creditNote,
        customer: creditNote.customer,
        settings,
        items: creditNote.items,
      });
      fileName = creditNote.creditNoteNumber;
    } else if (kind === 'QUOTATION') {
      const quotation = await prisma.quotation.findFirst({
        where: { id, tenantId },
        include: { customer: true, items: true },
      });
      if (!quotation) throw errors.notFound('Document not found.');
      buffer = await buildDocumentPdf({
        kind: 'QUOTATION',
        document: quotation,
        customer: quotation.customer,
        settings,
        items: quotation.items,
      });
      fileName = quotation.quotationNumber;
    } else {
      const invoice = await prisma.invoice.findFirst({
        where: { id, tenantId },
        include: { customer: true, items: true },
      });
      if (!invoice) throw errors.notFound('Document not found.');
      buffer = await buildDocumentPdf({
        kind: 'INVOICE',
        document: invoice,
        customer: invoice.customer,
        settings,
        items: invoice.items,
      });
      fileName = invoice.invoiceNumber;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(buffer);
  })
);

/**
 * GET /api/public/referral/:code
 *
 * Lets the register page greet an invited visitor ("Invited by Zarox Energy").
 * Unknown, disabled and exhausted codes all come back `valid: false`, so this
 * cannot be used to enumerate working codes.
 */
router.get(
  '/referral/:code',
  asyncHandler(async (req, res) => {
    const info = await validateCode(req.params.code);
    res.json({ success: true, data: info });
  })
);

export default router;
