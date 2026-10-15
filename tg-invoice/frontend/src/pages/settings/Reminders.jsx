import { useEffect, useState } from 'react';
import { BellRing, Clock, Plus, Send, Trash2, PencilLine } from 'lucide-react';
import clsx from 'clsx';
import { apiMessage } from '../../services/api.js';
import { reminderApi, REMINDER_STAGES, CHANNEL_LABELS, offsetLabel } from '../../services/billing.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, Select,
} from '../../components/ui.jsx';

const CHANNELS = ['EMAIL', 'WHATSAPP', 'SMS'];

const blank = () => ({
  name: '',
  enabled: true,
  stage: 'AFTER_DUE',
  offsetDays: 7,
  channels: ['EMAIL'],
  subject: '',
  bodyTemplate: '',
});

export default function RemindersPage() {
  const { money } = useSettings();
  const toast = useToast();

  const [rules, setRules] = useState([]);
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(null); // { id?, ...form }
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [list, prev] = await Promise.all([reminderApi.list(), reminderApi.preview()]);
      setRules(list);
      setPreview(prev);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not load reminder rules.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dueFor = (ruleId) => preview.find((p) => p.ruleId === ruleId);

  const openNew = () => setEditing(blank());
  const openEdit = (rule) => setEditing({
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    stage: rule.stage,
    offsetDays: rule.offsetDays,
    channels: rule.channels?.length ? [...rule.channels] : ['EMAIL'],
    subject: rule.subject || '',
    bodyTemplate: rule.bodyTemplate || '',
  });

  const toggleChannel = (ch) => {
    setEditing((f) => ({
      ...f,
      channels: f.channels.includes(ch) ? f.channels.filter((c) => c !== ch) : [...f.channels, ch],
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    if (!editing) return;
    if (!editing.name.trim()) return toast.error('Give this reminder a name.');
    if (!editing.channels.length) return toast.error('Choose at least one channel.');
    if (editing.stage === 'ON_DUE') editing.offsetDays = 0;

    setSaving(true);
    const payload = {
      name: editing.name.trim(),
      enabled: editing.enabled,
      stage: editing.stage,
      offsetDays: Number(editing.offsetDays) || 0,
      channels: editing.channels,
      subject: editing.subject,
      bodyTemplate: editing.bodyTemplate,
    };
    try {
      if (editing.id) await reminderApi.update(editing.id, payload);
      else await reminderApi.create(payload);
      toast.success(editing.id ? 'Reminder updated.' : 'Reminder created.');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save the reminder.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (rule) => {
    const payload = {
      name: rule.name,
      enabled: !rule.enabled,
      stage: rule.stage,
      offsetDays: rule.offsetDays,
      channels: rule.channels,
      subject: rule.subject || '',
      bodyTemplate: rule.bodyTemplate || '',
    };
    try {
      await reminderApi.update(rule.id, payload);
      setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    } catch (err) {
      toast.error(apiMessage(err, 'Could not update the reminder.'));
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const summary = await reminderApi.runNow();
      toast.success(
        summary.sent + summary.skipped === 0
          ? 'Nothing was due for a reminder right now.'
          : `Reminders sent: ${summary.sent} delivered, ${summary.skipped} skipped, ${summary.failed} failed.`
      );
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not run reminders.'));
    } finally {
      setRunning(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await reminderApi.remove(toDelete.id);
      toast.success(`Reminder “${toDelete.name}” deleted.`);
      setToDelete(null);
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete the reminder.'));
    } finally {
      setDeleting(false);
    }
  };

  const totalDue = preview.reduce((sum, p) => sum + (p.enabled ? p.dueCount : 0), 0);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Payment reminders"
        subtitle="Chase unpaid invoices automatically — before they’re due, on the day, or after."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={runNow} loading={running}>
              <Send size={15} /> Send due now
            </Button>
            <Button size="sm" onClick={openNew}>
              <Plus size={15} /> New reminder
            </Button>
          </>
        }
      />

      <div className="mb-4 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 to-white px-5 py-4">
        <p className="text-sm font-medium text-slate-700">
          {totalDue > 0 ? `${totalDue} invoice${totalDue === 1 ? '' : 's'} are due a reminder right now.` : 'No invoices are due a reminder right now.'}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Reminders run automatically from the background worker. “Send due now” only sends what the schedule already calls for.
        </p>
      </div>

      {loading ? (
        <LoadingBlock label="Loading reminders…" />
      ) : rules.length === 0 ? (
        <Card>
          <EmptyState
            icon={BellRing}
            title="No reminders yet"
            description="Add a reminder like “7 days after due” and TG Invoice will nudge the customer for you."
            action={<Button size="sm" onClick={openNew}><Plus size={15} /> New reminder</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => {
            const due = dueFor(rule.id);
            return (
              <Card key={rule.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{rule.name}</h3>
                      <Badge className={rule.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200'}>
                        {rule.enabled ? 'on' : 'paused'}
                      </Badge>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-500">
                      <span className="inline-flex items-center gap-1"><Clock size={13} /> {offsetLabel(rule)}</span>
                      <span>·</span>
                      <span>{rule.channels.map((c) => CHANNEL_LABELS[c] || c).join(', ') || 'no channels'}</span>
                    </p>
                    {due && due.enabled && due.sample?.length > 0 && (
                      <p className="mt-2 text-xs text-slate-400">
                        {due.dueCount} invoice{due.dueCount === 1 ? '' : 's'} queued — e.g.{' '}
                        {due.sample.map((s) => `${s.invoiceNumber} (${money(s.balanceDue)})`).join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleEnabled(rule)}
                      className={clsx(
                        'rounded-lg px-2 py-1 text-xs font-medium',
                        rule.enabled ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'
                      )}
                    >
                      {rule.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button type="button" title="Edit" onClick={() => openEdit(rule)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                      <PencilLine size={15} />
                    </button>
                    <button type="button" title="Delete" onClick={() => setToDelete(rule)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader
          title="How reminders work"
          subtitle="Each invoice is chased at most once per reminder, so duplicates are impossible."
        />
        <div className="space-y-2 p-5 text-[13px] leading-relaxed text-slate-600">
          <p>Reminders are delivered on the channels you choose: <b>WhatsApp</b>, <b>SMS</b> and <b>email</b>.</p>
          <p>
            Use these placeholders in your message:{' '}
            <code className="rounded bg-slate-100 px-1">{'{customer}'}</code>{' '}
            <code className="rounded bg-slate-100 px-1">{'{business}'}</code>{' '}
            <code className="rounded bg-slate-100 px-1">{'{number}'}</code>{' '}
            <code className="rounded bg-slate-100 px-1">{'{amount}'}</code>{' '}
            <code className="rounded bg-slate-100 px-1">{'{total}'}</code>{' '}
            <code className="rounded bg-slate-100 px-1">{'{dueDate}'}</code>{' '}
            <code className="rounded bg-slate-100 px-1">{'{link}'}</code>
          </p>
          <p>Leave the message blank to use a friendly default that already includes the amount and a secure payment link.</p>
        </div>
      </Card>

      {/* Create / edit modal */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit reminder' : 'New reminder'}
        description="When should TG Invoice chase an unpaid invoice?"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving}>{editing?.id ? 'Save reminder' : 'Create reminder'}</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Field label="Name" required>
              <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Final notice" autoFocus />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="When">
                <Select
                  value={editing.stage}
                  onChange={(e) => setEditing({ ...editing, stage: e.target.value, offsetDays: e.target.value === 'ON_DUE' ? 0 : editing.offsetDays })}
                >
                  {REMINDER_STAGES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Days" hint={editing.stage === 'ON_DUE' ? 'Not used — fires on the due date.' : 'How many days before/after the due date.'}>
                <input
                  type="number"
                  min="0"
                  max="365"
                  className="input"
                  value={editing.offsetDays}
                  disabled={editing.stage === 'ON_DUE'}
                  onChange={(e) => setEditing({ ...editing, offsetDays: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Channels" required>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => toggleChannel(ch)}
                    className={clsx(
                      'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                      editing.channels.includes(ch)
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                    )}
                  >
                    {CHANNEL_LABELS[ch]}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Subject" hint="Used for email only.">
              <input className="input" value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} placeholder="Payment reminder — invoice {number}" />
            </Field>

            <Field label="Message" hint="Leave blank for a sensible default. Unsupported placeholders are left empty.">
              <textarea
                rows={5}
                className="input"
                value={editing.bodyTemplate}
                onChange={(e) => setEditing({ ...editing, bodyTemplate: e.target.value })}
                placeholder={'Hello {customer},\n\nInvoice {number} for {amount} was due on {dueDate}.\n\nView or pay it here: {link}'}
              />
            </Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        danger
        title="Delete reminder"
        confirmLabel="Delete"
        message={`Delete “${toDelete?.name}”? Invoices already reminded are unaffected.`}
      />
    </div>
  );
}
