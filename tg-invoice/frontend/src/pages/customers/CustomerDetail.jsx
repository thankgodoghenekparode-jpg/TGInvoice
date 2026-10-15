import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, FileText, Pencil, Trash2, Mail, Phone, MapPin } from 'lucide-react';
import api, { apiMessage } from '../../services/api.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, StatCard, Spinner, EmptyState, ConfirmDialog, Badge, th, td, trHover,
} from '../../components/ui.jsx';
import { statusMeta } from '../../utils/status.js';
import { formatDate } from '../../utils/dates.js';
import Attachments from '../../components/Attachments.jsx';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { money, compact } = useSettings();

  const [customer, setCustomer] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [c, inv, quo] = await Promise.all([
        api.get(`/customers/${id}`),
        api.get('/invoices', { params: { customerId: id, limit: 10, sort: '-invoiceDate' } }),
        api.get('/quotations', { params: { customerId: id, limit: 10, sort: '-quotationDate' } }),
      ]);
      setCustomer(c.data.data);
      setInvoices(inv.data.data || []);
      setQuotations(quo.data.data || []);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not load the customer.'));
      navigate('/customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`/customers/${id}`);
      toast.success(data.data?.message || 'Customer deleted.');
      navigate('/customers');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete the customer.'));
      setConfirm(false);
      setBusy(false);
    }
  };

  if (loading || !customer) {
    return (
      <div className="py-20">
        <Spinner className="mx-auto size-7" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.companyName || customer.name}
        subtitle={`${customer.customerCode} · Customer since ${formatDate(customer.createdAt)}`}
        actions={
          <>
            <Link to="/customers" className="btn btn-secondary btn-sm">
              <ArrowLeft size={15} /> All customers
            </Link>
            <Link to={`/customers/${id}/edit`} className="btn btn-secondary btn-sm">
              <Pencil size={15} /> Edit
            </Link>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>
              <Trash2 size={15} /> Delete
            </button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total invoiced" value={compact(customer.totalInvoiced)} tone="brand" sub={`${customer.invoiceCount} invoice(s)`} />
        <StatCard label="Total paid" value={compact(customer.totalPaid)} tone="green" sub="Payments received" />
        <StatCard
          label="Outstanding"
          value={compact(customer.outstanding)}
          tone={customer.outstanding > 0 ? 'rose' : 'default'}
          sub={customer.outstanding > 0 ? 'Still owed' : 'All settled'}
        />
        <StatCard label="Quoted" value={compact(customer.totalQuoted)} tone="amber" sub={`${customer.quotationCount} quotation(s)`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contact card */}
        <div className="card-blue p-5">
          <h2 className="text-sm font-semibold text-slate-900">Contact details</h2>
          <ul className="mt-3 space-y-2.5 text-sm text-slate-600">
            {customer.email && (
              <li className="flex items-start gap-2">
                <Mail size={15} className="mt-0.5 shrink-0 text-slate-400" />
                <a href={`mailto:${customer.email}`} className="hover:text-brand-600">{customer.email}</a>
              </li>
            )}
            {customer.phone && (
              <li className="flex items-start gap-2">
                <Phone size={15} className="mt-0.5 shrink-0 text-slate-400" />
                <a href={`tel:${customer.phone}`} className="hover:text-brand-600">{customer.phone}</a>
              </li>
            )}
            {(customer.address || customer.city || customer.state || customer.country) && (
              <li className="flex items-start gap-2">
                <MapPin size={15} className="mt-0.5 shrink-0 text-slate-400" />
                <span>
                  {[customer.address, customer.city, customer.state, customer.country].filter(Boolean).join(', ')}
                </span>
              </li>
            )}
            {customer.taxId && (
              <li className="flex items-start gap-2">
                <FileText size={15} className="mt-0.5 shrink-0 text-slate-400" />
                <span>Tax ID: {customer.taxId}</span>
              </li>
            )}
          </ul>
          {customer.notes && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="mb-1 font-semibold uppercase tracking-wider text-slate-400">Notes</p>
              <p className="whitespace-pre-line">{customer.notes}</p>
            </div>
          )}
          <div className="mt-5 flex flex-col gap-2">
            <Link to={`/invoices/new?customerId=${id}`} className="btn btn-primary btn-sm justify-center">
              <Plus size={15} /> New invoice for this customer
            </Link>
            <Link to={`/quotations/new?customerId=${id}`} className="btn btn-secondary btn-sm justify-center">
              <Plus size={15} /> New quotation
            </Link>
          </div>
        </div>

        {/* Documents */}
        <div className="space-y-6 lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-900">Recent invoices</h2>
              <Link to={`/invoices?customerId=${id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                View all →
              </Link>
            </div>
            {invoices.length === 0 ? (
              <EmptyState icon={FileText} title="No invoices yet" description="Create the first invoice for this customer." />
            ) : (
              <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className={th}>Number</th>
                    <th className={th}>Date</th>
                    <th className={`${th} text-right`}>Total</th>
                    <th className={`${th} text-right`}>Balance</th>
                    <th className={`${th} text-right`}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => {
                    const sm = statusMeta(i.status, 'invoice');
                    return (
                      <tr key={i.id} className={trHover}>
                        <td className={td}>
                          <Link to={`/invoices/${i.id}`} className="font-medium text-brand-600 hover:text-brand-700">
                            {i.invoiceNumber}
                          </Link>
                        </td>
                        <td className={`${td} text-slate-500`}>{formatDate(i.invoiceDate)}</td>
                        <td className={`${td} text-right font-medium`}>{money(i.total)}</td>
                        <td className={`${td} text-right ${Number(i.balanceDue) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {money(i.balanceDue)}
                        </td>
                        <td className={`${td} text-right`}>
                          <Badge className={sm.className}>{sm.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-900">Recent quotations</h2>
              <Link to={`/quotations?customerId=${id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                View all →
              </Link>
            </div>
            {quotations.length === 0 ? (
              <EmptyState icon={FileText} title="No quotations yet" description="Quote some work for this customer." />
            ) : (
              <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className={th}>Number</th>
                    <th className={th}>Date</th>
                    <th className={`${th} text-right`}>Total</th>
                    <th className={`${th} text-right`}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {quotations.map((q) => {
                    const sm = statusMeta(q.status, 'quotation');
                    return (
                      <tr key={q.id} className={trHover}>
                        <td className={td}>
                          <Link to={`/quotations/${q.id}`} className="font-medium text-brand-600 hover:text-brand-700">
                            {q.quotationNumber}
                          </Link>
                        </td>
                        <td className={`${td} text-slate-500`}>{formatDate(q.quotationDate)}</td>
                        <td className={`${td} text-right font-medium`}>{money(q.total)}</td>
                        <td className={`${td} text-right`}>
                          <Badge className={sm.className}>{sm.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <Attachments documentKind="CUSTOMER" documentId={customer.id} title="Files" />

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={remove}
        loading={busy}
        danger
        title="Delete customer"
        message={`Delete ${customer.companyName || customer.name}? Customers with invoices or quotations cannot be deleted.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
