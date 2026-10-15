import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  AlertCircle, Ban, Gift, Handshake, Plus, Power, RefreshCw, Search, Trash2,
} from 'lucide-react';
import { apiMessage } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Badge, Button, ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, Pagination, Select, Spinner, Tabs,
} from '../../components/ui.jsx';
import {
  createPartner, createPartnerCode, deletePartner, listAdminReferrals, listPartners,
  rewardReferral, updatePartner,
} from '../../services/referrals.js';
import { formatCompact } from '../../utils/currency.js';
import { formatDate } from '../../utils/dates.js';

/**
 * Growth — the platform's side of the referral program.
 *
 * Two tabs: partners (resellers / accountants / affiliates who own invite
 * codes) and the referral ledger (every business attributed to a code, plus
 * crediting rewards). Rendered inside the admin surface, so the caller has
 * already passed requirePlatformAdmin.
 */

const money = (value) => formatCompact(value, { currencySymbol: '₦' });

const TYPE_LABEL = { RESELLER: 'Reseller', ACCOUNTANT: 'Accountant', AFFILIATE: 'Affiliate' };

const STATUS_STYLE = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  ACTIVE: 'bg-sky-50 text-sky-700 ring-sky-200',
  REWARDED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  EXPIRED: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const STATUS_LABEL = { PENDING: 'Pending', ACTIVE: 'Active', REWARDED: 'Rewarded', EXPIRED: 'Expired' };

const blankPartner = () => ({
  name: '', type: 'AFFILIATE', email: '', phone: '', companyName: '', commissionRate: 0, notes: '',
});

const blankCode = () => ({ rewardType: 'PERCENT', rewardValue: '', maxUses: '' });

const th = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500';
const td = 'px-4 py-3 text-sm align-middle';

