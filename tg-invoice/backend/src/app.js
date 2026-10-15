import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import config from './config.js';
import { securityHeaders, corsOptions, apiLimiter, tenantLimiter } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requireAuth, requireTenant } from './middleware/auth.js';

import authRoutes from './routes/auth.routes.js';
import publicRoutes from './routes/public.routes.js';
import adminRoutes from './routes/admin.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import {
  tenantRouter,
  invitationRouter,
  settingsRouter,
  customerRouter,
  productRouter,
  teamRouter,
  auditRouter,
  searchRouter,
  flagRouter,
  messageRouter,
} from './routes/core.routes.js';
import {
  quotationRouter,
  invoiceRouter,
  receiptRouter,
  paymentRouter,
  reportRouter,
} from './routes/document.routes.js';
import { recurringRouter, reminderRouter } from './routes/billing.routes.js';

const app = express();

// Render sits behind a proxy — required for correct IPs (rate limits) and cookies.
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(corsOptions);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', apiLimiter);

// Tenant logo files (local driver; swap for a CDN URL with the cloud driver).
app.use(
  '/uploads',
  express.static(path.resolve(process.cwd(), config.storage.localDir), { maxAge: '1d' })
);

app.get('/api/health', (_req, res) => {
  res.json({ success: true, service: 'tg-invoice-api', env: config.env, time: new Date().toISOString() });
});

/* ── Public / session routes (no tenant context needed) ───────────── */

app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRouter);
// Feature flags gate the login page too, so they are public (rollout only).
app.use('/api/flags', flagRouter);
// Notifications: per-user, tenant-free (platform operators have no business).
app.use('/api/notifications', notificationRoutes);
// Invitation token endpoints are public: the token itself is the credential.
app.use('/api/team/invitations', invitationRouter);
// Public document links: the signed, expiring token is the credential.
app.use('/api/public', publicRoutes);

/* ── Tenant-scoped routes ─────────────────────────────────────────── */
/* Every one of these runs: JWT → membership check → tenant context.
   Controllers then query exclusively with req.tenant.id.               */

const scoped = [requireAuth, requireTenant, tenantLimiter];

app.use('/api/settings', ...scoped, settingsRouter);
app.use('/api/customers', ...scoped, customerRouter);
app.use('/api/products', ...scoped, productRouter);
app.use('/api/quotations', ...scoped, quotationRouter);
app.use('/api/invoices', ...scoped, invoiceRouter);
app.use('/api/receipts', ...scoped, receiptRouter);
app.use('/api/payments', ...scoped, paymentRouter);
app.use('/api/reports', ...scoped, reportRouter);
app.use('/api/recurring-invoices', ...scoped, recurringRouter);
app.use('/api/reminder-rules', ...scoped, reminderRouter);
app.use('/api/team', ...scoped, teamRouter);
app.use('/api/audit-logs', ...scoped, auditRouter);
app.use('/api/search', ...scoped, searchRouter);
app.use('/api/messages', ...scoped, messageRouter);

/* ── Platform administration (super-admin) — hard-gated ───────────── */
/* Driven by User.isPlatformAdmin, which NO tenant-facing flow can set.
   Platform routes use requireAuth + requirePlatformAdmin only (no tenant). */

app.use('/api/admin', adminRoutes);

app.use('/api', notFoundHandler);
app.use(errorHandler);

export default app;
