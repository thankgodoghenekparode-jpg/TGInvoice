import { Router } from 'express';
import { validate } from '../middleware/errorHandler.js';
import { quotationSchema, invoiceSchema, paymentSchema } from '../validators/documentValidators.js';
import * as q from '../controllers/quotationController.js';
import * as inv from '../controllers/invoiceController.js';
import * as receipts from '../controllers/receiptController.js';
import * as payments from '../controllers/paymentController.js';
import * as reports from '../controllers/reportController.js';
import * as messaging from '../controllers/messagingController.js';

/* ── Quotations ───────────────────────────────────────────────────── */

export const quotationRouter = Router();
quotationRouter.get('/', q.listQuotations);
quotationRouter.get('/:id', q.getQuotation);
quotationRouter.get('/:id/pdf', q.quotationPdf);
quotationRouter.post('/', validate(quotationSchema), q.createQuotation);
quotationRouter.put('/:id', validate(quotationSchema), q.updateQuotation);
quotationRouter.delete('/:id', q.deleteQuotation);
quotationRouter.post('/:id/duplicate', q.duplicateQuotation);
quotationRouter.post('/:id/convert', q.convertQuotation);
quotationRouter.put('/:id/status', q.updateQuotationStatus);
quotationRouter.post('/:id/email', q.quotationEmail);
quotationRouter.get('/:id/share', q.quotationShare);
quotationRouter.post('/:id/deliver', messaging.deliver_document('QUOTATION'));

/* ── Invoices ─────────────────────────────────────────────────────── */

export const invoiceRouter = Router();
invoiceRouter.get('/', inv.listInvoices);
invoiceRouter.get('/:id', inv.getInvoice);
invoiceRouter.get('/:id/pdf', inv.invoicePdf);
invoiceRouter.get('/:id/payments', inv.listInvoicePayments);
invoiceRouter.post('/', validate(invoiceSchema), inv.createInvoice);
invoiceRouter.put('/:id', validate(invoiceSchema), inv.updateInvoice);
invoiceRouter.delete('/:id', inv.deleteInvoice);
invoiceRouter.post('/:id/cancel', inv.cancelInvoice);
invoiceRouter.post('/:id/void', inv.voidInvoice);
invoiceRouter.post('/:id/send', inv.markInvoiceSent);
invoiceRouter.post('/:id/payments', validate(paymentSchema), inv.recordPayment);
invoiceRouter.post('/:id/email', inv.invoiceEmail);
invoiceRouter.get('/:id/share', inv.invoiceShare);
invoiceRouter.post('/:id/deliver', messaging.deliver_document('INVOICE'));

/* ── Receipts ─────────────────────────────────────────────────────── */

export const receiptRouter = Router();
receiptRouter.get('/', receipts.listReceipts);
receiptRouter.get('/:id', receipts.getReceipt);
receiptRouter.get('/:id/pdf', receipts.receiptPdf);
receiptRouter.post('/:id/void', receipts.voidReceipt);
receiptRouter.post('/:id/email', receipts.receiptEmail);
receiptRouter.get('/:id/share', receipts.receiptShare);
receiptRouter.post('/:id/deliver', messaging.deliver_document('RECEIPT'));

/* ── Payments (tenant-wide history) ───────────────────────────────── */

export const paymentRouter = Router();
paymentRouter.get('/', payments.listPayments);

/* ── Reports ──────────────────────────────────────────────────────── */

export const reportRouter = Router();
reportRouter.get('/dashboard', reports.dashboard);
reportRouter.get('/invoices', reports.invoiceReport);
reportRouter.get('/payments', reports.paymentReport);
reportRouter.get('/quotations', reports.quotationReport);
reportRouter.get('/customers', reports.customerReport);
