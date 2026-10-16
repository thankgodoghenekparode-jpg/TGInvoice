# TG Invoice — Scaling Roadmap

Tracking doc for the marketplace-scale work. Each item lists status and the
main files it touches. Keep this current as features land.

Legend: ✅ done · 🟡 partial · ⬜ planned

## Foundations (must come before features)
- ✅ Background job queue (DB-backed, `FOR UPDATE SKIP LOCKED`) + worker process — `src/services/jobService.js`, `src/worker.js`, `src/services/schedulerService.js`
- ✅ In-process scheduler (no external cron): recurring + dunning scans
- ✅ Per-tenant rate limiting — `src/middleware/security.js`
- ✅ Cache service (in-memory default, optional Redis driver) — `src/services/cacheService.js`
- ✅ Feature flags — `FeatureFlag` model + `/api/flags`
- ✅ CI/CD — `.github/workflows/ci.yml`, `deploy.yml`
- ✅ Neon / PgBouncer / read-replica guidance — README §11, `src/prisma.js`
- ✅ Analytics hook (PostHog, env-gated) — `frontend/src/services/analytics.js`

## Features
- ✅ Automated WhatsApp (Cloud API) + SMS delivery — `src/services/messagingService.js`, `MessageLog`
- ✅ Recurring invoices + automated reminders (dunning) — `src/services/recurringService.js`, `src/services/reminderService.js`, `RecurringInvoice`, `ReminderRule`, `ReminderSent`; UI at `/recurring` and `/settings/reminders`
- ✅ Attachments on documents — `src/controllers/attachmentController.js`, `src/services/attachmentService.js`, `src/services/storageService.js`, `Attachment`; UI panel on every document detail page
- ✅ Custom fields + document templates — `src/controllers/customFieldController.js`, `src/controllers/documentTemplateController.js`, `src/services/customFieldService.js`, `src/services/templateService.js`; typed/validated values, print-on-PDF, per-kind accent/logo/bank/notes applied in `pdfService`; UI at `/settings/custom-fields`, `/settings/templates` and a panel on every detail page
- ✅ CSV/Excel import (customers, products) — `src/controllers/importController.js`, `src/services/importService.js`, `src/routes/import.routes.js`; preview-then-commit, typed validation, tenant-scoped create/update dedupe, native CSV + exceljs `.xlsx`; UI at `/settings/import`
- ✅ Credit notes / refunds / void — `src/controllers/creditNoteController.js`, `src/controllers/refundController.js`, `CreditNote`, `Refund`; UI at `/credit-notes` and `/refunds`
- ✅ Referrals/affiliates + reseller/accountant program — `src/services/referralService.js`, `src/services/partnerService.js`, `ReferralCode`, `Referral`, `Partner`; self-serve codes at `/referrals`, `?ref=` attribution on signup, qualification job, partner management in `/admin` → Growth; rewards credited once by a platform admin
- ✅ Payments: Paystack/Flutterwave links + webhook reconciliation — `src/services/paymentGateway.js`, `src/services/paymentService.js`, `src/routes/webhook.routes.js`, `paymentController.js`, `PaymentIntent`; "New payment link" panel on the invoice page, signature-verified webhooks settle the invoice (Payment + Receipt), hourly `payments.reconcile` job catches missed webhooks
