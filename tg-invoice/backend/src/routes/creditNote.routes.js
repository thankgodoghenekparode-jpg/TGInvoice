import { Router } from 'express';
import { validate } from '../middleware/errorHandler.js';
import { creditNoteSchema, applyCreditSchema, refundSchema } from '../validators/creditNoteValidators.js';
import * as creditNotes from '../controllers/creditNoteController.js';
import * as refunds from '../controllers/refundController.js';
import * as messaging from '../controllers/messagingController.js';

/* ── Credit notes ─────────────────────────────────────────────────── */

export const creditNoteRouter = Router();
creditNoteRouter.get('/', creditNotes.listCreditNotes);
creditNoteRouter.post('/', validate(creditNoteSchema), creditNotes.createCreditNote);
creditNoteRouter.get('/:id', creditNotes.getCreditNote);
creditNoteRouter.put('/:id', validate(creditNoteSchema), creditNotes.updateCreditNote);
creditNoteRouter.delete('/:id', creditNotes.deleteCreditNote);
creditNoteRouter.post('/:id/issue', creditNotes.issueCreditNote);
creditNoteRouter.post('/:id/void', creditNotes.voidCreditNote);
creditNoteRouter.post('/:id/apply', validate(applyCreditSchema), creditNotes.applyCreditNote);
creditNoteRouter.get('/:id/pdf', creditNotes.creditNotePdf);
creditNoteRouter.post('/:id/email', creditNotes.creditNoteEmail);
creditNoteRouter.get('/:id/share', creditNotes.creditNoteShare);
creditNoteRouter.post('/:id/deliver', messaging.deliver_document('CREDIT_NOTE'));

/* ── Refunds ──────────────────────────────────────────────────────── */

export const refundRouter = Router();
refundRouter.get('/', refunds.listRefunds);
refundRouter.post('/', validate(refundSchema), refunds.createRefund);
refundRouter.get('/:id', refunds.getRefund);
refundRouter.post('/:id/void', refunds.voidRefund);
