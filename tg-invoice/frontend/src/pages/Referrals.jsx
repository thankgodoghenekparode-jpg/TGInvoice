import { useEffect, useState } from 'react';
import { Copy, Gift, Link2, Plus, Power, Trash2, Users } from 'lucide-react';
import { apiMessage } from '../services/api.js';
import {
  createReferralCode, deleteReferralCode, getReferralOverview, updateReferralCode,
} from '../services/referrals.js';
import { useSettings } from '../hooks/useSettings.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, PageHeader, Select, StatCard,
} from '../components/ui.jsx';

/**
 * The referral dashboard: your codes, the businesses they brought in, and what
 * you have earned. Owner/admin only — the server enforces that too.
 */

const STATUS_STYLE = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  ACTIVE: 'bg-sky-50 text-sky-700 ring-sky-200',
  REWARDED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  EXPIRED: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const STATUS_LABEL = { PENDING: 'Pending', ACTIVE: 'Active', REWARDED: 'Rewarded', EXPIRED: 'Expired' };

const rewardText = (code) =>
  code.rewardType === 'FIXED' ? code.rewardValue : `${code.rewardValue}%`;

const blank = () => ({ rewardType: 'PERCENT', rewardValue: '', maxUses: '', code: '' });

export default function ReferralsPage() {
  const { money } = useSettings();
  const { role } = useAuth();
  const toast = useToast();
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      setData(await getReferralOverview());
    } catch (err) {
      toast.error(apiMessage(err, 'Could not load your referral programme.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canManage) return undefined;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const codes = data?.codes ?? [];
  const referrals = data?.referrals ?? [];
  const stats = data?.stats ?? { codes: 0, total: 0, byStatus: {}, totalReward: 0 };

  if (!canManage) {
    return (
      <div className="space-y-5">
        <PageHeader title="Referrals" subtitle="Share your code with other businesses and earn a reward for each one that joins." />
        <Card>
          <div className="px-5 py-8">
            <EmptyState
              icon={Gift}
              title="Owner or admin access needed"
              description="Invite codes and referral rewards are managed by the business owner and admins. Ask one of them to grant you access."
            />
          </div>
        </Card>
      </div>
    );
  }

  const copyLink = async (shareUrl, code) => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(`Invite link for ${code} copied.`);
    } catch {
      toast.error('Copy the link from your browser address bar instead.');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        rewardType: editing.rewardType,
        rewardValue: Number(editing.rewardValue),
        code: editing.code.trim() || undefined,
        maxUses: editing.maxUses === '' ? null : Number(editing.maxUses),
      };
      if (editing.id) {
        await updateReferralCode(editing.id, payload);
        toast.success('Referral code updated.');
      } else {
        await createReferralCode(payload);
        toast.success('Referral code created — share it to start earning.');
      }
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(apiMessage(err, 'Could not save the referral code.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (code) => {
    setBusyId(code.id);
    try {
      await updateReferralCode(code.id, { active: !code.active });
      toast.success(code.active ? `${code.code} switched off.` : `${code.code} switched on.`);
      await load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not update that code.'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteReferralCode(toDelete.id);
      toast.success(`${toDelete.code} deleted.`);
      setToDelete(null);
      await load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete that code.'));
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !data) return <LoadingBlock label="Loading your referral programme…" />;

  const kpis = [
    { label: 'Invite codes', value: stats.codes, sub: 'codes you can share', icon: Link2, tone: 'brand' },
    { label: 'Businesses referred', value: stats.total, sub: `${stats.byStatus.ACTIVE ?? 0} active`, icon: Users, tone: 'sky' },
    { label: 'Awaiting qualification', value: stats.byStatus.PENDING ?? 0, sub: 'they need to send a first invoice', icon: Gift, tone: 'amber' },
    { label: 'Rewards earned', value: money(stats.totalReward), sub: `${stats.byStatus.REWARDED ?? 0} rewarded`, icon: Gift, tone: 'green' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Referrals"
        subtitle="Share your code with other businesses. When they join and start invoicing, you earn a reward."
        actions={
          <Button onClick={() => { setFormError(''); setEditing(blank()); }}>
            <Plus className="size-4" /> New referral code
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <StatCard key={k.label} label={k.label} value={k.value} sub={k.sub} icon={k.icon} tone={k.tone} />
        ))}
      </div>

      {/* ── Codes ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Your invite codes"
          subtitle="Each code carries its own reward and usage limit."
          action={
            <Button variant="secondary" size="sm" onClick={() => { setFormError(''); setEditing(blank()); }}>
              <Plus className="size-4" /> New code
            </Button>
          }
        />
        {codes.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={Link2}
              title="No invite codes yet"
              description="Create a code, share the link, and any business that signs up through it is attributed to you."
              action={<Button size="sm" onClick={() => setEditing(blank())}><Plus className="size-4" /> Create your first code</Button>}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Code</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reward</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Uses</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {codes.map((code) => (
                  <tr key={code.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                      <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[13px] tracking-wide">{code.code}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{rewardText(code)}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 tabular-nums">
                      {code.uses}{code.maxUses != null ? ` / ${code.maxUses}` : ''}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Badge className={code.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}>
                        {code.active ? 'Active' : 'Off'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Copy invite link"
                          onClick={() => copyLink(code.shareUrl, code.code)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600"
                        >
                          <Copy className="size-4" />
                        </button>
                        <button
                          type="button"
                          title={code.active ? 'Switch off' : 'Switch on'}
                          disabled={busyId === code.id}
                          onClick={() => toggleActive(code)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600 disabled:opacity-50"
                        >
                          <Power className="size-4" />
                        </button>
                        <button
                          type="button"
                          title="Edit reward"
                          onClick={() => { setFormError(''); setEditing({ ...code, rewardValue: String(code.rewardValue), maxUses: code.maxUses ?? '', code: code.code }); }}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600"
                        >
                          <Link2 className="size-4" />
                        </button>
                        <button
                          type="button"
                          title="Delete code"
                          onClick={() => setToDelete(code)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Referrals ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Businesses you referred" subtitle="A referral qualifies once the business sends its first invoice." />
        {referrals.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={Users}
              title="Nobody referred yet"
              description="Copy an invite link above — referred businesses will appear here with their status and reward."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Business</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Code</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reward</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Referred on</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {referrals.map((ref) => (
                  <tr key={ref.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{ref.referred?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-500">{ref.code?.code ?? '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge className={STATUS_STYLE[ref.status] || STATUS_STYLE.EXPIRED}>{STATUS_LABEL[ref.status] || ref.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {ref.status === 'REWARDED' ? money(ref.rewardAmount) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-slate-500">
                      {ref.referred?.createdAt ? new Date(ref.referred.createdAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Create / edit code ─────────────────────────────────────── */}
      <Modal
        open={!!editing}
        onClose={() => (saving ? null : setEditing(null))}
        title={editing?.id ? `Edit ${editing.code}` : 'New referral code'}
        description="Share this code (or its link) with another business. You can change the reward later, but not once it is in use."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} loading={saving} disabled={!editing?.rewardValue && editing?.rewardType !== 'FIXED'}>
              {editing?.id ? 'Save changes' : 'Create code'}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            {formError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{formError}</div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Reward type" required>
                <Select value={editing.rewardType} onChange={(e) => setEditing((f) => ({ ...f, rewardType: e.target.value }))}>
                  <option value="PERCENT">Percentage of the plan value</option>
                  <option value="FIXED">Fixed amount</option>
                </Select>
              </Field>
              <Field
                label={editing.rewardType === 'PERCENT' ? 'Percentage' : 'Amount'}
                required
                hint={editing.rewardType === 'PERCENT' ? 'Between 1 and 100.' : 'Credited in your platform currency.'}
                error={editing.rewardType === 'PERCENT' && Number(editing.rewardValue) > 100 ? 'Maximum 100%.' : undefined}
              >
                <input
                  className="input"
                  type="number"
                  min="0"
                  max={editing.rewardType === 'PERCENT' ? 100 : undefined}
                  step="1"
                  value={editing.rewardValue}
                  onChange={(e) => setEditing((f) => ({ ...f, rewardValue: e.target.value }))}
                  placeholder={editing.rewardType === 'PERCENT' ? '10' : '5000'}
                  required
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Usage limit" hint="Leave empty for unlimited use.">
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={editing.maxUses}
                  onChange={(e) => setEditing((f) => ({ ...f, maxUses: e.target.value }))}
                  placeholder="Unlimited"
                />
              </Field>
              <Field label="Custom code" hint={`Letters and numbers only, up to 16.${editing.id ? ' Cannot change an existing code.' : ''}`}>
                <input
                  className="input font-mono uppercase"
                  value={editing.code}
                  onChange={(e) => setEditing((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                  placeholder="Leave empty to generate"
                  disabled={!!editing.id}
                  maxLength={16}
                />
              </Field>
            </div>
            {!editing.id && editing.rewardType === 'PERCENT' && (
              <p className="text-xs text-slate-400">
                Percentage rewards are calculated from the plan value recorded on the platform when a reward is credited.
              </p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => (deleting ? null : setToDelete(null))}
        onConfirm={confirmDelete}
        title="Delete this invite code?"
        message={toDelete ? `${toDelete.code} will stop working. Codes that have already been used cannot be deleted — switch them off instead.` : ''}
        confirmLabel="Delete code"
        danger
        loading={deleting}
      />
    </div>
  );
}
