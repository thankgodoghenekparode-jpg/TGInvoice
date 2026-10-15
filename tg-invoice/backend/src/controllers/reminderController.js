import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import { runDueReminders, previewReminders } from '../services/reminderService.js';

/**
 * Dunning (payment reminder) rules.
 *
 * `offsetDays` is signed relative to the due date and, together with `stage`,
 * describes when the reminder fires:
 *   BEFORE_DUE  -3  → three days before the invoice is due
 *   ON_DUE       0  → on the due date
 *   AFTER_DUE    7  → a week after it was due
 * Each rule chases an invoice at most once (enforced by ReminderSent).
 */

const CHANNELS = ['EMAIL', 'WHATSAPP', 'SMS'];

const normalize = (b) => ({
  name: b.name,
  enabled: b.enabled,
  stage: b.stage,
  offsetDays: b.offsetDays,
  channels: [...new Set((b.channels || []).filter((c) => CHANNELS.includes(c)))],
  subject: b.subject || null,
  bodyTemplate: b.bodyTemplate || null,
});

/* ── GET /api/reminder-rules ──────────────────────────────────────── */

export const listRules = asyncHandler(async (req, res) => {
  const rules = await prisma.reminderRule.findMany({
    where: { tenantId: req.tenant.id },
    orderBy: [{ offsetDays: 'asc' }, { createdAt: 'asc' }],
  });
  ok(res, rules);
});

/* ── POST /api/reminder-rules ─────────────────────────────────────── */

export const createRule = asyncHandler(async (req, res) => {
  const rule = await prisma.reminderRule.create({
    data: { tenantId: req.tenant.id, ...normalize(req.validatedBody) },
  });
  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_REMINDER_RULE', 'reminder_rule', {
    entityId: rule.id,
    entityLabel: rule.name,
    description: `${req.user.name} created reminder rule "${rule.name}"`,
  });
  created(res, rule);
});

/* ── PUT /api/reminder-rules/:id ──────────────────────────────────── */

export const updateRule = asyncHandler(async (req, res) => {
  const existing = await prisma.reminderRule.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Reminder rule not found.');

  const rule = await prisma.reminderRule.update({
    where: { id: existing.id },
    data: normalize(req.validatedBody),
  });
  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_REMINDER_RULE', 'reminder_rule', {
    entityId: rule.id,
    entityLabel: rule.name,
    description: `${req.user.name} updated reminder rule "${rule.name}"`,
  });
  ok(res, rule);
});

/* ── DELETE /api/reminder-rules/:id ───────────────────────────────── */

export const deleteRule = asyncHandler(async (req, res) => {
  const existing = await prisma.reminderRule.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Reminder rule not found.');
  await prisma.reminderRule.delete({ where: { id: existing.id } });
  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'DELETE_REMINDER_RULE', 'reminder_rule', {
    entityId: existing.id,
    entityLabel: existing.name,
    description: `${req.user.name} deleted reminder rule "${existing.name}"`,
  });
  ok(res, { id: existing.id });
});

/* ── GET /api/reminder-rules/preview ──────────────────────────────── */

export const preview = asyncHandler(async (req, res) => {
  ok(res, await previewReminders(req.tenant.id));
});

/* ── POST /api/reminder-rules/run — send now (respects the schedule) ─ */

export const runNow = asyncHandler(async (req, res) => {
  const summary = await runDueReminders({ tenantId: req.tenant.id });
  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'RUN_REMINDERS', 'reminder_rule', {
    description: `${req.user.name} ran payment reminders (${summary.sent} sent, ${summary.skipped} skipped)`,
  });
  ok(res, summary);
});
