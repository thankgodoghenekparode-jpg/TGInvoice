import { Link } from 'react-router-dom';
import { Building2, FileText, UserCog, ArrowRight, Users, BellRing } from 'lucide-react';
import { PageHeader, Card } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../hooks/useSettings.js';

const SECTIONS = [
  {
    to: '/settings/company',
    icon: Building2,
    title: 'Company profile',
    description: 'Business name, address, contact details, logo and currency — everything printed on your documents.',
  },
  {
    to: '/settings/documents',
    icon: FileText,
    title: 'Documents & payments',
    description: 'Numbering prefixes, default tax rate, notes, terms and the bank details clients pay into.',
  },
  {
    to: '/settings/reminders',
    icon: BellRing,
    title: 'Payment reminders',
    description: 'Chase unpaid invoices automatically — before, on, or after the due date, by WhatsApp, SMS or email.',
  },
  {
    to: '/settings/profile',
    icon: UserCog,
    title: 'Your profile',
    description: 'Your name, email address and password for this account.',
  },
];

export default function SettingsPage() {
  const { role } = useAuth();
  const { settings } = useSettings();
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Settings"
        subtitle={
          canEdit
            ? 'Configure this business. Changes apply to every document you create from now on.'
            : 'Only owners and admins can change business settings. Your profile is always editable.'
        }
      />

      <div className="space-y-4">
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.to}>
            <Card tone="blue" className="card-hover flex items-center gap-4 p-5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 ring-1 ring-brand-100">
                <s.icon size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{s.title}</span>
                <span className="mt-0.5 block text-sm text-slate-500">{s.description}</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-slate-300" />
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 to-white px-5 py-4">
        <div>
          <p className="text-sm font-medium text-slate-700">Need to add colleagues?</p>
          <p className="text-xs text-slate-500">Team members get their own sign-in with role-based access.</p>
        </div>
        <Link to="/team" className="btn btn-secondary btn-sm">
          <Users size={15} /> Manage team
        </Link>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Active business: <span className="font-medium text-slate-500">{settings.businessName}</span> ·
        Currency: <span className="font-medium text-slate-500">{settings.currency || 'NGN'}</span>
      </p>
    </div>
  );
}
