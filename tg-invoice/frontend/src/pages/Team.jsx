import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Shield, Trash2, Mail, Copy } from 'lucide-react';
import api, { apiMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  PageHeader, Spinner, EmptyState, Badge, Modal, Field, ConfirmDialog, th, td, trHover,
} from '../components/ui.jsx';
import { formatDate, formatDateTime } from '../utils/dates.js';

const ROLE_BADGE = {
  OWNER: 'bg-brand-50 text-brand-700 ring-brand-200',
  ADMIN: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  STAFF: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default function TeamPage() {
  const toast = useToast();
  const { role: myRole } = useAuth();
  const [data, setData] = useState({ members: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'STAFF' });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';

  const load = useCallback(() => {
    api
      .get('/team')
      .then(({ data: res }) => {
        setData(res.data);
        setError('');
      })
      .catch((err) => setError(apiMessage(err, 'Could not load the team.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const sendInvite = async (e) => {
    e.preventDefault();
    setInviteBusy(true);
    try {
      const { data: res } = await api.post('/team/invite', inviteForm);
      setInviteOpen(false);
      setInviteForm({ email: '', role: 'STAFF' });
      setInviteResult(res.data);
      toast.success(res.data.message || 'Invitation sent.');
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not send the invitation.'));
    } finally {
      setInviteBusy(false);
    }
  };

  const changeMember = async (member, patch) => {
    setBusyId(member.id);
    try {
      await api.put(`/team/${member.id}`, patch);
      toast.success('Member updated.');
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not update the member.'));
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async () => {
    setRemoveBusy(true);
    try {
      const { data: res } = await api.delete(`/team/${removing.id}`);
      toast.success(res.data?.message || 'Member removed.');
      setRemoving(null);
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not remove the member.'));
      setRemoving(null);
    } finally {
      setRemoveBusy(false);
    }
  };

  const copyLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Invitation link copied.');
    } catch {
      toast.error('Could not copy — select the link and copy manually.');
    }
  };

  if (loading) return <Spinner className="mx-auto mt-16 size-6" />;

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle="Invite the people who work with you. Roles decide what they can do."
        actions={
          canManage && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setInviteOpen(true)}>
              <UserPlus size={15} /> Invite member
            </button>
          )
        }
      />

      {error ? (
        <EmptyState icon={Shield} title="Could not load the team" description={error} />
      ) : (
        <>
          {/* Members */}
          <div className="card overflow-hidden">
            <div className="border-b border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Members ({data.members.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className={th}>Person</th>
                    <th className={th}>Role</th>
                    <th className={th}>Status</th>
                    <th className={th}>Joined</th>
                    <th className={`${th} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.id} className={trHover}>
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                            {(m.user?.name || m.user?.email || '?').slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900">
                              {m.user?.name}
                              {m.isSelf && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                            </span>
                            <span className="block truncate text-xs text-slate-400">{m.user?.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className={td}>
                        <Badge className={ROLE_BADGE[m.role] || ROLE_BADGE.STAFF}>{m.role}</Badge>
                      </td>
                      <td className={td}>
                        <Badge className={m.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}>
                          {m.status}
                        </Badge>
                      </td>
                      <td className={`${td} whitespace-nowrap text-slate-600`}>{formatDate(m.joinedAt)}</td>
                      <td className={`${td} text-right`}>
                        {canManage && !m.isSelf && m.role !== 'OWNER' ? (
                          <div className="flex justify-end gap-2">
                            <select
                              className="input w-auto py-1 text-xs"
                              value={m.role}
                              disabled={busyId === m.id || myRole === 'ADMIN'}
                              onChange={(e) => changeMember(m, { role: e.target.value })}
                              title={myRole === 'ADMIN' ? 'Only the owner can change roles' : 'Change role'}
                            >
                              <option value="ADMIN">Admin</option>
                              <option value="STAFF">Staff</option>
                            </select>
                            <select
                              className="input w-auto py-1 text-xs"
                              value={m.status}
                              disabled={busyId === m.id || myRole === 'ADMIN'}
                              onChange={(e) => changeMember(m, { status: e.target.value })}
                              title={myRole === 'ADMIN' ? 'Only the owner can change status' : 'Change status'}
                            >
                              <option value="ACTIVE">Active</option>
                              <option value="INACTIVE">Inactive</option>
                              <option value="SUSPENDED">Suspended</option>
                            </select>
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              onClick={() => setRemoving(m)}
                              title="Remove from team"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pending invitations */}
          <div className="card-blue mt-6 overflow-hidden">
            <div className="border-b border-brand-100/70 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Pending invitations ({data.invitations.length})
              </h2>
            </div>
            {data.invitations.length === 0 ? (
              <p className="px-4 py-5 text-sm text-slate-500">
                No pending invitations. {canManage && 'Invite a teammate to get started.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                      <th className={th}>Email</th>
                      <th className={th}>Role</th>
                      <th className={th}>Invited</th>
                      <th className={th}>Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invitations.map((i) => (
                      <tr key={i.id} className={trHover}>
                        <td className={td}>
                          <span className="flex items-center gap-2 text-slate-700">
                            <Mail size={14} className="text-slate-400" /> {i.email}
                          </span>
                        </td>
                        <td className={td}><Badge className={ROLE_BADGE[i.role] || ROLE_BADGE.STAFF}>{i.role}</Badge></td>
                        <td className={`${td} whitespace-nowrap text-slate-600`}>{formatDate(i.createdAt)}</td>
                        <td className={`${td} whitespace-nowrap text-slate-600`}>{formatDateTime(i.expiresAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Invite modal */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a team member"
        description="They'll get an email with a link valid for 7 days."
        size="sm"
      >
        <form onSubmit={sendInvite} className="space-y-4">
          <Field label="Email address" required>
            <input
              type="email"
              className="input"
              placeholder="teammate@company.com"
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              required
              autoFocus
            />
          </Field>
          <Field label="Role" hint="Admins can manage everything except ownership. Staff can work on documents.">
            <select
              className="input"
              value={inviteForm.role}
              onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
            >
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setInviteOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={inviteBusy}>
              <Mail size={15} /> {inviteBusy ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Invite result (dev link when SMTP is off) */}
      <Modal
        open={!!inviteResult}
        onClose={() => setInviteResult(null)}
        title="Invitation created"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{inviteResult?.message}</p>
          {inviteResult?.inviteLink && (
            <div className="rounded-md bg-slate-50 p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Share this link
              </p>
              <div className="flex items-center gap-2">
                <input readOnly className="input font-mono text-xs" value={inviteResult.inviteLink} />
                <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => copyLink(inviteResult.inviteLink)}>
                  <Copy size={14} />
                </button>
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setInviteResult(null)}>
              Done
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={removeMember}
        loading={removeBusy}
        danger
        title="Remove team member"
        message={`Remove ${removing?.user?.name || removing?.user?.email} from this business? They immediately lose access.`}
        confirmLabel="Remove"
      />
    </div>
  );
}