export default function GrowthPanel({ onRefreshOverview }) {
  const toast = useToast();

  const [tab, setTab] = useState('partners');

  const [partners, setPartners] = useState([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [partnersError, setPartnersError] = useState('');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [referrals, setReferrals] = useState({ rows: [], meta: null });
  const [referralsLoading, setReferralsLoading] = useState(true);
  const [referralsError, setReferralsError] = useState('');

  const [version, setVersion] = useState(0);

  const [partnerForm, setPartnerForm] = useState(null); // { id?, ...fields }
  const [codeFor, setCodeFor] = useState(null); // partner the code is being added to
  const [codeForm, setCodeForm] = useState(blankCode());
  const [rewardFor, setRewardFor] = useState(null); // referral being credited
  const [baseAmount, setBaseAmount] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  /* ── loads ──────────────────────────────────────────────────────── */

  const loadPartners = useCallback(async () => {
    setPartnersLoading(true);
    try {
      setPartners(await listPartners());
      setPartnersError('');
    } catch (err) {
      setPartnersError(apiMessage(err, 'Could not load partners.'));
    } finally {
      setPartnersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPartners();
  }, [loadPartners, version]);

  useEffect(() => {
    if (tab !== 'referrals') return undefined;
    let cancelled = false;
    setReferralsLoading(true);
    listAdminReferrals({ page, limit: 12, status: status || undefined })
      .then((res) => {
        if (cancelled) return;
        setReferrals(res);
        setReferralsError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setReferrals({ rows: [], meta: null });
        setReferralsError(apiMessage(err, 'Could not load referrals.'));
      })
      .finally(() => {
        if (!cancelled) setReferralsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, page, status, version]);

  const bump = () => {
    setVersion((v) => v + 1);
    onRefreshOverview?.();
  };

  /* ── partner actions ────────────────────────────────────────────── */

  const submitPartner = async (e) => {
    e.preventDefault();
    setBusy(true);
    setModalError('');
    try {
      const payload = {
        name: partnerForm.name.trim(),
        type: partnerForm.type,
        email: partnerForm.email.trim() || undefined,
        phone: partnerForm.phone.trim() || undefined,
        companyName: partnerForm.companyName.trim() || undefined,
        commissionRate: Number(partnerForm.commissionRate) || 0,
        notes: partnerForm.notes.trim() || undefined,
      };
      if (partnerForm.id) {
        await updatePartner(partnerForm.id, payload);
        toast.success('Partner updated.');
      } else {
        await createPartner(payload);
        toast.success('Partner added to the program.');
      }
      setPartnerForm(null);
      bump();
    } catch (err) {
      setModalError(apiMessage(err, 'Could not save the partner.'));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    setModalError('');
    try {
      await createPartnerCode(codeFor.id, {
        rewardType: codeForm.rewardType,
        rewardValue: Number(codeForm.rewardValue),
        maxUses: codeForm.maxUses === '' ? null : Number(codeForm.maxUses),
      });
      toast.success(`Invite code created for ${codeFor.name}.`);
      setCodeFor(null);
      setCodeForm(blankCode());
      bump();
    } catch (err) {
      setModalError(apiMessage(err, 'Could not create the code.'));
    } finally {
      setBusy(false);
    }
  };

  const togglePartner = async (partner) => {
    const suspending = partner.status === 'ACTIVE';
    setConfirm({
      title: suspending ? 'Suspend this partner?' : 'Reactivate this partner?',
      message: suspending
        ? `${partner.name} will stop being credited for new referrals. Existing codes keep working until you switch them off.`
        : `${partner.name} will be credited for referrals again.`,
      confirmLabel: suspending ? 'Suspend partner' : 'Reactivate',
      danger: suspending,
      run: async () => {
        setBusy(true);
        try {
          await updatePartner(partner.id, { status: suspending ? 'SUSPENDED' : 'ACTIVE' });
          toast.success(suspending ? `${partner.name} suspended.` : `${partner.name} reactivated.`);
          bump();
          return true;
        } catch (err) {
          toast.error(apiMessage(err, 'Could not update that partner.'));
          return false;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const removePartner = (partner) => {
    setConfirm({
      title: 'Delete this partner?',
      message: `${partner.name} will be removed. Partners who already own invite codes must be suspended instead — those codes are already out in the world.`,
      confirmLabel: 'Delete partner',
      danger: true,
      run: async () => {
        setBusy(true);
        try {
          await deletePartner(partner.id);
          toast.success(`${partner.name} deleted.`);
          bump();
          return true;
        } catch (err) {
          toast.error(apiMessage(err, 'Could not delete that partner.'));
          return false;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  /* ── reward action ──────────────────────────────────────────────── */

  const openReward = (referral) => {
    setRewardFor(referral);
    setBaseAmount('');
    setModalError('');
  };

  const submitReward = async (e) => {
    e.preventDefault();
    setBusy(true);
    setModalError('');
    try {
      const payload = rewardFor.code?.rewardType === 'PERCENT'
        ? { baseAmount: Number(baseAmount) }
        : {};
      const credited = await rewardReferral(rewardFor.id, payload);
      toast.success(`Reward of ${money(credited.rewardAmount)} credited.`);
      setRewardFor(null);
      bump();
    } catch (err) {
      setModalError(apiMessage(err, 'Could not credit that reward.'));
    } finally {
      setBusy(false);
    }
  };

  const meta = referrals.meta;
  const needsBase = rewardFor?.code?.rewardType === 'PERCENT';
  const previewBase = Number(baseAmount) || 0;
  const previewReward = needsBase
    ? (previewBase * (Number(rewardFor?.code?.rewardValue) || 0)) / 100
    : Number(rewardFor?.code?.rewardValue) || 0;

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { value: 'partners', label: 'Partners', count: partners.length },
            { value: 'referrals', label: 'Referrals', count: meta?.total },
          ]}
          active={tab}
          onChange={(value) => {
            setTab(value);
            setPage(1);
          }}
        />
        <div className="flex items-center gap-2">
          {tab === 'partners' && (
            <Button size="sm" onClick={() => { setModalError(''); setPartnerForm(blankPartner()); }}>
              <Plus className="size-4" /> New partner
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={bump}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* ── Partners ──────────────────────────────────────────────── */}
      {tab === 'partners' && (
        <div className="card overflow-hidden">
          {partnersLoading && partners.length === 0 ? (
            <LoadingBlock label="Loading partners…" />
          ) : partnersError ? (
            <div className="flex items-start gap-2 px-5 py-6 text-[13px] text-rose-700">
              <AlertCircle className="mt-0.5 size-4" /> <span>{partnersError}</span>
            </div>
          ) : partners.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                icon={Handshake}
                title="No partners yet"
                description="Add the resellers, accountants and affiliates who promote TG Invoice, then issue each of them an invite code."
                action={
                  <Button size="sm" onClick={() => { setModalError(''); setPartnerForm(blankPartner()); }}>
                    <Plus className="size-4" /> Add the first partner
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className={th}>Partner</th>
                    <th className={th}>Type</th>
                    <th className={th}>Rate</th>
                    <th className={th}>Codes</th>
                    <th className={th}>Referrals</th>
                    <th className={th}>Commission</th>
                    <th className={th}>Status</th>
                    <th className={clsx(th, 'text-right')}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {partners.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                      <td className={td}>
                        <p className="font-medium text-slate-900">{p.name}</p>
                        <p className="text-[12px] text-slate-400">{p.companyName || p.email || '—'}</p>
                      </td>
                      <td className={td}>{TYPE_LABEL[p.type] || p.type}</td>
                      <td className={td}>{p.commissionRate}%</td>
                      <td className={td}>
                        <span className="tabular-nums">{p.stats?.codes ?? 0}</span>
                        {p.stats?.activeCodes != null && p.stats.activeCodes < (p.stats.codes ?? 0) && (
                          <span className="ml-1 text-[12px] text-slate-400">({p.stats.activeCodes} on)</span>
                        )}
                      </td>
                      <td className={td}>
                        <span className="tabular-nums">{p.stats?.referrals ?? 0}</span>
                        {p.stats?.byStatus?.PENDING > 0 && (
                          <span className="ml-1 text-[12px] text-amber-600">({p.stats.byStatus.PENDING} pending)</span>
                        )}
                      </td>
                      <td className={td}>{money(p.stats?.commission ?? 0)}</td>
                      <td className={td}>
                        <Badge className={p.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}>
                          {p.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                        </Badge>
                      </td>
                      <td className={clsx(td, 'text-right')}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Issue an invite code"
                            onClick={() => { setModalError(''); setCodeForm(blankCode()); setCodeFor(p); }}
                            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600"
                          >
                            <Gift className="size-4" />
                          </button>
                          <button
                            type="button"
                            title={p.status === 'ACTIVE' ? 'Suspend partner' : 'Reactivate partner'}
                            disabled={busy}
                            onClick={() => togglePartner(p)}
                            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-amber-600 disabled:opacity-50"
                          >
                            {p.status === 'ACTIVE' ? <Ban className="size-4" /> : <Power className="size-4" />}
                          </button>
                          <button
                            type="button"
                            title="Edit partner"
                            onClick={() => {
                              setModalError('');
                              setPartnerForm({
                                id: p.id, name: p.name, type: p.type, email: p.email || '', phone: p.phone || '',
                                companyName: p.companyName || '', commissionRate: p.commissionRate, notes: p.notes || '',
                              });
                            }}
                            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600"
                          >
                            <Search className="size-4" />
                          </button>
                          <button
                            type="button"
                            title="Delete partner"
                            disabled={busy}
                            onClick={() => removePartner(p)}
                            className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
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
        </div>
      )}

      {/* ── Referrals ─────────────────────────────────────────────── */}
      {tab === 'referrals' && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-44"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="ACTIVE">Active</option>
              <option value="REWARDED">Rewarded</option>
              <option value="EXPIRED">Expired</option>
            </Select>
            {referralsLoading && <Spinner className="size-4" />}
            <p className="ml-auto text-[13px] text-slate-400">
              {meta ? `${meta.total.toLocaleString()} referrals` : ''}
            </p>
          </div>

          {referralsError ? (
            <div className="flex items-start gap-2 px-5 py-6 text-[13px] text-rose-700">
              <AlertCircle className="mt-0.5 size-4" /> <span>{referralsError}</span>
            </div>
          ) : referrals.rows.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                icon={Gift}
                title="No referrals yet"
                description="Every business that signs up with a partner or business invite code will show up here."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className={th}>Business</th>
                    <th className={th}>Referred by</th>
                    <th className={th}>Code</th>
                    <th className={th}>Status</th>
                    <th className={th}>Reward</th>
                    <th className={th}>Date</th>
                    <th className={clsx(th, 'text-right')}>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {referrals.rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                      <td className={td}>
                        <p className="font-medium text-slate-900">{r.referred?.name ?? '—'}</p>
                        <p className="text-[12px] text-slate-400">{r.referred?.slug ?? ''}</p>
                      </td>
                      <td className={td}>
                        {r.referrer ? (
                          <span className="text-slate-700">{r.referrer.name}</span>
                        ) : (
                          <span className="text-slate-400">Partner / platform code</span>
                        )}
                      </td>
                      <td className={td}>
                        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[12px]">{r.code?.code ?? '—'}</span>
                      </td>
                      <td className={td}>
                        <Badge className={STATUS_STYLE[r.status] || STATUS_STYLE.EXPIRED}>
                          {STATUS_LABEL[r.status] || r.status}
                        </Badge>
                      </td>
                      <td className={td}>
                        {r.status === 'REWARDED' ? (
                          money(r.rewardAmount)
                        ) : (
                          <span className="text-slate-400">
                            {r.code?.rewardType === 'FIXED' ? money(r.code.rewardValue) : `${r.code?.rewardValue ?? 0}%`}
                          </span>
                        )}
                      </td>
                      <td className={td}>{r.referred?.createdAt ? formatDate(r.referred.createdAt) : '—'}</td>
                      <td className={clsx(td, 'text-right')}>
                        {r.status !== 'REWARDED' && r.status !== 'EXPIRED' ? (
                          <Button size="sm" variant="secondary" onClick={() => openReward(r)} disabled={busy}>
                            Credit reward
                          </Button>
                        ) : (
                          <span className="text-[13px] text-slate-400">{r.status === 'REWARDED' ? 'Credited' : '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {meta && !referralsError && (
            <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} label="referrals" />
          )}
        </div>
      )}

      {/* ── Partner modal ─────────────────────────────────────────── */}
      <Modal
        open={!!partnerForm}
        onClose={() => (busy ? null : setPartnerForm(null))}
        title={partnerForm?.id ? `Edit ${partnerForm.name}` : 'Add a partner'}
        description="Resellers, accountants and affiliates who promote TG Invoice and earn commission on the referrals they bring."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPartnerForm(null)} disabled={busy}>Cancel</Button>
            <Button onClick={submitPartner} loading={busy} disabled={!partnerForm?.name?.trim()}>
              {partnerForm?.id ? 'Save changes' : 'Add partner'}
            </Button>
          </>
        }
      >
        {partnerForm && (
          <div className="space-y-4">
            {modalError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{modalError}</div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Partner name" required>
                <input
                  className="input"
                  value={partnerForm.name}
                  onChange={(e) => setPartnerForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Apex Resellers Ltd"
                  required
                />
              </Field>
              <Field label="Type" required>
                <Select value={partnerForm.type} onChange={(e) => setPartnerForm((f) => ({ ...f, type: e.target.value }))}>
                  <option value="RESELLER">Reseller</option>
                  <option value="ACCOUNTANT">Accountant</option>
                  <option value="AFFILIATE">Affiliate</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email">
                <input
                  className="input"
                  type="email"
                  value={partnerForm.email}
                  onChange={(e) => setPartnerForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="partner@company.com"
                />
              </Field>
              <Field label="Commission rate (%)" hint="The agreed rate, kept for reference.">
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="100"
                  value={partnerForm.commissionRate}
                  onChange={(e) => setPartnerForm((f) => ({ ...f, commissionRate: e.target.value }))}
                  placeholder="25"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone">
                <input
                  className="input"
                  value={partnerForm.phone}
                  onChange={(e) => setPartnerForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+234 801 234 5678"
                />
              </Field>
              <Field label="Company">
                <input
                  className="input"
                  value={partnerForm.companyName}
                  onChange={(e) => setPartnerForm((f) => ({ ...f, companyName: e.target.value }))}
                  placeholder="Company name"
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                className="input min-h-20 resize-y"
                value={partnerForm.notes}
                onChange={(e) => setPartnerForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Agreement details, payout account, who to contact…"
                maxLength={1000}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* ── Partner code modal ────────────────────────────────────── */}
      <Modal
        open={!!codeFor}
        onClose={() => (busy ? null : setCodeFor(null))}
        title={`Invite code for ${codeFor?.name ?? ''}`}
        description="This partner shares the code with businesses they bring in; their commission is the sum of rewards on their codes."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCodeFor(null)} disabled={busy}>Cancel</Button>
            <Button onClick={submitCode} loading={busy} disabled={!codeForm.rewardValue}>
              Create code
            </Button>
          </>
        }
      >
        {codeFor && (
          <div className="space-y-4">
            {modalError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{modalError}</div>
            )}
            <div className="grid grid-cols-3 gap-4">
              <Field label="Reward type" required>
                <Select value={codeForm.rewardType} onChange={(e) => setCodeForm((f) => ({ ...f, rewardType: e.target.value }))}>
                  <option value="PERCENT">Percentage</option>
                  <option value="FIXED">Fixed amount</option>
                </Select>
              </Field>
              <Field label={codeForm.rewardType === 'PERCENT' ? 'Percentage' : 'Amount'} required>
                <input
                  className="input"
                  type="number"
                  min="0"
                  max={codeForm.rewardType === 'PERCENT' ? 100 : undefined}
                  value={codeForm.rewardValue}
                  onChange={(e) => setCodeForm((f) => ({ ...f, rewardValue: e.target.value }))}
                  placeholder={codeForm.rewardType === 'PERCENT' ? '15' : '5000'}
                  required
                />
              </Field>
              <Field label="Usage limit" hint="Empty = unlimited.">
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={codeForm.maxUses}
                  onChange={(e) => setCodeForm((f) => ({ ...f, maxUses: e.target.value }))}
                  placeholder="Unlimited"
                />
              </Field>
            </div>
            <p className="text-xs text-slate-400">
              A short code is generated automatically; the partner shares the resulting invite link.
            </p>
          </div>
        )}
      </Modal>

      {/* ── Reward modal ──────────────────────────────────────────── */}
      <Modal
        open={!!rewardFor}
        onClose={() => (busy ? null : setRewardFor(null))}
        title="Credit a referral reward"
        description={`Attributed to ${rewardFor?.referred?.name ?? 'this business'} via code ${rewardFor?.code?.code ?? ''}.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRewardFor(null)} disabled={busy}>Cancel</Button>
            <Button onClick={submitReward} loading={busy} disabled={needsBase && !(Number(baseAmount) > 0)}>
              Credit {money(previewReward)}
            </Button>
          </>
        }
      >
        {rewardFor && (
          <div className="space-y-4">
            {modalError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{modalError}</div>
            )}
            {needsBase ? (
              <Field
                label="Plan value to calculate the percentage from"
                required
                hint={`${rewardFor.code.rewardValue}% of the value you enter below.`}
                error={baseAmount !== '' && !(Number(baseAmount) > 0) ? 'Enter a value greater than zero.' : undefined}
              >
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={baseAmount}
                  onChange={(e) => setBaseAmount(e.target.value)}
                  placeholder="10000"
                  autoFocus
                  required
                />
              </Field>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                A fixed reward of <span className="font-semibold text-slate-900">{money(rewardFor.code.rewardValue)}</span> will be credited.
              </div>
            )}
            <p className="text-xs text-slate-400">
              Crediting is one-shot: the amount is recorded on the referral and the referrer is notified. It can be
              paid out alongside your existing settlement run.
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => (busy ? null : setConfirm(null))}
        onConfirm={async () => {
          if (!confirm) return;
          const done = await confirm.run();
          if (done !== false) setConfirm(null);
        }}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        loading={busy}
      />
    </div>
  );
}
