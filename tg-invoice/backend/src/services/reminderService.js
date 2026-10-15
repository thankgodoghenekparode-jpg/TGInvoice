import { prisma } from '../prisma.js';
import { formatMoney, formatDate } from '../utils/format.js';
import { deliver, isChannelConfigured } from './messagingService.js';
import { getSettings, previewUrlFor } from './documentService.js';

/**
 * Automated payment reminders (dunning).
 *
 * A tenant defines rules ("3 days before due", "on the due date", "7 days
 * after"). The worker scans unpaid invoices and, for every rule whose fire date
 * has passed, sends the configured channels and records a ReminderSent row —
 * whose (ruleId, invoiceId) unique key makes re-runs safe: an invoice is chased
 * at most once per rule, however often the scanner runs.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses that still owe money and can therefore be chased. */
const CHASEABLE = ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'OVERDUE'];

function fillTemplate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? vars[key] : ''));
}

export function buildReminderMessage(rule, { invoice, customer, settings }) {
  const meta = {
    customer: customer?.name || 'there',
    business: settings.businessName || 'our business',
    number: invoice.invoiceNumber,
    amount: formatMoney(invoice.balanceDue, settings),
    total: formatMoney(invoice.total, settings),
    dueDate: invoice.dueDate ? formatDate(invoice.dueDate) : 'the due date',
    link: previewUrlFor({ kind: 'INVOICE', document: invoice }),
  };

  const fallback = [
    `Hello ${meta.customer},`,
    '',
    `This is a reminder that invoice ${meta.number} from ${meta.business} has an outstanding balance of ${meta.amount}${
      invoice.dueDate ? `, due ${meta.dueDate}` : ''
    }.`,
    '',
    `View or pay it here: ${meta.link}`,
    '',
    'Thank you.',
  ].join('\n');

  const body = rule.bodyTemplate ? fillTemplate(rule.bodyTemplate, meta) : fallback;
  const subject = rule.subject ? fillTemplate(rule.subject, meta) : `Payment reminder — invoice ${meta.number}`;
  return { body, subject, meta };
}

/** Invoices whose fire date for this rule has passed and that haven't been sent it yet. */
async function pendingForRule(rule, limit) {
  const fireThreshold = new Date(Date.now() - rule.offsetDays * DAY_MS);
  const sent = await prisma.reminderSent.findMany({
    where: { ruleId: rule.id },
    select: { invoiceId: true },
  });
  const alreadySent = sent.map((s) => s.invoiceId);

  return prisma.invoice.findMany({
    where: {
      tenantId: rule.tenantId,
      status: { in: CHASEABLE },
      balanceDue: { gt: 0 },
      dueDate: { not: null, lte: fireThreshold },
      ...(alreadySent.length ? { id: { notIn: alreadySent } } : {}),
    },
    include: { customer: true },
    orderBy: { dueDate: 'asc' },
    take: limit,
  });
}

/** Send one rule's outstanding reminders. Returns { sent, skipped, failed }. */
async function processRule(rule, { limit = 25 } = {}) {
  const settings = await getSettings(rule.tenantId);
  const channels = (rule.channels || []).filter(isChannelConfigured);
  const report = { sent: 0, skipped: 0, failed: 0 };

  if (!channels.length) {
    // Nothing to send, but do not mark invoices as reminded — the rule may be
    // enabled again once a provider is configured.
    return report;
  }

  const invoices = await pendingForRule(rule, limit);
  for (const invoice of invoices) {
    const { body, subject } = buildReminderMessage(rule, { invoice, customer: invoice.customer, settings });
    const recipients = { EMAIL: invoice.customer?.email, WHATSAPP: invoice.customer?.phone, SMS: invoice.customer?.phone };
    const link = previewUrlFor({ kind: 'INVOICE', document: invoice });

    let delivered = false;
    for (const channel of channels) {
      const to = recipients[channel];
      if (!to) continue;
      const result = await deliver({
        tenantId: rule.tenantId,
        channel,
        to,
        text: body,
        subject,
        documentLink: link,
        fileName: invoice.invoiceNumber,
        documentKind: 'INVOICE',
        documentId: invoice.id,
        customerId: invoice.customerId,
      });
      if (result.sent) delivered = true;
    }

    // Record the attempt so we never chase this invoice for this rule twice.
    await prisma.reminderSent
      .create({
        data: {
          tenantId: rule.tenantId,
          ruleId: rule.id,
          invoiceId: invoice.id,
          stage: rule.stage,
          channels,
        },
      })
      .then(() => {
        if (delivered) report.sent += 1;
        else report.skipped += 1;
      })
      .catch((err) => {
        if (err?.code === 'P2002') return; // another worker got there first
        report.failed += 1;
        console.error(`[reminders] record ${rule.id}/${invoice.id}:`, err?.message);
      });
  }

  return report;
}

/** Entry point for the scheduler job. Pass `tenantId` to scope to one business. */
export async function runDueReminders({ limitPerRule = 25, tenantId = null } = {}) {
  const rules = await prisma.reminderRule.findMany({
    where: { enabled: true, ...(tenantId ? { tenantId } : {}) },
  });
  const summary = { rules: rules.length, sent: 0, skipped: 0, failed: 0 };

  for (const rule of rules) {
    try {
      const report = await processRule(rule, { limit: limitPerRule });
      summary.sent += report.sent;
      summary.skipped += report.skipped;
      summary.failed += report.failed;
    } catch (err) {
      console.error(`[reminders] rule ${rule.id}:`, err?.message);
    }
  }

  return summary;
}

/** How many invoices each rule is currently due to chase (for the UI). */
export async function previewReminders(tenantId) {
  const rules = await prisma.reminderRule.findMany({ where: { tenantId }, orderBy: { offsetDays: 'asc' } });
  const out = [];
  for (const rule of rules) {
    const pending = rule.enabled ? await pendingForRule(rule, 1000) : [];
    out.push({
      ruleId: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      stage: rule.stage,
      offsetDays: rule.offsetDays,
      channels: rule.channels,
      dueCount: pending.length,
      sample: pending.slice(0, 5).map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, dueDate: i.dueDate, balanceDue: Number(i.balanceDue) })),
    });
  }
  return out;
}

export { CHASEABLE };
