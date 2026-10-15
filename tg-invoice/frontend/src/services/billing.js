import api from './api.js';

/** Recurring invoices + payment reminder (dunning) rules. */

export const recurringApi = {
  list: (params) => api.get('/recurring-invoices', { params }).then((r) => r.data),
  get: (id) => api.get(`/recurring-invoices/${id}`).then((r) => r.data.data),
  create: (body) => api.post('/recurring-invoices', body).then((r) => r.data.data),
  update: (id, body) => api.put(`/recurring-invoices/${id}`, body).then((r) => r.data.data),
  setStatus: (id, status) => api.patch(`/recurring-invoices/${id}/status`, { status }).then((r) => r.data.data),
  runNow: (id) => api.post(`/recurring-invoices/${id}/run`).then((r) => r.data.data),
  remove: (id) => api.delete(`/recurring-invoices/${id}`).then((r) => r.data),
};

export const reminderApi = {
  list: () => api.get('/reminder-rules').then((r) => r.data.data),
  preview: () => api.get('/reminder-rules/preview').then((r) => r.data.data),
  create: (body) => api.post('/reminder-rules', body).then((r) => r.data.data),
  update: (id, body) => api.put(`/reminder-rules/${id}`, body).then((r) => r.data.data),
  remove: (id) => api.delete(`/reminder-rules/${id}`).then((r) => r.data),
  runNow: () => api.post('/reminder-rules/run').then((r) => r.data.data),
};

export const FREQUENCY_LABELS = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMIANNUAL: 'Every 6 months',
  ANNUAL: 'Yearly',
};

export const REMINDER_STAGES = [
  { value: 'BEFORE_DUE', label: 'Before the due date' },
  { value: 'ON_DUE', label: 'On the due date' },
  { value: 'AFTER_DUE', label: 'After the due date' },
];

export const CHANNEL_LABELS = { EMAIL: 'Email', WHATSAPP: 'WhatsApp', SMS: 'SMS' };

/** Human summary of a schedule, e.g. "Every 2 months". */
export function scheduleLabel(rec) {
  const n = Number(rec.interval) || 1;
  if (n === 1) return FREQUENCY_LABELS[rec.frequency] || rec.frequency;
  const unit = { WEEKLY: 'weeks', MONTHLY: 'months', QUARTERLY: 'quarters', SEMIANNUAL: '6-month periods', ANNUAL: 'years' }[rec.frequency] || 'periods';
  return `Every ${n} ${unit}`;
}

/** Human summary of a reminder offset, e.g. "3 days after due". */
export function offsetLabel(rule) {
  const d = Math.abs(Number(rule.offsetDays) || 0);
  const dayWord = `${d} day${d === 1 ? '' : 's'}`;
  if (rule.stage === 'BEFORE_DUE') return `${dayWord} before due`;
  if (rule.stage === 'ON_DUE') return 'On the due date';
  return d === 0 ? 'When overdue' : `${dayWord} after due`;
}
